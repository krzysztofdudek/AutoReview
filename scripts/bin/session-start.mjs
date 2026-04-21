#!/usr/bin/env node
// scripts/bin/session-start.mjs
import { readFileOrNull, pluginRoot } from '../lib/fs-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 0; // hook must never block
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const cfgPath = join(cwd, '.autoreview/config.yaml');
  const cfgRaw = await readFileOrNull(cfgPath);
  if (!cfgRaw) { stderr.write('AutoReview not initialized in this repo\n'); return 0; }

  try {
    const cfg = await loadConfig(cwd);
    const p = getProvider(cfg, {});
    const avail = await Promise.race([
      p.isAvailable().catch(() => false),
      new Promise(r => setTimeout(() => r('timeout'), 1000)),
    ]);
    stderr.write(`provider ${p.name}: ${avail === true ? 'reachable' : avail === 'timeout' ? 'timeout' : 'unreachable'}\n`);

    try {
      const dirs = await readdir(join(cwd, '.autoreview/remote_rules'));
      stderr.write(`remote rule sources: ${dirs.length}\n`);
    } catch {
      stderr.write('remote rule sources: 0\n');
    }

    const root = pluginRoot(import.meta.url, env);
    const manual = await readFileOrNull(join(root, 'templates/agent-rules.md'));
    if (manual) stdout.write(manual);
  } catch (err) {
    stderr.write(`[warn] session-start: ${err.message}\n`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
