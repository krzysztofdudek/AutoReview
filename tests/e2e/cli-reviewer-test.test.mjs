// tests/e2e/cli-reviewer-test.test.mjs — R1..R6: single rule × single file reviewer probe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E, serverAvailable } from './helpers/harness.mjs';

test('R1 + matching file passes rule -> satisfied=true', async (t) => {
  skipUnlessE2E(t);
  if (!await serverAvailable()) t.skip('server unreachable');
  const env = await createEnv('rt');
  try {
    await env.writeConfig();
    await env.writeRule('no-console.md',
      { name: 'No Console', triggers: 'path:"**/*.ts"', description: 'Forbid console.log' },
      'This file must not contain any calls to console.log, console.error, console.warn, or console.info. Any such call is a violation.');
    const good = await env.write('src/a.ts', 'export const add = (a, b) => a + b;\n');
    const r = await env.run('reviewer-test', ['--rule', 'no-console', '--file', good]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /=== RESULT ===/);
    assert.match(r.stdout, /"satisfied": true/);
  } finally { await env.cleanup(); }
});

test('R2 + file that violates the rule -> satisfied=false with reason', async (t) => {
  skipUnlessE2E(t);
  if (!await serverAvailable()) t.skip('server unreachable');
  const env = await createEnv('rt');
  try {
    // Use thinking mode in tier config for richer reasoning output.
    await env.writeConfig({
      tiers: { default: { provider: 'openai-compat', model: 'x', endpoint: process.env.AUTOREVIEW_E2E_ENDPOINT ?? 'http://127.0.0.1:8080/v1', mode: 'thinking', consensus: 1 } },
    });
    await env.writeRule('no-console.md',
      { name: 'No Console', triggers: 'path:"**/*.ts"', description: 'Forbid console.log' },
      'This file must not contain any calls to console.log. Any such call is a violation.');
    const bad = await env.write('src/b.ts', 'console.log("debug");\nexport const x = 1;\n');
    const r = await env.run('reviewer-test', ['--rule', 'no-console', '--file', bad]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"satisfied": false/);
    assert.match(r.stdout, /"reason":/);
  } finally { await env.cleanup(); }
});

test('R3 - unknown --rule -> exit 1, rule not found', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig();
    const p = await env.write('src/a.ts', 'x');
    const r = await env.run('reviewer-test', ['--rule', 'does-not-exist', '--file', p]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /rule not found/);
  } finally { await env.cleanup(); }
});

test('R4 - --file does not exist -> exit 1, cannot read', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig();
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    const r = await env.run('reviewer-test', ['--rule', 'x', '--file', '/tmp/nope-' + Date.now() + '.ts']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot read/);
  } finally { await env.cleanup(); }
});

test('R5 - missing args -> exit 1 usage', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig();
    const r = await env.run('reviewer-test', []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /usage: reviewer-test/);
  } finally { await env.cleanup(); }
});

test('R6 - server down -> providerError in result, exit 0 (tool still ran)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'openai-compat', model: 'x', endpoint: 'http://127.0.0.1:1' } },
    });
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    const p = await env.write('src/a.ts', 'x');
    const r = await env.run('reviewer-test', ['--rule', 'x', '--file', p]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /"providerError": true/);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

// R8: --provider flag was removed; provider is now determined by the rule's
// tier config. This test verifies that unavailable provider (anthropic, no API key)
// triggers providerError via tier config.
test('R8 + tier-level provider (anthropic, no API key) → providerError in result', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'anthropic', model: 'claude-haiku-4-5' } },
    });
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    const p = await env.write('src/a.ts', 'x');
    const r = await env.run('reviewer-test', ['--rule', 'x', '--file', p], {
      env: { ANTHROPIC_API_KEY: '' },
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /anthropic/);
    assert.match(r.stdout, /"providerError": true/);
  } finally { await env.cleanup(); }
});

// R9: --model flag was removed; model is set per-tier in config.
// This test verifies that the tier model appears in the reviewer output.
test('R9 + tier model appears in provider block output', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    });
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    const p = await env.write('src/a.ts', 'x');
    const r = await env.run('reviewer-test', ['--rule', 'x', '--file', p], {
      env: { ANTHROPIC_API_KEY: '' },
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /claude-sonnet-4-6/);
  } finally { await env.cleanup(); }
});

// R10: --mode flag was removed; mode is set per-tier in config.
// This test verifies that tier.mode: 'thinking' produces the thinking prompt format.
test('R10 + tier mode:thinking produces thinking prompt format', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'openai-compat', model: 'x', endpoint: 'http://127.0.0.1:1', mode: 'thinking' } },
    });
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    const p = await env.write('src/a.ts', 'x');
    const r = await env.run('reviewer-test', ['--rule', 'x', '--file', p]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Mode: thinking/);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

test('R-rel-content + --content-file relative path resolves against ctx.cwd', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('rt');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'openai-compat', model: 'x', endpoint: 'http://127.0.0.1:1' } },
    });
    await env.writeRule('x.md', { name: 'X', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('drafts/r-rel.ts', 'x');
    const r = await env.run('reviewer-test', [
      '--rule', 'x',
      '--file', 'src/logical.ts',
      '--content-file', 'drafts/r-rel.ts',
    ]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /=== PROMPT ===/);
    assert.match(r.stdout, /src\/logical\.ts/);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

test('R7 + --content-file submits hypothetical content while --file is logical path', async (t) => {
  skipUnlessE2E(t);
  if (!await serverAvailable()) t.skip('server unreachable');
  const env = await createEnv('rt');
  try {
    await env.writeConfig({ tiers: { default: { provider: 'openai-compat', model: process.env.AUTOREVIEW_E2E_MODEL ?? 'unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit', endpoint: process.env.AUTOREVIEW_E2E_ENDPOINT ?? 'http://127.0.0.1:8080/v1', consensus: 1 } } });
    await env.writeRule('no-console.md',
      { name: 'No Console', triggers: 'path:"**/*.ts"' },
      'This file must not contain console.log.');
    const draft = await env.write('/tmp/draft-content.ts', 'export const x = 1;\n');
    const r = await env.run('reviewer-test', [
      '--rule', 'no-console',
      '--file', 'src/new-file-not-on-disk-yet.ts',
      '--content-file', draft,
    ]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /src\/new-file-not-on-disk-yet\.ts/);
  } finally { await env.cleanup(); }
});
