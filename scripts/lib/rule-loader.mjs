// scripts/lib/rule-loader.mjs
// Load rules from .autoreview/rules/ (local) and .autoreview/remote_rules/<name>/<ref>/<path>/.

import { readFile } from 'node:fs/promises';
import { relative, join, sep } from 'node:path';
import { walk } from './fs-utils.mjs';
import { parse as parseYaml } from './yaml-min.mjs';
import { ALLOWED_TIER_NAMES } from './config-loader.mjs';
const VALID_SEVERITIES = new Set(['error', 'warning']);
const VALID_TYPES = new Set(['auto', 'manual']);

function validateEffectiveFrontmatter(fm) {
  const errs = [];
  if (!ALLOWED_TIER_NAMES.includes(fm.tier)) errs.push(`tier '${fm.tier}' unknown (allowed: ${ALLOWED_TIER_NAMES.join(', ')})`);
  if (!VALID_SEVERITIES.has(fm.severity)) errs.push(`severity '${fm.severity}' unknown (allowed: ${[...VALID_SEVERITIES].join(', ')})`);
  if (!VALID_TYPES.has(fm.type)) errs.push(`type '${fm.type}' unknown (allowed: ${[...VALID_TYPES].join(', ')})`);
  return errs.length ? errs.join('; ') : null;
}

function applyOverlayDefaultsAndValidate(rawFrontmatter, overlay) {
  const merged = { ...rawFrontmatter, ...overlay };
  for (const k of Object.keys(merged)) {
    if (merged[k] === null) delete merged[k];
  }
  const fmWithDefaults = { tier: 'default', severity: 'error', type: 'auto', ...merged };
  const _invalid = validateEffectiveFrontmatter(fmWithDefaults);
  if (_invalid) fmWithDefaults._invalid = _invalid;
  return fmWithDefaults;
}

function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: null, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: null, body: raw };
  const fm = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  return { frontmatter: fm, body };
}

async function loadOne(absPath, idBase, sourceName, source) {
  const raw = await readFile(absPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  if (!frontmatter) return { error: 'no frontmatter' };
  let fm;
  try { fm = parseYaml(frontmatter); }
  catch (e) { return { error: `frontmatter parse: ${e.message}` }; }
  if (!fm?.name || !fm?.triggers) return { error: 'missing name or triggers' };
  // Normalize platform path separators so rule ids are stable across Windows / POSIX
  // ("foo/bar", not "foo\\bar"). On POSIX `sep === '/'` so this is a no-op.
  const relId = idBase.split(sep).join('/').replace(/\.md$/, '');
  const id = sourceName ? `${sourceName}/${relId}` : relId;
  return { rule: { id, source, sourceName, path: absPath, rawFrontmatter: fm, body, _relIdNoExt: relId } };
}

export async function loadRules(repoRoot, config) {
  // Per-call state lives in the return value: plain object (no Map) keyed by rule id.
  // `loadRules` is itself the factory — each call produces a fresh { rules, warnings }.
  const warnings = [];
  const byId = Object.create(null);

  // Local rules
  const localDir = join(repoRoot, '.autoreview/rules');
  try {
    for await (const file of walk({ root: localDir, skipDirs: ['node_modules', '.git', 'dist', 'build'] })) {
      if (!file.endsWith('.md')) continue;
      const rel = relative(localDir, file);
      const r = await loadOne(file, rel, null, 'local');
      if (r.error) { warnings.push(`rule ${rel}: ${r.error}`); continue; }
      const rule = r.rule;
      rule.frontmatter = applyOverlayDefaultsAndValidate(rule.rawFrontmatter, {});
      delete rule.rawFrontmatter;
      delete rule._relIdNoExt;
      byId[rule.id] = rule;
    }
  } catch {
    // local dir missing — OK, no rules
  }

  // Remote rules
  for (const src of config.remote_rules ?? []) {
    const srcPath = src.path === '.' ? '' : (src.path ?? '');
    const base = srcPath
      ? join(repoRoot, '.autoreview/remote_rules', src.name, src.ref, srcPath)
      : join(repoRoot, '.autoreview/remote_rules', src.name, src.ref);
    try {
      for await (const file of walk({ root: base, skipDirs: ['node_modules', '.git', 'dist', 'build'] })) {
        if (!file.endsWith('.md')) continue;
        const rel = relative(base, file);
        const r = await loadOne(file, rel, src.name, 'remote');
        if (r.error) { warnings.push(`remote rule ${src.name}/${rel}: ${r.error}`); continue; }
        // Collision: check if a local rule already occupies the same computed id
        if (r.rule.id in byId) {
          warnings.push(`id collision for ${r.rule.id}: local overrides remote ${src.name}`);
          continue;
        }
        const rule = r.rule;
        const overlay = src.overrides?.[rule._relIdNoExt] ?? {};
        rule.frontmatter = applyOverlayDefaultsAndValidate(rule.rawFrontmatter, overlay);
        delete rule.rawFrontmatter;
        delete rule._relIdNoExt;
        byId[rule.id] = rule;
      }
    } catch (e) {
      warnings.push(`remote source ${src.name} skipped: ${e.message}`);
    }
  }

  const rules = Object.values(byId);
  return { rules, warnings };
}
