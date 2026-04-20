#!/usr/bin/env node
// scripts/bin/pull-remote.mjs
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { pullSource } from '../lib/remote-rules-pull.mjs';

async function countMdFiles(dir) {
  let n = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) n += await countMdFiles(p);
      else if (e.name.endsWith('.md')) n++;
    }
  } catch {}
  return n;
}

export async function run(argv, { cwd, env, stdout, stderr }) {
  const { positional } = parseArgs(argv);
  const filter = positional[0] ?? null;

  let root;
  try { root = await repoRoot(cwd); }
  catch { stderr.write('[warn] not a git repo\n'); return 0; }

  const cfg = await loadConfig(root).catch(() => null);
  if (!cfg) { stderr.write('[warn] autoreview not initialized\n'); return 0; }

  const sources = (cfg.remote_rules ?? []).filter(s => !filter || s.name === filter);
  if (sources.length === 0) {
    stderr.write(`[warn] no remote sources${filter ? ` matching '${filter}'` : ''}\n`);
    return 0;
  }

  let succeeded = 0;
  let totalMd = 0;
  for (const src of sources) {
    try {
      stdout.write(`pulling ${src.name} from ${src.url}@${src.ref}...\n`);
      await pullSource({ repoRoot: root, source: src, env });
      const n = await countMdFiles(join(root, '.autoreview/remote_rules', src.name, src.ref));
      totalMd += n;
      succeeded++;
      stdout.write(`  ok (${n} .md files)\n`);
    } catch (err) {
      stderr.write(`[warn] source ${src.name} failed: ${err.message}\n`);
    }
  }
  stdout.write(`pulled ${succeeded}/${sources.length} sources, ${totalMd} rule files\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
