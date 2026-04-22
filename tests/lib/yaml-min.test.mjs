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

test('literal block scalar | preserves newlines', () => {
  const y = `body: |\n  first line\n  second line`;
  const out = parse(y);
  assert.equal(out.body, 'first line\nsecond line');
});

test('literal scalar at leaf of a nested map', () => {
  const y = `outer:\n  body: |\n    line1\n    line2`;
  const out = parse(y);
  assert.equal(out.outer.body, 'line1\nline2');
});

test('negative integer scalar', () => {
  assert.deepEqual(parse('k: -17'), { k: -17 });
});

test('positive float scalar', () => {
  assert.deepEqual(parse('k: 3.14'), { k: 3.14 });
});

test('tilde as null alias', () => {
  assert.deepEqual(parse('k: ~'), { k: null });
});

test('empty value -> null', () => {
  // "k:" with nothing after becomes a nested-block attempt; empty block yields null.
  const r = parse('k:');
  assert.equal(r.k, null);
});

test('double-quoted escape sequences (\\n, \\")', () => {
  const r = parse('k: "line1\\nline2 \\"quoted\\""');
  assert.equal(r.k, 'line1\nline2 "quoted"');
});

test('single-quoted with doubled quote (YAML escape)', () => {
  const r = parse(`k: 'it''s'`);
  assert.equal(r.k, "it's");
});

test('inline list with bare scalars + mixed types', () => {
  const r = parse('a: [1, "s", true, null]');
  assert.deepEqual(r.a, [1, 's', true, null]);
});

test('inline map nested inside inline list', () => {
  const r = parse('a: [{x: 1}, {y: 2}]');
  assert.deepEqual(r.a, [{ x: 1 }, { y: 2 }]);
});

test('inline map with quoted key containing colon', () => {
  const r = parse('a: {"k:ey": 1}');
  assert.deepEqual(r.a, { 'k:ey': 1 });
});

test('tag !!str is unsupported', () => {
  assert.throws(() => parse('k: !!str v'), /unsupported/i);
});

test('alias * is unsupported', () => {
  assert.throws(() => parse('k: *ref'), /unsupported/i);
});

test('key with leading double-quote', () => {
  const r = parse('"a:b": v');
  assert.deepEqual(r, { 'a:b': 'v' });
});

test('mixed-indent block list (each item with nested map)', () => {
  const y = `items:
  - name: foo
    value: 1
  - name: bar
    value: 2`;
  assert.deepEqual(parse(y), {
    items: [{ name: 'foo', value: 1 }, { name: 'bar', value: 2 }],
  });
});
