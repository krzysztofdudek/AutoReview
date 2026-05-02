// tests/e2e/cli-precommit.test.mjs — K1..K7: pre-commit hook integration.
// Hook runs out-of-process; uses the runtime copy under .autoreview/runtime/.
//
// Severity mapping (replaces old enforcement: soft/hard):
//   severity: error  → exit 1 on reject (was "hard")
//   severity: warning → exit 0 on reject (was "soft")

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

async function initHookedEnv(env, { ruleSeverity = 'warning', provider = 'openai-compat' } = {}) {
  // Init first (runtime + hook + default config), THEN overwrite config with our tailored one.
  const r = await env.run('init', ['--provider', provider, '--install-precommit']);
  await env.writeConfig({
    tiers: {
      default: {
        provider,
        model: 'test',
        endpoint: 'http://127.0.0.1:8080/v1',
        parallel: 1,
        mode: 'quick',
        consensus: 1,
      },
    },
    remote_rules: [],
    history: { log_to_file: false },
  });
  return { r, ruleSeverity };
}

test('K1 + severity:warning + stub fail -> hook exit 0, [warn] on stderr', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'warning' });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'warning' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit', { env: { AUTOREVIEW_STUB_PROVIDER: 'fail' } });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\]/);
  } finally { await env.cleanup(); }
});

test('K2 + severity:error + stub fail -> hook exit 1, [reject] + [hint]', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'error' });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit', { env: { AUTOREVIEW_STUB_PROVIDER: 'fail' } });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[reject\]/);
    assert.match(r.stderr, /\[hint\]/);
  } finally { await env.cleanup(); }
});

test('K3 + no matched rules -> hook exit 0, silent (no pass/reject)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env);
    // Rule triggers .rs files, staged file is .ts
    await env.writeRule('rust.md', { name: 'RustOnly', triggers: 'path:"**/*.rs"' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit', { env: { AUTOREVIEW_STUB_PROVIDER: 'fail' } });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /\[reject\]/);
    assert.doesNotMatch(r.stderr, /\[pass\]/);
  } finally { await env.cleanup(); }
});

test('K4 + only binary file staged -> hook exit 0, no LLM call', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env);
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.bin" AND content:"MAGIC"' }, 'body');
    const buf = Buffer.concat([Buffer.from('MAGIC\0'), Buffer.alloc(256, 0)]);
    await env.write('blob.bin', buf);
    env.git('add', 'blob.bin');
    const r = await env.runHook('.git/hooks/pre-commit', { env: { AUTOREVIEW_STUB_PROVIDER: 'fail' } });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /\[reject\]/);
  } finally { await env.cleanup(); }
});

test('K5 + severity:warning + server down -> exit 0 (warning rules don\'t block)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'warning' });
    // Point to dead port
    await env.write('.autoreview/config.yaml',
      (await env.read('.autoreview/config.yaml')).replace(/endpoint: "[^"]+"/, 'endpoint: "http://127.0.0.1:1"'));
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'warning' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit');
    assert.equal(r.code, 0);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

test('K6 + severity:error + server down -> exit 1 (error rules block on provider errors)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'error' });
    await env.write('.autoreview/config.yaml',
      (await env.read('.autoreview/config.yaml')).replace(/endpoint: "[^"]+"/, 'endpoint: "http://127.0.0.1:1"'));
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit');
    // Per spec §5: severity:error + [error] verdict (provider unreachable) → exit 1.
    assert.equal(r.code, 1);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

test('K8 + real `git commit` blocks under severity:error + stub fail', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'error' });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const res = env.gitEnv({ AUTOREVIEW_STUB_PROVIDER: 'fail' }, 'commit', '-m', 'try');
    assert.notEqual(res.status, 0);
    // Commit must NOT have landed
    const log = env.git('log', '--oneline', '-n', '1');
    assert.doesNotMatch(log.stdout, /try/);
  } finally { await env.cleanup(); }
});

test('K9 + real `git commit` proceeds under severity:warning + stub fail', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'warning' });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'warning' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const res = env.gitEnv({ AUTOREVIEW_STUB_PROVIDER: 'fail' }, 'commit', '-m', 'soft-pass');
    assert.equal(res.status, 0);
    const log = env.git('log', '--oneline', '-n', '1');
    assert.match(log.stdout, /soft-pass/);
  } finally { await env.cleanup(); }
});

test('K10 + hook forwards extra args via $@ to validate CLI', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'error' });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    // Pass --rule with a non-existent rule id: validate matches no rule → exit 0 silently.
    const r = await env.runHook('.git/hooks/pre-commit', {
      env: { AUTOREVIEW_STUB_PROVIDER: 'fail' },
      args: ['--rule', 'does-not-exist'],
    });
    assert.equal(r.code, 0); // arg propagated → no rule matched → no reject
    assert.doesNotMatch(r.stderr, /\[reject\]/);
  } finally { await env.cleanup(); }
});

test('K7 + no .autoreview/config.yaml -> hook exit 0 silently', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('pc');
  try {
    await initHookedEnv(env, { ruleSeverity: 'error' });
    // Delete config after install
    await (await import('node:fs/promises')).rm(`${env.dir}/.autoreview/config.yaml`);
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.runHook('.git/hooks/pre-commit');
    assert.equal(r.code, 0);
  } finally { await env.cleanup(); }
});
