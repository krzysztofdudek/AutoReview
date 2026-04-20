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
