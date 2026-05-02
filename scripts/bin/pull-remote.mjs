#!/usr/bin/env node
// scripts/bin/pull-remote.mjs
import { join, relative, sep } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { pullSource } from '../lib/remote-rules-pull.mjs';
import { isMainModule } from '../lib/fs-utils.mjs';

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

async function collectRelIds(dir, base) {
  const ids = new Set();
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        for (const id of await collectRelIds(p, base)) ids.add(id);
      } else if (e.name.endsWith('.md')) {
        const rel = relative(base, p).split(sep).join('/').replace(/\.md$/, '');
        ids.add(rel);
      }
    }
  } catch {}
  return ids;
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
  const { positional } = parseArgs(argv);
  const filter = positional[0] ?? null;

  let root;
  try { root = await repoRoot(cwd); }
  catch { stderr.write('[warn] not a git repo\n'); return 0; }

  const cfg = await loadConfig(root, { env }).catch(() => null);
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
      const cacheRoot = join(root, '.autoreview/remote_rules', src.name, src.ref);
      const n = await countMdFiles(cacheRoot);
      totalMd += n;
      succeeded++;
      stdout.write(`  ok (${n} .md files)\n`);
      const overrides = src.overrides ?? {};
      if (Object.keys(overrides).length > 0) {
        const srcPath = src.path === '.' ? '' : (src.path ?? '');
        const base = srcPath ? join(cacheRoot, srcPath) : cacheRoot;
        const present = await collectRelIds(base, base);
        for (const id of Object.keys(overrides)) {
          if (!present.has(id)) {
            stderr.write(`[warn] override for '${src.name}/${id}' but rule absent in fetched ref ${src.ref}\n`);
          }
        }
      }
    } catch (err) {
      stderr.write(`[warn] source ${src.name} failed: ${err.message}\n`);
    }
  }
  stdout.write(`pulled ${succeeded}/${sources.length} sources, ${totalMd} rule files\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
