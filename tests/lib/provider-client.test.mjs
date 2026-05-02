import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, clearProviderCache, _SEMAPHORES } from '../../scripts/lib/provider-client.mjs';

test('getProvider dispatches by tierName', () => {
  clearProviderCache();
  const cfg = {
    tiers: {
      default: { provider: 'ollama', model: 'qwen', endpoint: 'http://x', parallel: 1, timeout_ms: 60000 },
      critical: { provider: 'anthropic', model: 'claude-opus-4-7', parallel: 4, timeout_ms: 180000 },
    },
    secrets: { anthropic: { api_key: 'sk-test' } },
  };
  const p = getProvider(cfg, { tierName: 'critical' });
  assert.equal(p.name, 'anthropic');
  assert.equal(p.model, 'claude-opus-4-7');
});

test('getProvider defaults to default tier when tierName omitted', () => {
  clearProviderCache();
  const cfg = {
    tiers: {
      default: { provider: 'ollama', model: 'qwen', endpoint: 'http://x', parallel: 1, timeout_ms: 60000 },
    },
    secrets: {},
  };
  const p = getProvider(cfg);
  assert.equal(p.name, 'ollama');
  assert.equal(p.model, 'qwen');
});

test('getProvider throws on undefined tier', () => {
  clearProviderCache();
  const cfg = { tiers: { default: { provider: 'ollama', model: 'm', endpoint: 'http://x', parallel: 1 } }, secrets: {} };
  assert.throws(() => getProvider(cfg, { tierName: 'critical' }),
    /tier 'critical' not defined in tiers: in \.autoreview\/config\.yaml/);
});

test('two tiers on same provider get separate semaphores', () => {
  clearProviderCache();
  const cfg = {
    tiers: {
      default: { provider: 'anthropic', model: 'haiku', parallel: 2 },
      critical: { provider: 'anthropic', model: 'opus', parallel: 4 },
    },
    secrets: { anthropic: { api_key: 'sk-test' } },
  };
  getProvider(cfg, { tierName: 'default' });
  getProvider(cfg, { tierName: 'critical' });
  assert.equal(_SEMAPHORES.get('default').max, 2);
  assert.equal(_SEMAPHORES.get('critical').max, 4);
});

test('two tiers on same provider create exactly two semaphores keyed by tier name', () => {
  clearProviderCache();
  const cfg = {
    tiers: {
      default: { provider: 'anthropic', model: 'haiku', parallel: 2 },
      critical: { provider: 'anthropic', model: 'opus', parallel: 4 },
    },
    secrets: { anthropic: { api_key: 'sk-test' } },
  };
  getProvider(cfg, { tierName: 'default' });
  getProvider(cfg, { tierName: 'critical' });
  assert.equal(_SEMAPHORES.size, 2);
  assert.ok(_SEMAPHORES.has('default'));
  assert.ok(_SEMAPHORES.has('critical'));
});
