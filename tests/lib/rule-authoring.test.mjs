import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderRule, saveRule } from '../../scripts/lib/rule-authoring.mjs';

test('renderRule emits mandatory name + triggers frontmatter', () => {
  const out = renderRule({ name: 'Test', triggers: 'path:"**/*.ts"', body: 'hello' });
  assert.match(out, /^---\n/);
  assert.match(out, /name: "Test"/);
  assert.match(out, /triggers: 'path:"\*\*\/\*\.ts"'/);
  assert.match(out, /hello/);
});

test('renderRule escapes double quotes in name', () => {
  const out = renderRule({ name: 'has "quotes"', triggers: 'dir:"src"', body: '' });
  assert.match(out, /name: "has \\"quotes\\""/);
});

test('renderRule doubles single quotes in triggers', () => {
  const out = renderRule({ name: 'X', triggers: `content:"it's"`, body: '' });
  assert.match(out, /triggers: 'content:"it''s"'/);
});

test('renderRule includes optional fields when present', () => {
  const out = renderRule({
    name: 'X', triggers: 'dir:"."',
    intent: 'detect bugs', description: 'desc',
    provider: 'anthropic', model: 'claude-haiku',
    body: 'body',
  });
  assert.match(out, /intent: "detect bugs"/);
  assert.match(out, /description: "desc"/);
  assert.match(out, /provider: anthropic/);
  assert.match(out, /model: claude-haiku/);
});

test('renderRule omits optional fields when absent', () => {
  const out = renderRule({ name: 'X', triggers: 'dir:"."', body: '' });
  assert.doesNotMatch(out, /intent:/);
  assert.doesNotMatch(out, /description:/);
  assert.doesNotMatch(out, /provider:/);
  assert.doesNotMatch(out, /model:/);
});

test('saveRule writes file under .autoreview/rules/', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-auth-'));
  try {
    const abs = await saveRule({ repoRoot: dir, relativePath: 'a.md', content: 'x' });
    assert.ok(abs.endsWith('.autoreview/rules/a.md'));
    const body = await readFile(abs, 'utf8');
    assert.equal(body, 'x');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveRule creates intermediate directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-auth-'));
  try {
    const abs = await saveRule({ repoRoot: dir, relativePath: 'a/b/c.md', content: 'x' });
    assert.ok(abs.endsWith('a/b/c.md'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('saveRule rejects empty relativePath', async () => {
  await assert.rejects(
    saveRule({ repoRoot: '/tmp', relativePath: '', content: 'x' }),
    /non-empty/,
  );
});

test('saveRule rejects non-string relativePath', async () => {
  await assert.rejects(
    saveRule({ repoRoot: '/tmp', relativePath: null, content: 'x' }),
    /non-empty/,
  );
});

test('saveRule rejects absolute relativePath', async () => {
  await assert.rejects(
    saveRule({ repoRoot: '/tmp', relativePath: '/etc/evil.md', content: 'x' }),
    /not be absolute/,
  );
});

test('saveRule rejects path traversal (..)', async () => {
  await assert.rejects(
    saveRule({ repoRoot: '/tmp', relativePath: '../evil.md', content: 'x' }),
    /\.\./,
  );
});

test('saveRule rejects nested traversal (foo/../../bar)', async () => {
  await assert.rejects(
    saveRule({ repoRoot: '/tmp', relativePath: 'foo/../../bar.md', content: 'x' }),
    /\.\./,
  );
});
