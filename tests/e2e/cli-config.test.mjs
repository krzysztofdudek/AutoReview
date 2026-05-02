// tests/e2e/cli-config.test.mjs — F1..F5: config layering, secrets, validation.
// We observe effective config via `autoreview history` (loads config, no LLM) or validate --help.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';
import { loadConfig } from '../../scripts/lib/config-loader.mjs';

test('F1 + config.personal.yaml overrides tiers.default.provider', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'ollama', model: 'qwen2.5-coder:7b', endpoint: 'http://localhost:11434' } },
    });
    await env.write('.autoreview/config.personal.yaml',
      'tiers:\n  default:\n    provider: ollama\n    model: phi3:mini\n    endpoint: http://localhost:11434\n');
    const cfg = await loadConfig(env.dir, { env: {} });
    assert.equal(cfg.tiers.default.provider, 'ollama');
    assert.equal(cfg.tiers.default.model, 'phi3:mini');
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

test('F3b + secrets file beats env var when both present (file wins)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig();
    await env.write('.autoreview/config.secrets.yaml', 'anthropic:\n  api_key: "file-key"\n');
    const cfg = await loadConfig(env.dir, { env: { ANTHROPIC_API_KEY: 'env-key' } });
    // Secrets file takes precedence over env var per config-loader semantics.
    assert.equal(cfg.secrets.anthropic.api_key, 'file-key');
  } finally { await env.cleanup(); }
});

test('F4 - invalid YAML -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.write('.autoreview/config.yaml', 'tiers:\n  default:\n    provider: ollama\n  *broken\n');
    let err;
    try { await loadConfig(env.dir, { env: {} }); } catch (e) { err = e; }
    assert.ok(err, 'expected error on invalid YAML');
  } finally { await env.cleanup(); }
});

test('F4b - unknown tier provider -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'bogus', model: 'x', endpoint: 'http://localhost:1' } },
    });
    let err;
    try { await loadConfig(env.dir, { env: {} }); } catch (e) { err = e; }
    assert.ok(err);
    assert.match(err.message, /unknown provider/);
  } finally { await env.cleanup(); }
});

test('F4c - even consensus -> loadConfig throws', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cfg');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'ollama', model: 'x', endpoint: 'http://localhost:11434', consensus: 2 } },
    });
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
