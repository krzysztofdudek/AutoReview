import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../scripts/bin/autoreview.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

test('autoreview no args prints help', async () => {
  const c = capture();
  const code = await run([], { cwd: process.cwd(), env: process.env, ...c });
  assert.equal(code, 0);
  assert.match(c.out(), /init/);
  assert.match(c.out(), /validate/);
  assert.match(c.out(), /review/);
});

test('autoreview unknown subcommand errors', async () => {
  const c = capture();
  const code = await run(['bogus'], { cwd: process.cwd(), env: process.env, ...c });
  assert.equal(code, 1);
  assert.match(c.err(), /unknown subcommand/);
});
