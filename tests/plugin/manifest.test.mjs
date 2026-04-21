import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('plugin.json has required fields', async () => {
  const raw = await readFile('.claude-plugin/plugin.json', 'utf8');
  const m = JSON.parse(raw);
  assert.ok(m.name);
  assert.ok(m.version);
  assert.ok(m.description);
});

test('plugin.json has extended marketplace fields', async () => {
  const raw = await readFile('.claude-plugin/plugin.json', 'utf8');
  const m = JSON.parse(raw);
  assert.ok(m.homepage);
  assert.ok(m.repository);
  assert.ok(Array.isArray(m.keywords) && m.keywords.length > 0);
});
