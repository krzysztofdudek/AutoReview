import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { makeRepo } from './git-helpers.mjs';
import { repoRoot, stagedPaths, diffStaged, actorContext, gitUserEmail, _resetActorCache } from '../../scripts/lib/git-utils.mjs';

// Compare paths regardless of platform separator. Git outputs forward-slash paths
// on Windows; mkdtemp uses backslash. Normalise both before equality checks.
const posix = (p) => p.split(sep).join('/');

test('repoRoot returns absolute path', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    // macOS mkdtemp may return `/var/folders/...` that resolves to `/private/var/folders/...` via git.
    // Accept either form, and accept either path separator (Windows vs POSIX).
    const root = await repoRoot(dir);
    const rootP = posix(root);
    const dirP = posix(dir);
    assert.ok(rootP === dirP || rootP === `/private${dirP}`);
  } finally { await cleanup(); }
});

test('stagedPaths lists added files', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'x');
    run('add', 'a.ts');
    const paths = await stagedPaths(dir);
    assert.deepEqual(paths, ['a.ts']);
  } finally { await cleanup(); }
});

test('diffStaged returns unified diff', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'line1\nline2\n');
    run('add', 'a.ts');
    const d = await diffStaged(dir, 'a.ts');
    assert.ok(d.includes('+line1'));
    assert.ok(d.includes('+line2'));
  } finally { await cleanup(); }
});

import { commitFiles, fileAtCommit, resolveSha } from '../../scripts/lib/git-utils.mjs';

test('commitFiles + fileAtCommit reproduce committed content', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'v1');
    run('add', 'a.ts');
    run('commit', '-m', 'add a', '-q');
    const files = await commitFiles(dir, 'HEAD');
    assert.deepEqual(files, ['a.ts']);
    assert.equal((await fileAtCommit(dir, 'HEAD', 'a.ts')).trim(), 'v1');
  } finally { await cleanup(); }
});

test('commitFiles excludes deleted paths', async () => {
  const { rm } = await import('node:fs/promises');
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'gone.ts'), 'will-die');
    run('add', 'gone.ts');
    run('commit', '-m', 'add gone', '-q');
    await rm(join(dir, 'gone.ts'));
    await writeFile(join(dir, 'kept.ts'), 'survives');
    run('add', '-A');
    run('commit', '-m', 'rm gone, add kept', '-q');
    const files = await commitFiles(dir, 'HEAD');
    assert.deepEqual(files, ['kept.ts'], 'deleted paths must not appear — fileAtCommit would fail on them');
  } finally { await cleanup(); }
});

test('resolveSha translates ref to SHA', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const sha = await resolveSha(dir, 'HEAD');
    assert.match(sha, /^[0-9a-f]{40}$/);
  } finally { await cleanup(); }
});

import { installPrecommit, gitignoreEnsure } from '../../scripts/lib/git-utils.mjs';

test('installPrecommit creates executable hook', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const status = await installPrecommit(dir, '#!/bin/sh\nexit 0\n');
    assert.equal(status, 'installed');
    const body = await readFile(join(dir, '.git/hooks/pre-commit'), 'utf8');
    assert.ok(body.startsWith('#!/bin/sh'));
  } finally { await cleanup(); }
});

test('installPrecommit returns exists-identical for same body', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await installPrecommit(dir, '#!/bin/sh\nexit 0\n');
    const status = await installPrecommit(dir, '#!/bin/sh\nexit 0\n');
    assert.equal(status, 'exists-identical');
  } finally { await cleanup(); }
});

test('installPrecommit returns exists-different for different body', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await installPrecommit(dir, '#!/bin/sh\nexit 0\n');
    const status = await installPrecommit(dir, '#!/bin/sh\nexit 1\n');
    assert.equal(status, 'exists-different');
  } finally { await cleanup(); }
});

test('gitignoreEnsure is idempotent', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await gitignoreEnsure(dir, ['.autoreview/history/', '.autoreview/runtime/']);
    await gitignoreEnsure(dir, ['.autoreview/history/']);
    const body = await readFile(join(dir, '.gitignore'), 'utf8');
    assert.equal((body.match(/\.autoreview\/history\//g) || []).length, 1);
  } finally { await cleanup(); }
});

test('gitUserEmail returns configured email', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    run('config', 'user.email', 'test@example.com');
    assert.equal(await gitUserEmail(dir), 'test@example.com');
  } finally { await cleanup(); }
});

test('gitUserEmail returns null when unconfigured and no global fallback', async () => {
  // Use an empty tmp dir (not a git repo) — gitUserEmail swallows errors.
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'ar-noemail-'));
  try {
    const v = await gitUserEmail(dir);
    // Could be null (no git repo, no config). Either way shouldn't throw.
    assert.ok(v === null || typeof v === 'string');
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  }
});

test('actorContext gathers actor + host + ci_run_id', async () => {
  _resetActorCache();
  const { dir, run, cleanup } = await makeRepo();
  try {
    run('config', 'user.email', 'ci@test');
    const ctx = await actorContext(dir, { GITHUB_RUN_ID: '12345' });
    assert.equal(ctx.actor, 'ci@test');
    assert.ok(ctx.host); // hostname always returns something
    assert.equal(ctx.ci_run_id, '12345');
  } finally { await cleanup(); }
});

test('actorContext caches per-cwd', async () => {
  _resetActorCache();
  const { dir, run, cleanup } = await makeRepo();
  try {
    run('config', 'user.email', 'cache@test');
    const ctx1 = await actorContext(dir, {});
    // Change email AFTER first resolution. Cache should keep the old value.
    run('config', 'user.email', 'changed@test');
    const ctx2 = await actorContext(dir, {});
    assert.equal(ctx1.actor, 'cache@test');
    assert.equal(ctx2.actor, 'cache@test');
  } finally { await cleanup(); }
});

test('actorContext ci_run_id falls through multiple env vars', async () => {
  _resetActorCache();
  const { dir, cleanup } = await makeRepo();
  try {
    const ctx = await actorContext(dir, { CIRCLE_BUILD_NUM: '99' });
    assert.equal(ctx.ci_run_id, '99');
  } finally { await cleanup(); }
});

test('actorContext ci_run_id null when outside CI', async () => {
  _resetActorCache();
  const { dir, cleanup } = await makeRepo();
  try {
    const ctx = await actorContext(dir, {});
    assert.equal(ctx.ci_run_id, null);
  } finally { await cleanup(); }
});

test('actorContext ci_run_id "unknown-ci" when CI=true but no known id var', async () => {
  _resetActorCache();
  const { dir, cleanup } = await makeRepo();
  try {
    const ctx = await actorContext(dir, { CI: 'true' });
    assert.equal(ctx.ci_run_id, 'unknown-ci');
  } finally { await cleanup(); }
});
