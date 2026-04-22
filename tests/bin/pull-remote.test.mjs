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
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  await mkdir(join(dir, 'rules'), { recursive: true });
  await writeFile(join(dir, 'rules/a.md'), '---\nname: A\ntriggers: \'path:"**"\'\n---\nbody');
  run('add', '.');
  run('commit', '-q', '-m', 'init');
  run('tag', 'v1');
  return { dir, run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function mkUserRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-user-'));
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  run('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('pullSource: fresh pull creates target + sentinel', async () => {
  const { dir: remote, cleanup: cleanupRemote } = await mkFakeRemote();
  const { dir: user, cleanup: cleanupUser } = await mkUserRepo();
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
    await cleanupRemote();
    await cleanupUser();
  }
});

test('pullSource: re-pull with sentinel wipes and replaces', async () => {
  const { dir: remote, cleanup: cleanupRemote } = await mkFakeRemote();
  const { dir: user, cleanup: cleanupUser } = await mkUserRepo();
  try {
    const src = { name: 'shared', url: remote, ref: 'v1', path: 'rules' };
    await pullSource({ repoRoot: user, source: src });
    // Second pull should succeed without error
    await pullSource({ repoRoot: user, source: src });
    const target = join(user, '.autoreview/remote_rules/shared/v1');
    const s = await stat(join(target, '.autoreview-managed'));
    assert.ok(s.isFile());
  } finally {
    await cleanupRemote();
    await cleanupUser();
  }
});

test('pullSource: pre-existing non-md content refuses wipe', async () => {
  const { dir: user, cleanup: cleanupUser } = await mkUserRepo();
  const target = join(user, '.autoreview/remote_rules/shared/v1');
  try {
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'secret.json'), '{}');
    await assert.rejects(
      () => pullSource({ repoRoot: user, source: { name: 'shared', url: '/nowhere', ref: 'v1', path: '.' } }),
      /refuse wipe|non-md/,
    );
  } finally { await cleanupUser(); }
});

test('run(): no sources warns cleanly', async () => {
  const { dir: user, cleanup: cleanupUser } = await mkUserRepo();
  try {
    await mkdir(join(user, '.autoreview'), { recursive: true });
    await writeFile(join(user, '.autoreview/config.yaml'), 'provider:\n  active: ollama\n');
    const c = capture();
    const code = await run([], { cwd: user, env: process.env, ...c });
    assert.equal(code, 0);
    assert.match(c.err(), /no remote sources/);
  } finally { await cleanupUser(); }
});
