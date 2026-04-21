// scripts/lib/rule-loader.mjs
// Load rules from .autoreview/rules/ (local) and .autoreview/remote_rules/<name>/<ref>/<path>/.
// Apply disabled + default:disabled filters per config.

import { readFile } from 'node:fs/promises';
import { relative, join } from 'node:path';
import { walk } from './fs-utils.mjs';
import { parse as parseYaml } from './yaml-min.mjs';

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
  const relId = idBase.replace(/\.md$/, '');
  const id = sourceName ? `${sourceName}/${relId}` : relId;
  return { rule: { id, source, sourceName, path: absPath, frontmatter: fm, body } };
}

export async function loadRules(repoRoot, config) {
  const warnings = [];
  const byId = new Map();

  // Local rules
  const localDir = join(repoRoot, '.autoreview/rules');
  try {
    for await (const file of walk({ root: localDir, skipDirs: ['node_modules', '.git', 'dist', 'build'] })) {
      if (!file.endsWith('.md')) continue;
      const rel = relative(localDir, file);
      const r = await loadOne(file, rel, null, 'local');
      if (r.error) { warnings.push(`rule ${rel}: ${r.error}`); continue; }
      byId.set(r.rule.id, r.rule);
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
        if (byId.has(r.rule.id)) {
          warnings.push(`id collision for ${r.rule.id}: local overrides remote ${src.name}`);
          continue;
        }
        byId.set(r.rule.id, r.rule);
      }
    } catch (e) {
      warnings.push(`remote source ${src.name} skipped: ${e.message}`);
    }
  }

  // Filters
  const disabled = new Set(config.rules?.disabled ?? []);
  const enabledExtra = new Set(config.rules?.enabled_extra ?? []);
  const rules = [];
  for (const r of byId.values()) {
    if (disabled.has(r.id)) continue;
    if (r.frontmatter.default === 'disabled' && !enabledExtra.has(r.id)) continue;
    rules.push(r);
  }

  return { rules, warnings };
}
