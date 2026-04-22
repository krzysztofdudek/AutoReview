// tests/e2e/cli-pull-remote.test.mjs — P1..P9: remote rule source pulls.
// Uses a local `file://` git repo as the "remote" — no network required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createEnv, skipUnlessE2E, SCRATCH_ROOT } from './helpers/harness.mjs';
import { tmpdir } from 'node:os';

async function makeRemoteRepo(prefix, files, branch = 'v1.0.0') {
  // A throwaway upstream repo outside REPO_ROOT (so repoRoot walking doesn't find it)
  const dir = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), `ar-remote-${prefix}-`));
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'rem@test');
  run('config', 'user.name', 'rem');
  for (const [rel, body] of files) {
    const abs = join(dir, rel);
    await mkdir(join(dir, rel.replace(/\/[^/]+$/, '')), { recursive: true });
    await writeFile(abs, body);
  }
  run('add', '-A');
  run('commit', '-qm', 'seed');
  run('tag', branch);
  return dir;
}

test('P1 + pull happy path from local file:// url populates rules with sentinel', async (t) => {
  skipUnlessE2E(t);
  const remote = await makeRemoteRepo('p1', [
    ['rules/a.md', '---\nname: "A"\ntriggers: \'dir:"src"\'\n---\nbody-a\n'],
    ['rules/b.md', '---\nname: "B"\ntriggers: \'dir:"src"\'\n---\nbody-b\n'],
  ]);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [
        { name: 'team', url: `file://${remote}`, ref: 'v1.0.0', path: 'rules' },
      ],
    });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /pulled 1\/1/);
    // Pull preserves `path` layout: files land at <target>/<path>/, matching rule-loader base.
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/rules/a.md'));
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/rules/b.md'));
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/.autoreview-managed'));
  } finally {
    await env.cleanup();
    await (await import('node:fs/promises')).rm(remote, { recursive: true, force: true });
  }
});

test('P2 + <name> positional filters to one source', async (t) => {
  skipUnlessE2E(t);
  const rA = await makeRemoteRepo('p2a', [['rules/a.md', '---\nname:"A"\ntriggers:\'dir:"x"\'\n---\nx\n']]);
  const rB = await makeRemoteRepo('p2b', [['rules/b.md', '---\nname:"B"\ntriggers:\'dir:"x"\'\n---\nx\n']]);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [
        { name: 'alpha', url: `file://${rA}`, ref: 'v1.0.0', path: 'rules' },
        { name: 'beta',  url: `file://${rB}`, ref: 'v1.0.0', path: 'rules' },
      ],
    });
    const r = await env.run('pull-remote', ['alpha']);
    assert.equal(r.code, 0);
    assert.ok(env.exists('.autoreview/remote_rules/alpha/v1.0.0'));
    assert.ok(!env.exists('.autoreview/remote_rules/beta/v1.0.0'));
  } finally {
    await env.cleanup();
    const { rm } = await import('node:fs/promises');
    await rm(rA, { recursive: true, force: true });
    await rm(rB, { recursive: true, force: true });
  }
});

test('P3 + re-run is idempotent (wipes + re-populates)', async (t) => {
  skipUnlessE2E(t);
  const remote = await makeRemoteRepo('p3', [['rules/a.md', 'body']]);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 'team', url: `file://${remote}`, ref: 'v1.0.0', path: 'rules' }],
    });
    const r1 = await env.run('pull-remote', []);
    assert.equal(r1.code, 0);
    const r2 = await env.run('pull-remote', []);
    assert.equal(r2.code, 0);
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/rules/a.md'));
  } finally {
    await env.cleanup();
    await (await import('node:fs/promises')).rm(remote, { recursive: true, force: true });
  }
});

test('P4 + stdout reports .md file count', async (t) => {
  skipUnlessE2E(t);
  const remote = await makeRemoteRepo('p4', [
    ['rules/a.md', 'body'], ['rules/b.md', 'body'], ['rules/c.md', 'body'],
  ]);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 't', url: `file://${remote}`, ref: 'v1.0.0', path: 'rules' }],
    });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /3 \.md files/);
  } finally {
    await env.cleanup();
    await (await import('node:fs/promises')).rm(remote, { recursive: true, force: true });
  }
});

test('P5 - unknown <name> -> [warn] no matching source, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({ remote_rules: [] });
    const r = await env.run('pull-remote', ['nope']);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /no remote sources/);
  } finally { await env.cleanup(); }
});

test('P6 - url starting with dash rejected at config-load time', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 'evil', url: '--upload-pack=evil', ref: 'v1', path: '.' }],
    });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    // Current behavior: config-loader throws, pull-remote treats it as "not initialized".
    assert.match(r.stderr, /\[warn\]/);
    assert.ok(!env.exists('.autoreview/remote_rules/evil'));
  } finally { await env.cleanup(); }
});

test('P7 - ref path traversal rejected at config-load time', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 'bad', url: 'https://example.com/x.git', ref: '../../etc', path: '.' }],
    });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\]/);
    assert.ok(!env.exists('.autoreview/remote_rules/bad'));
  } finally { await env.cleanup(); }
});

test('P8 - unsupported URL scheme rejected', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 'ftp', url: 'ftp://example.com/x.git', ref: 'v1', path: '.' }],
    });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\] source ftp failed/);
  } finally { await env.cleanup(); }
});

test('P-sentinel + existing target without sentinel + non-md files -> refuse to wipe', async (t) => {
  skipUnlessE2E(t);
  const remote = await makeRemoteRepo('psent', [['rules/a.md', 'body']]);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({
      remote_rules: [{ name: 'team', url: `file://${remote}`, ref: 'v1.0.0', path: 'rules' }],
    });
    // Pre-seed target dir with a non-managed NON-md file — pull must refuse to nuke it.
    const { mkdir, writeFile } = await import('node:fs/promises');
    const target = `${env.dir}/.autoreview/remote_rules/team/v1.0.0`;
    await mkdir(target, { recursive: true });
    await writeFile(`${target}/mysecret.txt`, 'hands off');

    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\] source team failed.*refuse wipe|non-md/i);
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/mysecret.txt'), 'must not be wiped');
  } finally {
    await env.cleanup();
    await (await import('node:fs/promises')).rm(remote, { recursive: true, force: true });
  }
});

test('P9 + empty remote_rules config -> [warn], exit 0, no action', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pr');
  try {
    await env.writeConfig({ remote_rules: [] });
    const r = await env.run('pull-remote', []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /no remote sources/);
  } finally { await env.cleanup(); }
});
