import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFile } from '../../scripts/lib/chunker.mjs';

const rule = { body: 'short rule' };

test('fit: content within budget', () => {
  const r = fitFile({ fileContent: 'small', rule, diff: null, contextWindowBytes: 16384, outputReserveBytes: 2000 });
  assert.equal(r.action, 'fit');
  assert.equal(r.fileContent, 'small');
});

test('skip: rule + reserve overflow budget', () => {
  const r = fitFile({ fileContent: 'x', rule: { body: 'x'.repeat(100) }, diff: null, contextWindowBytes: 100, outputReserveBytes: 2000 });
  assert.equal(r.action, 'skip');
});

test('truncate: content > available, <= 3x', () => {
  const big = 'a'.repeat(10000);
  const r = fitFile({ fileContent: big, rule, diff: null, contextWindowBytes: 8000, outputReserveBytes: 500 });
  assert.equal(r.action, 'truncate');
  assert.ok(r.fileContent.endsWith('[... truncated]'));
  assert.ok(r.fileContent.length < big.length);
});

test('skip: content > 3x available', () => {
  const huge = 'a'.repeat(100000);
  const r = fitFile({ fileContent: huge, rule, diff: null, contextWindowBytes: 8000, outputReserveBytes: 500 });
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /too large|3x|window|exceeds/);
});
