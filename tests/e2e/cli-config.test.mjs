// tests/e2e/cli-config.test.mjs — F1..F5: config layering, secrets, validation.
// We observe effective config via `autoreview history` (loads config, no LLM) or validate --help.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';
import { loadConfig } from '../../scripts/lib/config-loader.mjs';

test('F1 + config.personal.yaml overrides provider.active', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({ provider: { active: 'ollama', ollama: { endpoint: 'http://x', model: 'm' } } });
    await env.write('.autoreview/config.personal.yaml', 'provider:\n  active: openai\n');
    const cfg = await loadConfig(env.dir, { env: {} });
    assert.equal(cfg.provider.active, 'openai');
  } finally { await env.cleanup(); }
});

test('F2 + config.secrets.yaml populates secrets.<provider>.api_key', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig();
    await env.write('.autoreview/config.secrets.yaml', 'anthropic:\n  api_key: "sk-ant-secret"\n');
    const cfg = await loadConfig(env.dir, { env: {} });
    assert.equal(cfg.secrets?.anthropic?.api_key, 'sk-ant-secret');
  } finally { await env.cleanup(); }
});

test('F3 + ANTHROPIC_API_KEY env populates secrets.anthropic.api_key', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig();
    const cfg = await loadConfig(env.dir, { env: { ANTHROPIC_API_KEY: 'env-override' } });
    assert.equal(cfg.secrets.anthropic.api_key, 'env-override');
  } finally { await env.cleanup(); }
});

test('F3b + env var overrides secrets file for same provider', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig();
    await env.write('.autoreview/config.secrets.yaml', 'anthropic:\n  api_key: "file-key"\n');
    const cfg = await loadConfig(env.dir, { env: { ANTHROPIC_API_KEY: 'env-key' } });
    assert.equal(cfg.secrets.anthropic.api_key, 'env-key');
  } finally { await env.cleanup(); }
});

test('F4 - invalid YAML -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.write('.autoreview/config.yaml', 'provider:\n  active: ollama\n  *broken\n');
    let err;
    try { await loadConfig(env.dir, { env: {} }); } catch (e) { err = e; }
    assert.ok(err, 'expected error on invalid YAML');
  } finally { await env.cleanup(); }
});

test('F4b - validate.active = bogus provider -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({ provider: { active: 'bogus' } });
    let err;
    try { await loadConfig(env.dir, { env: {} }); } catch (e) { err = e; }
    assert.ok(err);
    assert.match(err.message, /unknown provider\.active/);
  } finally { await env.cleanup(); }
});

test('F4c - even consensus -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({ review: { evaluate: 'full', mode: 'quick', consensus: 2, context_window_bytes: 'auto', output_reserve_bytes: 2000, walk_file_cap: 10000 } });
    let err;
    try { await loadConfig(env.dir, { env: {} }); } catch (e) { err = e; }
    assert.ok(err);
    assert.match(err.message, /consensus/);
  } finally { await env.cleanup(); }
});

test('F5 + unknown top-level key is tolerated (forward-compat)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig();
    await env.write('.autoreview/config.yaml',
      (await env.read('.autoreview/config.yaml')) + '\nfuture_feature:\n  enabled: true\n');
    const cfg = await loadConfig(env.dir, { env: {} });
    assert.ok(cfg);
    // Key survives the merge; we don't validate it away.
    assert.equal(cfg.future_feature?.enabled, true);
  } finally { await env.cleanup(); }
});
