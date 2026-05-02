#!/usr/bin/env node
// scripts/bin/override-rule.mjs
// Backing script for the override-rule wizard — persists remote rule overlay fields
// into .autoreview/config.yaml or config.personal.yaml.

import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { readFileOrNull, writeAtomic, isMainModule } from '../lib/fs-utils.mjs';
import { ALLOWED_OVERRIDE_FIELDS as ALLOWED_FIELDS } from '../lib/config-loader.mjs';

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const RULE_ID_RE = /^[A-Za-z0-9_/-]+$/;

function validateOverrideArgs(values, stderr) {
  if (!NAME_RE.test(values.remote ?? '')) {
    stderr.write(`[error] --remote must match [A-Za-z0-9._-]+, got: ${JSON.stringify(values.remote)}\n`);
    return false;
  }
  if (!RULE_ID_RE.test(values.rule ?? '')) {
    stderr.write(`[error] --rule must match [A-Za-z0-9_/-]+, got: ${JSON.stringify(values.rule)}\n`);
    return false;
  }
  for (const f of values.field ?? []) {
    if (/[\r\n]/.test(f)) {
      stderr.write(`[error] --field must not contain newlines: ${JSON.stringify(f)}\n`);
      return false;
    }
  }
  return true;
}

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, stdout, stderr }) {
  const [sub, ...rest] = argv;
  if (!sub) {
    stderr.write('[error] usage: override-rule save --remote <name> --rule <id> --field <name=value>... [--scope repo|personal]\n');
    return 1;
  }

  if (sub !== 'save') {
    stderr.write(`[error] unknown subcommand: ${sub}\n`);
    return 1;
  }

  const { values } = parseArgs(rest, { multiple: ['field'] });

  if (!values.remote) { stderr.write('[error] save requires --remote <source-name>\n'); return 1; }
  if (!values.rule) { stderr.write('[error] save requires --rule <rule-id>\n'); return 1; }
  if (!values.field || values.field.length === 0) { stderr.write('[error] save requires at least one --field <name=value>\n'); return 1; }

  if (!validateOverrideArgs(values, stderr)) return 1;

  const scope = values.scope ?? 'repo';
  if (scope !== 'repo' && scope !== 'personal') {
    stderr.write('[error] --scope must be repo or personal\n');
    return 1;
  }

  const fields = {};
  for (const f of values.field) {
    const eq = f.indexOf('=');
    if (eq === -1) { stderr.write(`[error] --field must be in name=value format, got: ${f}\n`); return 1; }
    const name = f.slice(0, eq);
    const raw = f.slice(eq + 1);
    if (!ALLOWED_FIELDS.has(name)) {
      stderr.write(`[error] unknown override field: ${name} (allowed: ${[...ALLOWED_FIELDS].join(', ')})\n`);
      return 1;
    }
    fields[name] = raw === 'null' ? null : raw;
  }

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }

  const configFile = scope === 'personal' ? 'config.personal.yaml' : 'config.yaml';
  const configPath = join(root, '.autoreview', configFile);

  const existing = await readFileOrNull(configPath) ?? '';
  const updated = applyOverride(existing, values.remote, values.rule, fields);
  await writeAtomic(configPath, updated);

  const fieldSummary = Object.entries(fields).map(([k, v]) => `${k}: ${v === null ? 'null' : v}`).join(', ');
  stdout.write(`Saved override for ${values.remote}/${values.rule} in ${configFile}: ${fieldSummary}\n`);
  return 0;
}

// applyOverride performs a targeted text-level edit on the YAML config string so that
// existing comments and formatting are preserved. It finds or creates the correct
// remote_rules entry, then the overrides block, then writes the field key=value lines.
// This avoids a round-trip through a YAML serializer (yaml-min has no stringify).
function applyOverride(yaml, remoteName, ruleId, fields) {
  const lines = yaml.split('\n');

  // Locate the remote_rules list entry for remoteName. We look for a line containing
  // `name: <remoteName>` that is inside a remote_rules list item (preceded by a `- `
  // line at the same depth).
  let remoteStart = -1;
  let remoteIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \s*$/);
    if (m) {
      // Possibly a multi-line list item starting with just `- `.
      // Check subsequent lines for `name: <remoteName>`.
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        if (lines[j].match(new RegExp(`^\\s+name:\\s+["']?${escapeRe(remoteName)}["']?\\s*$`))) {
          remoteStart = i;
          remoteIndent = m[1].length;
          break;
        }
      }
    }
    // Also handle inline list item: `  - name: corp-standards`
    const m2 = lines[i].match(/^(\s*)- \s*name:\s*["']?(.+?)["']?\s*$/);
    if (m2 && m2[2] === remoteName) {
      remoteStart = i;
      remoteIndent = m2[1].length;
    }
    if (remoteStart !== -1) break;
  }

  if (remoteStart === -1) {
    // No remote_rules entry found for this name. Append a minimal new entry.
    const overrideBlock = buildNewEntry(remoteName, ruleId, fields);
    if (/remote_rules:/.test(yaml)) {
      // remote_rules section exists — append list item under it.
      const insertAt = findSectionEnd(lines, 'remote_rules');
      lines.splice(insertAt, 0, ...overrideBlock.split('\n'));
    } else {
      // No remote_rules section at all — append to end.
      lines.push('', 'remote_rules:', ...overrideBlock.split('\n'));
    }
    return lines.join('\n');
  }

  // Find the extent of this remote_rules entry (lines from remoteStart until the
  // next list item at the same indent level, or end of file).
  const entryEnd = findListItemEnd(lines, remoteStart, remoteIndent);

  // Within the entry block, look for an `overrides:` key.
  let overridesLine = -1;
  for (let i = remoteStart; i < entryEnd; i++) {
    if (/^\s+overrides:\s*$/.test(lines[i])) {
      overridesLine = i;
      break;
    }
  }

  const itemIndent = ' '.repeat(remoteIndent + 2);
  const overrideIndent = ' '.repeat(remoteIndent + 4);
  const fieldIndent = ' '.repeat(remoteIndent + 6);

  if (overridesLine === -1) {
    // No overrides block exists in this entry — insert one before entryEnd.
    const newLines = buildOverrideBlock(ruleId, fields, itemIndent, overrideIndent, fieldIndent);
    lines.splice(entryEnd, 0, ...newLines);
    return lines.join('\n');
  }

  // overrides block exists. Look for the specific rule-id key within it.
  // The overrides block ends at the next key at the same indent as `overrides:`,
  // or at entryEnd.
  const overridesIndent = lines[overridesLine].match(/^(\s*)/)[1].length;
  let ruleKeyLine = -1;
  let ruleKeyEnd = -1;
  for (let i = overridesLine + 1; i < entryEnd; i++) {
    const indent = lines[i].match(/^(\s*)/)[1].length;
    if (indent <= overridesIndent && lines[i].trim() !== '') break;
    const m = lines[i].match(/^(\s+)([^:\s]+):\s*$/);
    if (m && m[2] === ruleId) {
      ruleKeyLine = i;
      const ruleKeyIndentLen = m[1].length;
      ruleKeyEnd = i + 1;
      while (ruleKeyEnd < entryEnd) {
        const nextIndent = lines[ruleKeyEnd].match(/^(\s*)/)[1].length;
        if (lines[ruleKeyEnd].trim() === '' || nextIndent <= ruleKeyIndentLen) break;
        ruleKeyEnd++;
      }
      break;
    }
  }

  if (ruleKeyLine === -1) {
    // Rule id not in overrides yet — append after overrides: line.
    const insertAt = overridesLine + 1;
    const newLines = [`${overrideIndent}${ruleId}:`, ...Object.entries(fields).map(([k, v]) => `${fieldIndent}${k}: ${v === null ? 'null' : v}`)];
    lines.splice(insertAt, 0, ...newLines);
    return lines.join('\n');
  }

  // Rule id block exists — update or add individual field lines.
  for (const [fname, fval] of Object.entries(fields)) {
    const valStr = fval === null ? 'null' : fval;
    let found = false;
    for (let i = ruleKeyLine + 1; i < ruleKeyEnd; i++) {
      const fm = lines[i].match(/^(\s+)(\w+):\s*(.*)$/);
      if (fm && fm[2] === fname) {
        lines[i] = `${fm[1]}${fname}: ${valStr}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.splice(ruleKeyEnd, 0, `${fieldIndent}${fname}: ${valStr}`);
      ruleKeyEnd++;
    }
  }

  return lines.join('\n');
}

function buildNewEntry(remoteName, ruleId, fields) {
  const lines = [
    `  - name: ${remoteName}`,
    `    overrides:`,
    `      ${ruleId}:`,
    ...Object.entries(fields).map(([k, v]) => `        ${k}: ${v === null ? 'null' : v}`),
  ];
  return lines.join('\n');
}

function buildOverrideBlock(ruleId, fields, itemIndent, overrideIndent, fieldIndent) {
  return [
    `${itemIndent}overrides:`,
    `${overrideIndent}${ruleId}:`,
    ...Object.entries(fields).map(([k, v]) => `${fieldIndent}${k}: ${v === null ? 'null' : v}`),
  ];
}

function findListItemEnd(lines, startIdx, baseIndent) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') continue;
    const indent = lines[i].match(/^(\s*)/)[1].length;
    if (indent <= baseIndent && trimmed.startsWith('-')) return i;
    if (indent < baseIndent) return i;
  }
  return lines.length;
}

function findSectionEnd(lines, sectionKey) {
  let inSection = false;
  let sectionIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)([A-Za-z_]+):/);
    if (!m) continue;
    if (m[2] === sectionKey) { inSection = true; sectionIndent = m[1].length; continue; }
    if (inSection && m[1].length <= sectionIndent) return i;
  }
  return lines.length;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
