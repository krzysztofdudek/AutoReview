import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRepo } from './git-helpers.mjs';
import { repoRoot, stagedPaths, diffStaged } from '../../scripts/lib/git-utils.mjs';

test('repoRoot returns absolute path', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    // macOS mkdtemp may return `/var/folders/...` that resolves to `/private/var/folders/...` via git.
    // Accept either.
    const root = await repoRoot(dir);
    assert.ok(root === dir || root === `/private${dir}`);
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
