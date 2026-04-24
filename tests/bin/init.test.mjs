import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, stat, readFile, chmod, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { run } from '../../scripts/bin/init.mjs';

function spinHttpServer(routes) {
  return new Promise(resolve => {
    const s = createServer((req, res) => {
      const r = routes[req.url];
      if (!r) { res.writeHead(404); res.end(); return; }
      r(req, res);
    });
    s.listen(0, () => resolve({ port: s.address().port, close: () => new Promise(r => s.close(r)) }));
  });
}

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
  const cleanup = () => rm(dir, { recursive: true, force: true });
  // Template files
  await writeFile(join(dir, 'templates/config-repo.yaml'), 'version: "0.1"\nprovider:\n  active: ollama\n');
  await writeFile(join(dir, 'templates/config-personal.yaml'), '# personal\n');
  await writeFile(join(dir, 'templates/config-secrets.yaml'), '# secrets\n');
  await writeFile(join(dir, 'templates/example-rule.md'), '---\nname: "Example"\ntriggers: \'path:"**"\'\n---\nbody');
  await writeFile(join(dir, 'templates/precommit-hook.sh'), '#!/usr/bin/env sh\nexec node "$(git rev-parse --show-toplevel)/.autoreview/runtime/bin/validate.mjs" --scope staged --context precommit "$@"\n');
  // Minimal scripts/lib + bin to copy into runtime
  await writeFile(join(dir, 'scripts/lib/dummy.mjs'), 'export const x = 1;\n');
  await writeFile(join(dir, 'scripts/bin/validate.mjs'), 'export const run = () => 0;\n');
  return { dir, cleanup };
}

test('init --provider ollama scaffolds .autoreview and precommit when --install-precommit passed', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
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
    await cleanupPlugin();
  }
});

test('init without --install-precommit does NOT create pre-commit hook', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
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
    await cleanupPlugin();
  }
});

test('re-running without --upgrade is a no-op warning', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  try {
    const c1 = capture();
    await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c1 });
    const c2 = capture();
    const code = await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c2 });
    assert.equal(code, 0);
    assert.match(c2.err(), /already exists/);
  } finally {
    await cleanup();
    await cleanupPlugin();
  }
});

test('existing different pre-commit hook without flag exits 1', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  try {
    await writeFile(join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\n# custom hook\n');
    await chmod(join(dir, '.git/hooks/pre-commit'), 0o755);
    const c = capture();
    const code = await run(['--provider', 'ollama', '--install-precommit'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--precommit-(overwrite|skip|append)/);
  } finally {
    await cleanup();
    await cleanupPlugin();
  }
});

test('.autoreview/.gitignore written; root .gitignore untouched', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  try {
    // User may already have a root .gitignore with their own entries. init must not touch it.
    await writeFile(join(dir, '.gitignore'), 'dist/\nuser-only-line\n');
    const c = capture();
    await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c });
    const rootGi = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.equal(rootGi, 'dist/\nuser-only-line\n', 'root .gitignore must be left alone');
    const localGi = await readFile(join(dir, '.autoreview/.gitignore'), 'utf8');
    assert.match(localGi, /^config\.personal\.yaml$/m);
    assert.match(localGi, /^config\.secrets\.yaml$/m);
    assert.match(localGi, /^\.history\/$/m);
    assert.match(localGi, /^runtime\/$/m);
  } finally {
    await cleanup();
    await cleanupPlugin();
  }
});

test('.autoreview/.gitignore rewritten idempotently on --upgrade', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  try {
    const c1 = capture();
    await run(['--provider', 'ollama'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c1 });
    const c2 = capture();
    await run(['--provider', 'ollama', '--upgrade'], { cwd: dir, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir }, ...c2 });
    const body = await readFile(join(dir, '.autoreview/.gitignore'), 'utf8');
    assert.equal((body.match(/^runtime\/$/gm) || []).length, 1);
  } finally {
    await cleanup();
    await cleanupPlugin();
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
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
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
    await cleanupPlugin();
  }
});

test('init auto-pulls remote_rules declared in template', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
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
    // Remote rule cache should exist after init. pullSource preserves `path` layout.
    await stat(join(dir, '.autoreview/remote_rules/shared/v1/rules/a.md'));
  } finally {
    await cleanup();
    await cleanupPlugin();
    await rm(remoteDir, { recursive: true, force: true });
  }
});


test('init emits pull command when ollama model missing', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  const { port, close } = await spinHttpServer({
    '/api/tags': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ models: [] })); },
  });
  try {
    const c = capture();
    const code = await run(['--provider', 'ollama'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, OLLAMA_HOST: `http://127.0.0.1:${port}` },
      ...c,
    });
    assert.equal(code, 0);
    assert.match(c.out(), /ollama pull qwen2.5-coder:7b/);
  } finally {
    await cleanup();
    await cleanupPlugin();
    await close();
  }
});

test('init emits no pull hint when ollama model is already present', async () => {
  const { dir, cleanup } = await mkRepo();
  const { dir: pluginDir, cleanup: cleanupPlugin } = await mkPluginRoot();
  const { port, close } = await spinHttpServer({
    '/api/tags': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] })); },
  });
  try {
    const c = capture();
    const code = await run(['--provider', 'ollama'], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, OLLAMA_HOST: `http://127.0.0.1:${port}` },
      ...c,
    });
    assert.equal(code, 0);
    assert.doesNotMatch(c.out(), /\[next-step\].*ollama pull/);
  } finally {
    await cleanup();
    await cleanupPlugin();
    await close();
  }
});
