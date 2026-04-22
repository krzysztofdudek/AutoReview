import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../scripts/lib/args.mjs';

test('long form with value', () => {
  const r = parseArgs(['--scope', 'staged', 'extra']);
  assert.equal(r.values.scope, 'staged');
  assert.deepEqual(r.positional, ['extra']);
});

test('equals form', () => {
  const r = parseArgs(['--scope=all']);
  assert.equal(r.values.scope, 'all');
});

test('boolean flag', () => {
  const r = parseArgs(['--upgrade'], { booleans: ['upgrade'] });
  assert.equal(r.values.upgrade, true);
});

test('repeated into array when multiple', () => {
  const r = parseArgs(['--files', 'a', '--files', 'b'], { multiple: ['files'] });
  assert.deepEqual(r.values.files, ['a', 'b']);
});

test('-- stops flag parsing', () => {
  const r = parseArgs(['--scope', 'all', '--', '--not-a-flag']);
  assert.deepEqual(r.positional, ['--not-a-flag']);
});

test('aliases short to long', () => {
  const r = parseArgs(['-s', 'all'], { aliases: { s: 'scope' } });
  assert.equal(r.values.scope, 'all');
});

test('alias short form + multiple appends to array', () => {
  const r = parseArgs(['-f', 'a.ts', '-f', 'b.ts'], {
    aliases: { f: 'files' },
    multiple: ['files'],
  });
  assert.deepEqual(r.values.files, ['a.ts', 'b.ts']);
});

test('alias short boolean flag', () => {
  const r = parseArgs(['-v'], { aliases: { v: 'verbose' }, booleans: ['verbose'] });
  assert.equal(r.values.verbose, true);
});

test('long-form equals with embedded = sign preserves RHS', () => {
  const r = parseArgs(['--triggers=content:"foo=bar"']);
  assert.equal(r.values.triggers, 'content:"foo=bar"');
});

test('positional args collected in order around flags', () => {
  const r = parseArgs(['one', '--scope', 'all', 'two', 'three']);
  assert.equal(r.values.scope, 'all');
  assert.deepEqual(r.positional, ['one', 'two', 'three']);
});

test('unknown short flag (no alias) falls through to positional', () => {
  const r = parseArgs(['-x']);
  assert.deepEqual(r.positional, ['-x']);
});

test('repeated long flag without multiple only keeps last', () => {
  const r = parseArgs(['--mode', 'quick', '--mode', 'thinking']);
  assert.equal(r.values.mode, 'thinking');
});

test('missing value for flag (end of args) -> undefined, no crash', () => {
  const r = parseArgs(['--mode']);
  assert.equal(r.values.mode, undefined);
});

test('-- stops parsing, remaining go to positional verbatim', () => {
  const r = parseArgs(['--scope', 'all', '--', '--files', '--rule', 'x']);
  assert.equal(r.values.scope, 'all');
  assert.deepEqual(r.positional, ['--files', '--rule', 'x']);
});

test('multiple with long-form value form', () => {
  const r = parseArgs(['--rule=a', '--rule=b', '--rule', 'c'], { multiple: ['rule'] });
  assert.deepEqual(r.values.rule, ['a', 'b', 'c']);
});
