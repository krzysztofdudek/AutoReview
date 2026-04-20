import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../scripts/bin/reviewer-test.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

test('reviewer-test errors on missing args', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rt-'));
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: {}, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /usage/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reviewer-test errors on unknown rule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rt-'));
  try {
    const c = capture();
    const code = await run(['--rule', 'nonexistent', '--file', '/tmp/nowhere'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /rule not found/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
