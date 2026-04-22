// tests/e2e/cli-dispatcher.test.mjs — D1..D4: unified `autoreview <sub>` dispatcher.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('D1 + autoreview --help lists every subcommand, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('disp');
  try {
    const r = await env.run('--help', []);
    assert.equal(r.code, 0);
    for (const sub of ['init', 'validate', 'review', 'create-rule', 'check-breadth', 'context', 'guide', 'pull-remote', 'reviewer-test', 'history']) {
      assert.match(r.stdout, new RegExp(`\\b${sub}\\b`));
    }
  } finally { await env.cleanup(); }
});

test('D2 + no args prints help, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('disp');
  try {
    const mod = await import('../../scripts/bin/autoreview.mjs');
    const out = [], err = [];
    const code = await mod.run([], {
      cwd: env.dir, env: process.env,
      stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) },
    });
    assert.equal(code, 0);
    assert.match(out.join(''), /Subcommands:/);
  } finally { await env.cleanup(); }
});

test('D3 - unknown subcommand -> exit 1 with [error]', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('disp');
  try {
    const r = await env.run('bogus-sub', []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[error\] unknown subcommand: bogus-sub/);
  } finally { await env.cleanup(); }
});

test('D4 + `review` alias routes to validate', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('disp');
  try {
    await env.writeConfig();
    // No rules, no files staged → both commands behave identically: exit 0, "[info] no matched rules" / empty
    const a = await env.run('validate', ['--scope', 'staged'], { stub: 'pass' });
    const b = await env.run('review', ['--scope', 'staged'], { stub: 'pass' });
    assert.equal(a.code, b.code);
    // Both exit 0 with zero matched rules (same engine path).
    assert.equal(a.code, 0);
  } finally { await env.cleanup(); }
});
