import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../../scripts/lib/config-loader.mjs';

async function fixtureRepo(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  await mkdir(join(dir, '.autoreview'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, '.autoreview', name), body);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('returns defaults when no config file present', async () => {
  const { dir, cleanup } = await fixtureRepo({});
  try {
    const cfg = await loadConfig(dir);
    assert.equal(cfg.provider.active, DEFAULT_CONFIG.provider.active);
  } finally { await cleanup(); }
});

test('personal config overrides repo config', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'provider:\n  active: ollama\n',
    'config.personal.yaml': 'provider:\n  active: anthropic\n',
  });
  try {
    const cfg = await loadConfig(dir);
    assert.equal(cfg.provider.active, 'anthropic');
  } finally { await cleanup(); }
});

test('env var overrides secrets file for API key', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.secrets.yaml': 'anthropic:\n  api_key: "from-file"\n',
  });
  try {
    process.env.ANTHROPIC_API_KEY = 'from-env';
    const cfg = await loadConfig(dir);
    assert.equal(cfg.secrets.anthropic.api_key, 'from-env');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    await cleanup();
  }
});

test('API-key env fallback works when secrets file absent', async () => {
  const { dir, cleanup } = await fixtureRepo({});
  try {
    process.env.OPENAI_API_KEY = 'env-only';
    const cfg = await loadConfig(dir);
    assert.equal(cfg.secrets.openai.api_key, 'env-only');
  } finally {
    delete process.env.OPENAI_API_KEY;
    await cleanup();
  }
});

test('OLLAMA_HOST precedence: secrets > env > repo/personal', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'provider:\n  ollama:\n    endpoint: "http://repo-endpoint:11434"\n',
    'config.secrets.yaml': 'ollama:\n  host: "http://secrets-endpoint:11434"\n',
  });
  try {
    process.env.OLLAMA_HOST = 'http://env-endpoint:11434';
    const cfg = await loadConfig(dir);
    assert.equal(cfg.provider.ollama.endpoint, 'http://secrets-endpoint:11434');
  } finally {
    delete process.env.OLLAMA_HOST;
    await cleanup();
  }
});

test('OLLAMA_HOST env overrides repo/personal when secrets absent', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'provider:\n  ollama:\n    endpoint: "http://repo-endpoint:11434"\n',
    'config.personal.yaml': 'provider:\n  ollama:\n    endpoint: "http://personal-endpoint:11434"\n',
  });
  try {
    process.env.OLLAMA_HOST = 'http://env-endpoint:11434';
    const cfg = await loadConfig(dir);
    assert.equal(cfg.provider.ollama.endpoint, 'http://env-endpoint:11434');
  } finally {
    delete process.env.OLLAMA_HOST;
    await cleanup();
  }
});

test('context_window_bytes validation rejects invalid values', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'review:\n  context_window_bytes: 0\n',
  });
  try {
    await assert.rejects(() => loadConfig(dir), /context_window_bytes/i);
  } finally { await cleanup(); }
});

test('remote_rules replaced wholesale', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'remote_rules:\n  - name: a\n    url: "x"\n    ref: v1\n    path: "."\n',
    'config.personal.yaml': 'remote_rules:\n  - name: b\n    url: "y"\n    ref: v1\n    path: "."\n',
  });
  try {
    const cfg = await loadConfig(dir);
    assert.equal(cfg.remote_rules.length, 1);
    assert.equal(cfg.remote_rules[0].name, 'b');
  } finally { await cleanup(); }
});

test('duplicate remote_rules names throws', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'remote_rules:\n  - {name: dup, url: "x", ref: v1, path: "."}\n  - {name: dup, url: "y", ref: v1, path: "."}\n',
  });
  try {
    await assert.rejects(() => loadConfig(dir), /duplicate/i);
  } finally { await cleanup(); }
});

test('config rejects remote_rules name with path traversal', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'remote_rules:\n  - {name: "../evil", url: "https://x.com/x.git", ref: v1, path: "."}\n',
  });
  try {
    await assert.rejects(() => loadConfig(dir), /name must match/);
  } finally { await cleanup(); }
});

test('config rejects remote_rules ref with ..', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'remote_rules:\n  - {name: shared, url: "https://x.com/x.git", ref: "../../escape", path: "."}\n',
  });
  try {
    await assert.rejects(() => loadConfig(dir), /ref invalid/);
  } finally { await cleanup(); }
});

test('config rejects remote_rules url starting with dash', async () => {
  const { dir, cleanup } = await fixtureRepo({
    'config.yaml': 'remote_rules:\n  - {name: shared, url: "--evil", ref: v1, path: "."}\n',
  });
  try {
    await assert.rejects(() => loadConfig(dir), /url.*'-'/);
  } finally { await cleanup(); }
});
