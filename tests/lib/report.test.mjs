import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportVerdicts } from '../../scripts/lib/report.mjs';

function captureStderr() {
  const buf = [];
  return { stderr: { write: (s) => buf.push(s) }, get: () => buf.join('') };
}

test('severity: error + fail prints [reject]', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'fail', severity: 'error' }], 'quick', c.stderr);
  assert.match(c.get(), /\[reject\] a\.ts :: r/);
});

test('severity: warning + fail prints [warn]', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'fail', severity: 'warning' }], 'quick', c.stderr);
  assert.match(c.get(), /\[warn\] a\.ts :: r/);
});

test('error verdict prints [error] regardless of severity', () => {
  const c1 = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'error', severity: 'error' }], 'quick', c1.stderr);
  assert.match(c1.get(), /\[error\] a\.ts :: r/);

  const c2 = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'error', severity: 'warning' }], 'quick', c2.stderr);
  assert.match(c2.get(), /\[error\] a\.ts :: r/);
});

test('pass verdict prints [pass]', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'pass', severity: 'error' }], 'quick', c.stderr);
  assert.match(c.get(), /\[pass\] a\.ts :: r/);
});

test('suppressed verdict prints [suppressed]', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'suppressed', severity: 'error' }], 'quick', c.stderr);
  assert.match(c.get(), /\[suppressed\] a\.ts :: r/);
});

test('thinking mode prints reason on next line', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'fail', severity: 'error', reason: 'because X' }], 'thinking', c.stderr);
  assert.match(c.get(), /\[reject\] a\.ts :: r\n\s*reason: because X/);
});

test('quick mode + severity:error fail prints remediation hints', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'fail', severity: 'error' }], 'quick', c.stderr);
  const out = c.get();
  assert.match(out, /why \(Claude Code\)/);
  assert.match(out, /why \(shell\)/);
});

test('quick mode + severity:warning fail does NOT print remediation hints (warning-only)', () => {
  const c = captureStderr();
  reportVerdicts({ path: 'a.ts' }, [{ rule: 'r', verdict: 'fail', severity: 'warning' }], 'quick', c.stderr);
  const out = c.get();
  assert.doesNotMatch(out, /why \(Claude Code\)/);
});
