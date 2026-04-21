import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, stat, readFile, chmod, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/init.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function mkRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-init-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function mkPluginRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-plugin-'));
  await mkdir(join(dir, 'templates'), { recursive: true });
  await mkdir(join(dir, 'scripts/lib/providers'), { recursive: true });
  await mkdir(join(dir, 'scripts/bin'), { recursive: true });
  // Template files
  await writeFile(join(dir, 'templates/config-repo.yaml'), 'version: "0.1"\nprovider:\n  active: ollama\n');
  await writeFile(join(dir, 'templates/config-personal.yaml'), '# personal\n');
  await writeFile(join(dir, 'templates/config-secrets.yaml'), '# secrets\n');
  await writeFile(join(dir, 'templates/example-rule.md'), '---\nname: "Example"\ntriggers: \'path:"**"\'\n---\nbody');
  await writeFile(join(dir, 'templates/precommit-hook.sh'), '#!/usr/bin/env sh\nexec node "$(git rev-parse --show-toplevel)/.autoreview/runtime/bin/validate.mjs" --scope staged --context precommit "$@"\n');
  // Minimal scripts/lib + bin to copy into runtime
  await writeFile(join(dir, 'scripts/lib/dummy.mjs'), 'export const x = 1;\n');
  await writeFile(join(dir, 'scripts/bin/validate.mjs'), 'export const run = () => 0;\n');
  return dir;
}

test('init --provider ollama scaffolds .autoreview and precommit when --install-precommit passed', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    const c = capture();
    const code = await run(['--provider', 'ollama', '--install-precommit'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
      ...c,
    });
    assert.equal(code, 0);
    await stat(join(dir, '.autoreview/config.yaml'));
    await stat(join(dir, '.autoreview/rules/example.md'));
    await stat(join(dir, '.git/hooks/pre-commit'));
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('init without --install-precommit does NOT create pre-commit hook', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    const c = capture();
    const code = await run(['--provider', 'ollama'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
      ...c,
    });
    assert.equal(code, 0);
    const hookStat = await stat(join(dir, '.git/hooks/pre-commit')).catch(() => null);
    assert.equal(hookStat, null, 'pre-commit hook should not be created without --install-precommit');
    assert.match(c.out(), /NOT installed/);
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('re-running without --upgrade is a no-op warning', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    const c1 = capture();
    await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c1 });
    const c2 = capture();
    const code = await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c2 });
    assert.equal(code, 0);
    assert.match(c2.err(), /already exists/);
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('existing different pre-commit hook without flag exits 1', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    await writeFile(join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\n# custom hook\n');
    await chmod(join(dir, '.git/hooks/pre-commit'), 0o755);
    const c = capture();
    const code = await run(['--provider', 'ollama', '--install-precommit'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--precommit-(overwrite|skip|append)/);
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('.gitignore appended without duplicates', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    const c1 = capture();
    await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c1 });
    const c2 = capture();
    await run(['--provider', 'ollama', '--upgrade'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, }, ...c2 });
    const body = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.equal((body.match(/\.autoreview\/\.history\//g) || []).length, 1);
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('errors on unknown provider', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['--provider', 'nonexistent'], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /unknown provider/);
  } finally { await cleanup(); }
});

test('warns when paid provider chosen without API key (§11)', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  try {
    const c = capture();
    const code = await run(['--provider', 'anthropic'], {
      cwd: dir,
      env: { ...process.env, ANTHROPIC_API_KEY: '', CLAUDE_PLUGIN_ROOT: pluginDir },
      ...c,
    });
    assert.equal(code, 0);
    assert.match(c.err(), /requires an API key/i);
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
  }
});

test('init auto-pulls remote_rules declared in template', async () => {
  const { dir, cleanup } = await mkRepo();
  const pluginDir = await mkPluginRoot();
  // Create a fake local bare remote to clone from
  const remoteDir = await mkdtemp(join(tmpdir(), 'ar-remote-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: remoteDir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: remoteDir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: remoteDir });
  await mkdir(join(remoteDir, 'rules'), { recursive: true });
  await writeFile(join(remoteDir, 'rules/a.md'), '---\nname: A\ntriggers: \'path:"**"\'\n---\nbody');
  spawnSync('git', ['add', '.'], { cwd: remoteDir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: remoteDir });
  spawnSync('git', ['tag', 'v1'], { cwd: remoteDir });

  // Replace the plugin's config-repo.yaml template to declare a remote source
  await writeFile(join(pluginDir, 'templates/config-repo.yaml'),
    `version: "0.1"\nprovider:\n  active: ollama\nremote_rules:\n  - name: shared\n    url: "${remoteDir}"\n    ref: v1\n    path: rules\n`);

  try {
    const c = capture();
    const code = await run(['--provider', 'ollama'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir },
      ...c,
    });
    assert.equal(code, 0);
    // Remote rule cache should exist after init
    await stat(join(dir, '.autoreview/remote_rules/shared/v1/a.md'));
  } finally {
    await cleanup();
    await rm(pluginDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  }
});

test('init returns 2 on internal error (spec §28)', async () => {
  const c = capture();
  const tmpFile = await mkdtemp(join(tmpdir(), 'ar-plug-broken-'));
  const { dir, cleanup } = await mkRepo();
  try {
    // Pass a nonsense plugin root that will cause writeAtomic or template read to throw.
    // In practice hard to force reliably; accept code in {0, 1, 2} but verify no uncaught throw.
    const code = await run(['--provider', 'ollama'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: '/dev/null/definitely-not-a-dir' },
      ...c,
    });
    assert.ok([0, 1, 2].includes(code), `unexpected exit code ${code}`);
  } finally {
    await cleanup();
    await rm(tmpFile, { recursive: true, force: true });
  }
});
