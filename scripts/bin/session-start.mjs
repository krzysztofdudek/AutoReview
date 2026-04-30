#!/usr/bin/env node
// scripts/bin/session-start.mjs
import { readFileOrNull, pluginRoot, isMainModule } from '../lib/fs-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { ollamaHasModel } from '../lib/providers/ollama.mjs';
import { syncRuntime } from '../lib/runtime-sync.mjs';
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
  if (!cfgRaw) {
    // Surface an actionable hint the agent can relay to the user.
    stdout.write('[autoreview] plugin is installed but `.autoreview/` does not exist in this repo. Nothing will be reviewed. Invoke the `autoreview:setup` skill (or run `/autoreview:setup`) to scaffold it.\n');
    return 0;
  }

  const root = pluginRoot(import.meta.url, env);

  // Re-copy bundled runtime when the plugin has been upgraded since last init.
  // Pre-commit hooks invoke .autoreview/runtime/bin/validate.mjs — a frozen snapshot —
  // so without this handshake users would keep running old code after every plugin update.
  try {
    const sync = await syncRuntime(cwd, root);
    if (sync.status === 'upgraded') {
      const fromStr = sync.from ?? 'unknown';
      stdout.write(`[autoreview] runtime upgraded ${fromStr} → ${sync.to} (.autoreview/runtime/ refreshed from plugin)\n`);
    }
  } catch (err) {
    stderr.write(`[warn] runtime sync failed: ${err.message}\n`);
  }

  try {
    const cfg = await loadConfig(cwd, { env });
    const p = getProvider(cfg, {});
    const avail = await Promise.race([
      p.isAvailable().catch(() => false),
      new Promise(r => setTimeout(() => r('timeout'), 1000)),
    ]);
    stderr.write(`provider ${p.name}: ${avail === true ? 'reachable' : avail === 'timeout' ? 'timeout' : 'unreachable'}\n`);

    if (p.name === 'ollama' && avail === true) {
      const endpoint = cfg.provider?.ollama?.endpoint ?? 'http://localhost:11434';
      const model = cfg.provider?.ollama?.model ?? 'qwen2.5-coder:7b';
      const hasModel = await ollamaHasModel(endpoint, model);
      if (!hasModel) {
        stderr.write(`[warn] Ollama model '${model}' not pulled — run: ollama pull ${model}\n`);
      }
    }

    try {
      const dirs = await readdir(join(cwd, '.autoreview/remote_rules'));
      stderr.write(`remote rule sources: ${dirs.length}\n`);
    } catch {
      stderr.write('remote rule sources: 0\n');
    }

    const manual = await readFileOrNull(join(root, 'templates/agent-rules.md'));
    if (manual) stdout.write(manual);
  } catch (err) {
    stderr.write(`[warn] session-start: ${err.message}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
