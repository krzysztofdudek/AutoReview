import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pullSource } from '../../scripts/lib/remote-rules-pull.mjs';
import { run } from '../../scripts/bin/pull-remote.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function mkFakeRemote() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-remote-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  await mkdir(join(dir, 'rules'), { recursive: true });
  await writeFile(join(dir, 'rules/a.md'), '---\nname: A\ntriggers: \'path:"**"\'\n---\nbody');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  spawnSync('git', ['tag', 'v1'], { cwd: dir });
  return dir;
}

async function mkUserRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-user-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

test('pullSource: fresh pull creates target + sentinel', async () => {
  const remote = await mkFakeRemote();
  const user = await mkUserRepo();
  try {
    await pullSource({
      repoRoot: user,
      source: { name: 'shared', url: remote, ref: 'v1', path: 'rules' },
    });
    const target = join(user, '.autoreview/remote_rules/shared/v1');
    const s = await stat(target);
    assert.ok(s.isDirectory());
    const sentinel = await readFile(join(target, '.autoreview-managed'), 'utf8');
    assert.match(sentinel, /source:/);
    // pullSource preserves `path` layout: content lives at <target>/<path>/, matching rule-loader base.
    const rule = await readFile(join(target, 'rules/a.md'), 'utf8');
    assert.match(rule, /name: A/);
  } finally {
    await rm(remote, { recursive: true, force: true });
    await rm(user, { recursive: true, force: true });
  }
});

test('pullSource: re-pull with sentinel wipes and replaces', async () => {
  const remote = await mkFakeRemote();
  const user = await mkUserRepo();
  try {
    const src = { name: 'shared', url: remote, ref: 'v1', path: 'rules' };
    await pullSource({ repoRoot: user, source: src });
    // Second pull should succeed without error
    await pullSource({ repoRoot: user, source: src });
    const target = join(user, '.autoreview/remote_rules/shared/v1');
    const s = await stat(join(target, '.autoreview-managed'));
    assert.ok(s.isFile());
  } finally {
    await rm(remote, { recursive: true, force: true });
    await rm(user, { recursive: true, force: true });
  }
});

test('pullSource: pre-existing non-md content refuses wipe', async () => {
  const user = await mkUserRepo();
  const target = join(user, '.autoreview/remote_rules/shared/v1');
  try {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'secret.json'), '{}');
    await assert.rejects(
      () => pullSource({ repoRoot: user, source: { name: 'shared', url: '/nowhere', ref: 'v1', path: '.' } }),
      /refuse wipe|non-md/,
    );
  } finally { await rm(user, { recursive: true, force: true }); }
});

test('run(): no sources warns cleanly', async () => {
  const user = await mkUserRepo();
  try {
    await mkdir(join(user, '.autoreview'), { recursive: true });
    await writeFile(join(user, '.autoreview/config.yaml'), 'provider:\n  active: ollama\n');
    const c = capture();
    const code = await run([], { cwd: user, env: process.env, ...c });
    assert.equal(code, 0);
    assert.match(c.err(), /no remote sources/);
  } finally { await rm(user, { recursive: true, force: true }); }
});
