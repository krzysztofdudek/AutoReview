#!/usr/bin/env node
// scripts/bin/check-breadth.mjs
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { parse as parseTrigger, evaluate as evalTrigger, shouldTreatAsNonMatchForContent } from '../lib/trigger-engine.mjs';
import { walk, isBinary, sizeOf, isMainModule } from '../lib/fs-utils.mjs';
import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const { values } = parseArgs(argv);
  const sample = parseInt(values.sample ?? '10', 10);
  let expr;
  let root;
  let cfg = DEFAULT_CONFIG;
  try {
    root = await repoRoot(cwd);
    cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);
  } catch { root = cwd; }
  const walkCap = cfg.review?.walk_file_cap ?? 10000;

  if (values.expr) expr = values.expr;
  else if (values.rule) {
    const { rules } = await loadRules(root, cfg);
    const r = rules.find(r => r.id === values.rule);
    if (!r) { stderr.write(`[error] rule not found: ${values.rule}\n`); return 1; }
    expr = r.frontmatter.triggers;
  } else {
    stderr.write('[error] --expr or --rule required\n'); return 1;
  }

  let ast;
  try { ast = parseTrigger(expr); }
  catch (e) { stderr.write(`[error] trigger parse: ${e.message}\n`); return 1; }

  const matches = [];
  for await (const abs of walk({ root, cap: walkCap, onCapReached: (n) => stderr.write(`[warn] reached walk cap (${n} files)\n`) })) {
    // Normalize to POSIX-style separators so trigger globs and the printed sample
    // are consistent across Windows / POSIX.
    const rel = relative(root, abs).split(sep).join('/');
    const size = await sizeOf(abs);
    const needsContent = /content:/.test(expr);
    let content = '';
    let binary = false;
    if (needsContent) {
      const buf = await readFile(abs).catch(() => null);
      if (!buf) continue;
      binary = isBinary(buf);
      content = buf.toString('utf8');
    }
    const contentForbidden = shouldTreatAsNonMatchForContent(size, binary);
    if (evalTrigger(ast, { path: rel, content, binary: contentForbidden })) matches.push(rel);
  }
  stdout.write(`${matches.length} matches\n`);
  for (const p of matches.slice(0, sample)) stdout.write(`  ${p}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
