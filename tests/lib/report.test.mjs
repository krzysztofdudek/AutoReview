import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportVerdicts } from '../../scripts/lib/report.mjs';

function capture() {
  const lines = [];
  return { write: (s) => lines.push(s), lines: () => lines.join('') };
}

const entry = { path: 'src/a.ts' };

test('quick mode emits one line per verdict with correct prefix', () => {
  const c = capture();
  reportVerdicts(entry, [
    { rule: 'r1', verdict: 'pass', reason: null },
    { rule: 'r2', verdict: 'fail', reason: 'missing zod' },
    { rule: 'r3', verdict: 'error', reason: 'provider down' },
  ], 'quick', c);
  const out = c.lines();
  assert.match(out, /\[pass\] src\/a\.ts :: r1/);
  assert.match(out, /\[reject\] src\/a\.ts :: r2/);
  assert.match(out, /\[error\] src\/a\.ts :: r3/);
  assert.ok(!out.includes('reason:'));
});

test('thinking mode appends reason lines for fail/error', () => {
  const c = capture();
  reportVerdicts(entry, [
    { rule: 'r1', verdict: 'fail', reason: 'line 42: no validation' },
  ], 'thinking', c);
  const out = c.lines();
  assert.match(out, /\[reject\] src\/a\.ts :: r1/);
  assert.match(out, /  reason: line 42: no validation/);
});

test('unknown verdict falls back to [error]', () => {
  const c = capture();
  reportVerdicts(entry, [{ rule: 'r1', verdict: 'bogus', reason: null }], 'quick', c);
  assert.match(c.lines(), /\[error\] src\/a\.ts :: r1/);
});
