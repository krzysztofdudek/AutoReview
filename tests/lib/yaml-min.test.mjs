import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../scripts/lib/yaml-min.mjs';

test('top-level scalars', () => {
  assert.deepEqual(parse('k: v'), { k: 'v' });
  assert.deepEqual(parse('k: "quoted"'), { k: 'quoted' });
  assert.deepEqual(parse("k: 'single'"), { k: 'single' });
  assert.deepEqual(parse('k: 42'), { k: 42 });
  assert.deepEqual(parse('k: true'), { k: true });
  assert.deepEqual(parse('k: null'), { k: null });
});

test('nested 3-level maps', () => {
  const y = `provider:
  anthropic:
    model: haiku`;
  assert.deepEqual(parse(y), { provider: { anthropic: { model: 'haiku' } } });
});

test('comments stripped', () => {
  assert.deepEqual(parse('k: v  # inline'), { k: 'v' });
  assert.deepEqual(parse('# full line\nk: v'), { k: 'v' });
});

test('block list of scalars', () => {
  assert.deepEqual(parse('items:\n  - a\n  - b'), { items: ['a', 'b'] });
});

test('block list of maps', () => {
  const y = `remote_rules:
  - name: foo
    url: "x"
    ref: v1`;
  assert.deepEqual(parse(y), { remote_rules: [{ name: 'foo', url: 'x', ref: 'v1' }] });
});

test('inline list and map', () => {
  assert.deepEqual(parse('a: [1, 2, 3]'), { a: [1, 2, 3] });
  assert.deepEqual(parse('a: {x: 1, y: 2}'), { a: { x: 1, y: 2 } });
});

test('mixed-quote strings with AND/OR operators preserved', () => {
  const y = `triggers: '(path:"src/**" OR content:"@X") AND NOT path:"test/**"'`;
  assert.equal(parse(y).triggers, '(path:"src/**" OR content:"@X") AND NOT path:"test/**"');
});

test('inline map nested in block', () => {
  const y = `context_overrides:
  precommit: { mode: quick, consensus: 1 }`;
  assert.deepEqual(parse(y), { context_overrides: { precommit: { mode: 'quick', consensus: 1 } } });
});

test('anchors throw', () => {
  assert.throws(() => parse('k: &anchor v'), /anchor|unsupported/i);
});

test('folded scalar throws', () => {
  assert.throws(() => parse('k: >\n  folded'), /folded|unsupported/i);
});
