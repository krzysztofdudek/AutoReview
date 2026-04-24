import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncRuntime } from '../../scripts/lib/runtime-sync.mjs';

async function mkPluginRoot(version = '0.1.1') {
  const dir = await mkdtemp(join(tmpdir(), 'ar-plugin-'));
  await mkdir(join(dir, '.claude-plugin'), { recursive: true });
  await writeFile(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'autoreview', version }));
  await mkdir(join(dir, 'scripts/lib'), { recursive: true });
  await mkdir(join(dir, 'scripts/bin'), { recursive: true });
  await writeFile(join(dir, 'scripts/lib/marker.mjs'), `export const V = '${version}';\n`);
  await writeFile(join(dir, 'scripts/bin/validate.mjs'), `// validate stub v${version}\n`);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function mkRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-repo-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('no .autoreview/ directory -> status:no-autoreview, no side effects', async () => {
  const repo = await mkRepo();
  const plugin = await mkPluginRoot('0.1.1');
  try {
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'no-autoreview');
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});

test('runtime missing -> status:upgraded, copies runtime and writes version sentinel', async () => {
  const repo = await mkRepo();
  const plugin = await mkPluginRoot('0.1.1');
  try {
    await mkdir(join(repo.dir, '.autoreview'), { recursive: true });
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'upgraded');
    assert.equal(r.from, null);
    assert.equal(r.to, '0.1.1');
    const version = await readFile(join(repo.dir, '.autoreview/runtime/.version'), 'utf8');
    assert.equal(version.trim(), '0.1.1');
    const marker = await readFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'utf8');
    assert.match(marker, /0\.1\.1/);
    const validate = await readFile(join(repo.dir, '.autoreview/runtime/bin/validate.mjs'), 'utf8');
    assert.match(validate, /0\.1\.1/);
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});

test('runtime version matches plugin -> status:up-to-date, no file writes', async () => {
  const repo = await mkRepo();
  const plugin = await mkPluginRoot('0.1.1');
  try {
    await mkdir(join(repo.dir, '.autoreview/runtime/lib'), { recursive: true });
    await writeFile(join(repo.dir, '.autoreview/runtime/.version'), '0.1.1\n');
    await writeFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'ORIGINAL\n');
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'up-to-date');
    // marker must not be overwritten since nothing changed
    const marker = await readFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'utf8');
    assert.equal(marker, 'ORIGINAL\n');
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});

test('runtime version older than plugin -> status:upgraded, overwrites lib + bin, updates sentinel', async () => {
  const repo = await mkRepo();
  const plugin = await mkPluginRoot('0.1.2');
  try {
    await mkdir(join(repo.dir, '.autoreview/runtime/lib'), { recursive: true });
    await mkdir(join(repo.dir, '.autoreview/runtime/bin'), { recursive: true });
    await writeFile(join(repo.dir, '.autoreview/runtime/.version'), '0.1.0\n');
    await writeFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), "export const V = '0.1.0';\n");
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'upgraded');
    assert.equal(r.from, '0.1.0');
    assert.equal(r.to, '0.1.2');
    const marker = await readFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'utf8');
    assert.match(marker, /0\.1\.2/);
    const sentinel = await readFile(join(repo.dir, '.autoreview/runtime/.version'), 'utf8');
    assert.equal(sentinel.trim(), '0.1.2');
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});

test('runtime exists without sentinel -> treated as unknown, upgraded', async () => {
  // Legacy installs: runtime copied before sentinel existed. Treat as stale.
  const repo = await mkRepo();
  const plugin = await mkPluginRoot('0.1.1');
  try {
    await mkdir(join(repo.dir, '.autoreview/runtime/lib'), { recursive: true });
    await writeFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'STALE\n');
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'upgraded');
    assert.equal(r.from, null);
    assert.equal(r.to, '0.1.1');
    const marker = await readFile(join(repo.dir, '.autoreview/runtime/lib/marker.mjs'), 'utf8');
    assert.match(marker, /0\.1\.1/);
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});

test('plugin manifest unreadable -> status:unknown-plugin, no changes', async () => {
  const repo = await mkRepo();
  const plugin = await mkRepo();
  try {
    await mkdir(join(repo.dir, '.autoreview'), { recursive: true });
    const r = await syncRuntime(repo.dir, plugin.dir);
    assert.equal(r.status, 'unknown-plugin');
  } finally { await repo.cleanup(); await plugin.cleanup(); }
});
