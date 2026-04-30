import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute, sep } from 'node:path';
import { readFileOrNull, writeAtomic, isBinary, walk, readGitignore, pluginRoot, sizeOf } from '../../scripts/lib/fs-utils.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

// Normalise path strings to forward slashes for cross-platform string assertions.
const posix = (p) => p.split(sep).join('/');

test('readFileOrNull returns null for missing path', async () => {
  assert.equal(await readFileOrNull('/no/such/path/xyz'), null);
});

test('readFileOrNull returns content for existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-'));
  try {
    const p = join(dir, 'a.txt');
    await writeAtomic(p, 'hello');
    assert.equal(await readFileOrNull(p), 'hello');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeAtomic renames tmp to target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-'));
  try {
    const p = join(dir, 'out.txt');
    await writeAtomic(p, 'data');
    assert.equal(await readFile(p, 'utf8'), 'data');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isBinary detects NUL byte', () => {
  assert.equal(isBinary(Buffer.from('hello\x00world')), true);
  assert.equal(isBinary(Buffer.from('plain text')), false);
});

async function mkFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-walk-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'dist'), { recursive: true });
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await writeFile(join(dir, 'src/a.ts'), 'a');
  await writeFile(join(dir, 'src/b.ts'), 'b');
  await writeFile(join(dir, 'dist/c.js'), 'c');
  await writeFile(join(dir, 'node_modules/d.js'), 'd');
  await writeFile(join(dir, '.gitignore'), 'dist/\n');
  return dir;
}

test('walk yields src files, skips node_modules + dist', async () => {
  const dir = await mkFixture();
  try {
    const paths = [];
    for await (const p of walk({ root: dir, skipDirs: ['node_modules', '.git'] })) {
      // Normalise to POSIX so the string assertions below work on Windows too.
      paths.push(posix(p.replace(dir, '')));
    }
    assert.ok(paths.includes('/src/a.ts'));
    assert.ok(paths.includes('/src/b.ts'));
    assert.ok(!paths.some(p => p.startsWith('/node_modules')));
    assert.ok(!paths.some(p => p.startsWith('/dist')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gitignore unanchored pattern matches any path segment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-gi-'));
  try {
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'a.log'), 'x');
    await writeFile(join(dir, 'sub/b.log'), 'y');
    await writeFile(join(dir, 'keep.ts'), 'z');
    await writeFile(join(dir, '.gitignore'), '*.log\n');
    const paths = [];
    for await (const p of walk({ root: dir })) paths.push(posix(p.replace(dir, '')));
    assert.ok(paths.includes('/keep.ts'));
    assert.ok(!paths.some(p => p.endsWith('.log')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('walk stops at cap and calls onCapReached', async () => {
  const dir = await mkFixture();
  try {
    let hit = false;
    const paths = [];
    for await (const p of walk({ root: dir, cap: 1, onCapReached: () => { hit = true; } })) {
      paths.push(p);
    }
    assert.equal(paths.length, 1);
    assert.equal(hit, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pluginRoot honors CLAUDE_PLUGIN_ROOT env var', () => {
  assert.equal(pluginRoot(import.meta.url, { CLAUDE_PLUGIN_ROOT: '/custom/path' }), '/custom/path');
});

test('pluginRoot falls back to three dirs up from caller', () => {
  // Caller is tests/lib/fs-utils.test.mjs. Three dirs up == worktree root.
  const r = pluginRoot(import.meta.url, {});
  // Must be a non-empty absolute path AND must not include `tests/lib`.
  // Use platform-aware checks so Windows backslash paths pass too.
  assert.ok(isAbsolute(r));
  assert.ok(!posix(r).includes('tests/lib'));
  assert.ok(!posix(r).includes('scripts'));
});

test('sizeOf returns byte size for existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-'));
  try {
    const p = join(dir, 'a.txt');
    await writeAtomic(p, 'hello');
    assert.equal(await sizeOf(p), 5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sizeOf returns -1 for missing path', async () => {
  assert.equal(await sizeOf('/no/such/path/xyz'), -1);
});
