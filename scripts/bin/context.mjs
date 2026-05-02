#!/usr/bin/env node
// scripts/bin/context.mjs
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { parse as parseTrigger, evaluate as evalTrigger, shouldTreatAsNonMatchForContent } from '../lib/trigger-engine.mjs';
import { isBinary, isMainModule } from '../lib/fs-utils.mjs';

function formatRuleLine(r) {
  const fm = r.frontmatter;
  const desc = fm.description ?? fm.name ?? r.id;
  const markers = [];
  if (fm.type === 'manual') markers.push('[manual]');
  if (fm._invalid) markers.push(`[invalid: ${fm._invalid}]`);
  const markerStr = markers.length ? '   ' + markers.join(' ') : '';
  const tierLabel = fm.tier !== 'default' ? fm.tier : 'default';
  const nonDefaultType = fm.type !== 'auto' ? `   type: ${fm.type}` : '';
  const readLine = r.path ? `   read: ${r.path}` : '';
  return `- ${r.id}: ${desc}${markerStr}\n    tier: ${tierLabel}   severity: ${fm.severity}${nonDefaultType}${readLine}\n`;
}

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const [target] = argv;
  if (!target) {
    // No path given — list all rules
    let root;
    try { root = await repoRoot(cwd); } catch { root = cwd; }
    const cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);
    const { rules } = await loadRules(root, cfg);
    if (rules.length === 0) {
      stdout.write('No rules loaded.\n');
      return 0;
    }
    stdout.write(`All rules (${rules.length}):\n`);
    for (const r of rules) {
      stdout.write(formatRuleLine(r));
    }
    return 0;
  }

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);
  const { rules, warnings } = await loadRules(root, cfg);
  for (const w of warnings) stderr.write(`[warn] ${w}\n`);

  const absTarget = resolve(cwd, target);
  // Use the platform separator at the boundary so this works on Windows where
  // `repoRoot` may return a forward-slash URL-style path while `resolve()` uses `\`.
  const rootNorm = root.split(/[\\/]/).join(sep);
  const absNorm = absTarget.split(/[\\/]/).join(sep);
  const relTarget = absNorm.startsWith(rootNorm + sep) ? absNorm.slice(rootNorm.length + 1) : target;
  const buf = await readFile(absTarget).catch(() => null);
  const content = buf ? buf.toString('utf8') : '';
  const binary = buf ? isBinary(buf) : false;
  const size = buf ? buf.length : 0;
  const contentForbidden = shouldTreatAsNonMatchForContent(size, binary);

  const matches = [];
  for (const rule of rules) {
    try {
      const ast = parseTrigger(rule.frontmatter.triggers);
      if (evalTrigger(ast, { path: relTarget, content, binary: contentForbidden })) matches.push(rule);
    } catch (e) {
      stderr.write(`[warn] rule ${rule.id}: trigger parse: ${e.message}\n`);
    }
  }

  if (matches.length === 0) {
    stdout.write(`No rules match ${relTarget}.\n`);
    return 0;
  }
  stdout.write(`Rules matching ${relTarget}:\n`);
  for (const r of matches) {
    stdout.write(formatRuleLine(r));
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
