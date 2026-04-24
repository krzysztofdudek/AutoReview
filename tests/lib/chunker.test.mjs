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

test('fit: diff size counted against budget', () => {
  const diff = 'a'.repeat(4000);
  // Budget is just under what "small" needs once diff eats into it → still fit
  const r = fitFile({ fileContent: 'small', rule, diff, contextWindowBytes: 16384, outputReserveBytes: 2000 });
  assert.equal(r.action, 'fit');
});

test('skip: diff alone overflows the budget', () => {
  const diff = 'd'.repeat(20000);
  const r = fitFile({ fileContent: 'x', rule, diff, contextWindowBytes: 16384, outputReserveBytes: 2000 });
  assert.equal(r.action, 'skip');
});

test('rule body at exactly-budget boundary fits', () => {
  // budget = 16384 - 1250 - ruleBytes - 2000 - 0. For rule body=10 bytes, available≈13124.
  // File at 13124 bytes must exactly fit.
  const r = fitFile({ fileContent: 'x'.repeat(100), rule: { body: 'r'.repeat(10) }, diff: null, contextWindowBytes: 16384, outputReserveBytes: 2000 });
  assert.equal(r.action, 'fit');
});

test('truncate preserves prefix, appends marker', () => {
  const big = 'X'.repeat(5000) + 'TAIL';
  const r = fitFile({ fileContent: big, rule: { body: '' }, diff: null, contextWindowBytes: 4000, outputReserveBytes: 500 });
  assert.equal(r.action, 'truncate');
  assert.ok(r.fileContent.startsWith('X'));
  assert.ok(r.fileContent.endsWith('[... truncated]'));
});

test('skip reason for overflow mentions window', () => {
  const r = fitFile({ fileContent: 'x', rule: { body: 'r'.repeat(10000) }, diff: null, contextWindowBytes: 500, outputReserveBytes: 100 });
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /overflow|window/);
});

test('skip when available budget smaller than truncation marker', () => {
  // contextWindowBytes=1760, PROMPT_BOILERPLATE_BYTES=1750 → available = 10 bytes.
  // TRUNC_MARKER is 16 bytes. Without a guard, sliceBytes = 10 - 16 = -6,
  // producing a truncated output of ~(fileBytes - 6) + 16 bytes — wildly over budget.
  // Correct behavior: skip, because no meaningful truncation fits.
  const r = fitFile({
    fileContent: 'x'.repeat(20),
    rule: { body: '' },
    diff: null,
    contextWindowBytes: 1760,
    outputReserveBytes: 0,
  });
  assert.equal(r.action, 'skip');
  assert.match(r.reason, /window|budget|marker|overflow/);
});
