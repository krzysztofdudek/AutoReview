import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, clearProviderCache } from '../../scripts/lib/provider-client.mjs';
import { DEFAULT_CONFIG } from '../../scripts/lib/config-loader.mjs';

test('default active = ollama', () => {
  clearProviderCache();
  const p = getProvider(DEFAULT_CONFIG, {});
  assert.equal(p.name, 'ollama');
});

test('per-rule provider overrides active', () => {
  clearProviderCache();
  const cfg = { ...DEFAULT_CONFIG, secrets: { anthropic: { api_key: 'sk-test' } } };
  const p = getProvider(cfg, { ruleProvider: 'anthropic' });
  assert.equal(p.name, 'anthropic');
  assert.equal(p.model, DEFAULT_CONFIG.provider.anthropic.model);
});

test('per-rule model overrides default', () => {
  clearProviderCache();
  const p = getProvider(DEFAULT_CONFIG, { ruleModel: 'qwen2.5-coder:14b' });
  assert.equal(p.model, 'qwen2.5-coder:14b');
});

test('unknown provider name throws', () => {
  clearProviderCache();
  assert.throws(() => getProvider(DEFAULT_CONFIG, { ruleProvider: 'nope' }), /unknown provider/i);
});

test('instances memoized across calls with same key', () => {
  clearProviderCache();
  const p1 = getProvider(DEFAULT_CONFIG, {});
  const p2 = getProvider(DEFAULT_CONFIG, {});
  assert.equal(p1, p2);
});

test('custom anthropic endpoint passed through to provider', () => {
  clearProviderCache();
  const cfg = {
    ...DEFAULT_CONFIG,
    provider: {
      ...DEFAULT_CONFIG.provider,
      anthropic: { model: 'claude-haiku-4-5', endpoint: 'https://proxy.example.com/v1/messages' },
    },
    secrets: { anthropic: { api_key: 'sk-test' } },
  };
  const p = getProvider(cfg, { ruleProvider: 'anthropic' });
  assert.equal(p.name, 'anthropic');
  // Constructing with a custom URL should not throw
});

test('unknown provider error lists known values', () => {
  clearProviderCache();
  assert.throws(
    () => getProvider(DEFAULT_CONFIG, { ruleProvider: 'nope' }),
    /unknown provider: nope\. Known: ollama/,
  );
});
