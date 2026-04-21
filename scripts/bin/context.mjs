#!/usr/bin/env node
// scripts/bin/context.mjs
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { parse as parseTrigger, evaluate as evalTrigger, shouldTreatAsNonMatchForContent } from '../lib/trigger-engine.mjs';
import { isBinary } from '../lib/fs-utils.mjs';

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
    const cfg = await loadConfig(root).catch(() => DEFAULT_CONFIG);
    const { rules } = await loadRules(root, cfg);
    if (rules.length === 0) {
      stdout.write('No rules loaded.\n');
      return 0;
    }
    stdout.write(`All rules (${rules.length}):\n`);
    for (const r of rules) {
      const desc = r.frontmatter.description ?? r.frontmatter.name ?? '';
      stdout.write(`- ${r.id}: ${desc}\n`);
    }
    return 0;
  }

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const cfg = await loadConfig(root).catch(() => DEFAULT_CONFIG);
  const { rules, warnings } = await loadRules(root, cfg);
  for (const w of warnings) stderr.write(`[warn] ${w}\n`);

  const absTarget = resolve(cwd, target);
  const relTarget = absTarget.startsWith(root + '/') ? absTarget.slice(root.length + 1) : target;
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
    const desc = r.frontmatter.description ?? r.frontmatter.name ?? r.id;
    stdout.write(`- ${r.id}: ${desc} — read: ${r.path}\n`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
