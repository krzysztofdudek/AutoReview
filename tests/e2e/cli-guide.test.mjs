// tests/e2e/cli-guide.test.mjs — G1..G6: free-text rule search (no LLM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('G1 + query returns ranked list (top match by name)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    await env.writeRule('audit.md', { name: 'Audit Logging on Mutations', triggers: 'dir:"src"', description: 'Emit audit events before return' }, 'body text');
    await env.writeRule('other.md', { name: 'Unrelated', triggers: 'dir:"src"' }, 'nothing relevant here');
    const r = await env.run('guide', ['audit', 'logging']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Top rules for/);
    assert.match(r.stdout, /- audit:/);
    // 'audit' rule must appear before 'other' in output
    const posAudit = r.stdout.indexOf('- audit:');
    const posOther = r.stdout.indexOf('- other:');
    if (posOther !== -1) assert.ok(posAudit < posOther);
  } finally { await env.cleanup(); }
});

test('G2 + multi-word query, stopwords dropped', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    await env.writeRule('x.md', { name: 'Validation Everywhere', triggers: 'dir:"src"' }, 'b');
    const r = await env.run('guide', ['how', 'do', 'i', 'add', 'validation']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /- x:/);
  } finally { await env.cleanup(); }
});

test('G3 + query that matches nothing -> helpful fallback message', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    await env.writeRule('x.md', { name: 'Validation', triggers: 'dir:"src"' }, 'body');
    const r = await env.run('guide', ['zzzzznothing']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No relevant rules found/);
  } finally { await env.cleanup(); }
});

test('G4 + rule body with linked paths surfaces example code paths', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    await env.writeRule('api.md',
      { name: 'Api', triggers: 'dir:"src"', description: 'Validate payloads' },
      'See [example](src/api/good.ts) or `src/api/handler.ts` for reference.');
    const r = await env.run('guide', ['api', 'validate']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /example code paths:/);
    assert.match(r.stdout, /src\/api\/good\.ts/);
    assert.match(r.stdout, /src\/api\/handler\.ts/);
  } finally { await env.cleanup(); }
});

test('G5 - empty query -> exit 1, usage message', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    const r = await env.run('guide', []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /usage: guide/);
  } finally { await env.cleanup(); }
});

test('G6 + no rules dir -> exit 0, no results', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('guide');
  try {
    await env.writeConfig();
    // Delete rules dir
    await import('node:fs/promises').then(m => m.rm(`${env.dir}/.autoreview/rules`, { recursive: true, force: true }));
    const r = await env.run('guide', ['anything']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No relevant rules found/);
  } finally { await env.cleanup(); }
});
