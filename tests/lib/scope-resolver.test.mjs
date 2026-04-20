import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRepo } from './git-helpers.mjs';
import { resolveScope } from '../../scripts/lib/scope-resolver.mjs';

test('staged scope returns added files with staged diff', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'x');
    run('add', 'a.ts');
    const { entries } = await resolveScope({ repoRoot: dir, scope: 'staged' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, 'a.ts');
    assert.ok(entries[0].diff.includes('+x'));
  } finally { await cleanup(); }
});

test('sha scope returns files and diffs from commit', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'v1');
    run('add', 'a.ts');
    run('commit', '-q', '-m', 'add');
    const { entries } = await resolveScope({ repoRoot: dir, sha: 'HEAD' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content.trim(), 'v1');
  } finally { await cleanup(); }
});

test('mutually exclusive: scope + sha throws', async () => {
  await assert.rejects(() => resolveScope({ repoRoot: '/tmp', scope: 'staged', sha: 'HEAD' }), /exclusive|one of/i);
});

test('no scope/sha/files/dir throws', async () => {
  await assert.rejects(() => resolveScope({ repoRoot: '/tmp' }), /required/i);
});

test('staged scope detects binary files via raw buffer', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'bin.dat'), Buffer.concat([Buffer.from('pre\x00post'), Buffer.alloc(100, 'x')]));
    run('add', 'bin.dat');
    const { entries } = await resolveScope({ repoRoot: dir, scope: 'staged' });
    assert.equal(entries[0].binary, true);
  } finally { await cleanup(); }
});

test('staged scope marks text files binary:false', async () => {
  const { dir, run, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'hello');
    run('add', 'a.ts');
    const { entries } = await resolveScope({ repoRoot: dir, scope: 'staged' });
    assert.equal(entries[0].binary, false);
  } finally { await cleanup(); }
});

test('files mode reads explicit paths', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'hello');
    await writeFile(join(dir, 'b.ts'), 'world');
    const { entries } = await resolveScope({ repoRoot: dir, files: ['a.ts', 'b.ts'] });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].content, 'hello');
    assert.equal(entries[1].content, 'world');
  } finally { await cleanup(); }
});
