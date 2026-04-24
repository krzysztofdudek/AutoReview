// scripts/lib/runtime-sync.mjs
// Keeps .autoreview/runtime/ in sync with the installed plugin version.
// The runtime is a bundled copy of scripts/lib + scripts/bin/validate.mjs so that
// pre-commit hooks work without CLAUDE_PLUGIN_ROOT (shell, CI, or another dev's
// clone). When the plugin itself is upgraded, the bundled copy must be re-copied;
// this module handles that handshake via a `.version` sentinel file.

import { cp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function readOrNull(path) {
  try { return await readFile(path, 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

async function dirExists(path) {
  try { return (await stat(path)).isDirectory(); }
  catch { return false; }
}

async function readPluginVersion(pluginRoot) {
  const raw = await readOrNull(join(pluginRoot, '.claude-plugin/plugin.json'));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch { return null; }
}

async function readRuntimeVersion(repoRoot) {
  const raw = await readOrNull(join(repoRoot, '.autoreview/runtime/.version'));
  return raw ? raw.trim() : null;
}

async function copyRuntime(pluginRoot, repoRoot, version) {
  const dst = join(repoRoot, '.autoreview/runtime');
  // Fresh copy: wipe any stale files the old version left behind (renamed modules,
  // deleted providers, etc.). The sentinel is rewritten last so a crash mid-copy
  // leaves a missing/old sentinel and the next run retries.
  await rm(dst, { recursive: true, force: true });
  await mkdir(join(dst, 'bin'), { recursive: true });
  await cp(join(pluginRoot, 'scripts/lib'), join(dst, 'lib'), { recursive: true });
  await cp(join(pluginRoot, 'scripts/bin/validate.mjs'), join(dst, 'bin/validate.mjs'));
  await writeFile(join(dst, '.version'), `${version}\n`);
}

/**
 * Bring .autoreview/runtime/ in line with the installed plugin.
 *
 * Returns one of:
 *  - { status: 'no-autoreview' }                        — repo never ran `init`; nothing to do.
 *  - { status: 'unknown-plugin' }                       — plugin manifest missing/unreadable.
 *  - { status: 'up-to-date', version }                  — sentinel matches plugin version.
 *  - { status: 'upgraded', from, to }                   — runtime re-copied; sentinel updated.
 */
export async function syncRuntime(repoRoot, pluginRoot) {
  if (!(await dirExists(join(repoRoot, '.autoreview')))) {
    return { status: 'no-autoreview' };
  }
  const pluginVersion = await readPluginVersion(pluginRoot);
  if (!pluginVersion) return { status: 'unknown-plugin' };

  const runtimeVersion = await readRuntimeVersion(repoRoot);
  if (runtimeVersion === pluginVersion) {
    return { status: 'up-to-date', version: pluginVersion };
  }

  await copyRuntime(pluginRoot, repoRoot, pluginVersion);
  return { status: 'upgraded', from: runtimeVersion, to: pluginVersion };
}
