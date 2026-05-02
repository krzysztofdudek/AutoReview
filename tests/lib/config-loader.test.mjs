import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../scripts/lib/config-loader.mjs';

async function repoWithConfig(yaml) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  await mkdir(join(dir, '.autoreview'), { recursive: true });
  await writeFile(join(dir, '.autoreview/config.yaml'), yaml);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('tiers.default is mandatory — missing throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`version: "0.1"\ntiers: {}\n`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }), /tiers\.default is required/);
  } finally { await cleanup(); }
});

test('unknown tier name throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: ollama, model: m, endpoint: "http://x" }
  paranoid: { provider: ollama, model: m, endpoint: "http://x" }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /unknown tier name 'paranoid' \(allowed: default, trivial, standard, heavy, critical\)/);
  } finally { await cleanup(); }
});

test('unknown provider in tier throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: bogus, model: m }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /unknown provider 'bogus' in tier default/);
  } finally { await cleanup(); }
});

test('endpoint required for ollama', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: ollama, model: m }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tier default uses provider ollama which requires endpoint/);
  } finally { await cleanup(); }
});

test('endpoint required for openai-compat', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: openai-compat, model: m }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tier default uses provider openai-compat which requires endpoint/);
  } finally { await cleanup(); }
});

test('anthropic does not require endpoint', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: claude-x }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.provider, 'anthropic');
  } finally { await cleanup(); }
});

test('parallel must be positive integer', async () => {
  for (const bad of ['0', '-1', '"x"']) {
    const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, parallel: ${bad} }
`);
    try {
      await assert.rejects(loadConfig(dir, { env: {} }),
        new RegExp(`tiers\\.default\\.parallel must be a positive integer`));
    } finally { await cleanup(); }
  }
});

test('parallel default is 1', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.parallel, 1);
  } finally { await cleanup(); }
});

test('consensus must be positive odd integer', async () => {
  const evenCfg = `
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, consensus: 2 }
`;
  const { dir, cleanup } = await repoWithConfig(evenCfg);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.consensus must be a positive odd integer, got 2/);
  } finally { await cleanup(); }
});

test('consensus 1, 3, 5 accepted', async () => {
  for (const odd of [1, 3, 5]) {
    const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, consensus: ${odd} }
`);
    try {
      const cfg = await loadConfig(dir, { env: {} });
      assert.equal(cfg.tiers.default.consensus, odd);
    } finally { await cleanup(); }
  }
});

test('consensus default is 1', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.consensus, 1);
  } finally { await cleanup(); }
});

test('mode must be quick or thinking', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, mode: hybrid }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.mode must be one of quick\|thinking/);
  } finally { await cleanup(); }
});

test('reasoning_effort enum', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, reasoning_effort: extreme }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.reasoning_effort must be one of low\|medium\|high/);
  } finally { await cleanup(); }
});

test('mode and reasoning_effort defaults', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.mode, 'quick');
    assert.equal(cfg.tiers.default.reasoning_effort, 'medium');
  } finally { await cleanup(); }
});

test('numeric tier defaults', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.timeout_ms, 120000);
    assert.equal(cfg.tiers.default.context_window_bytes, 'auto');
    assert.equal(cfg.tiers.default.output_max_tokens, 0);
  } finally { await cleanup(); }
});

test('context_window_bytes accepts auto or positive int', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, context_window_bytes: -5 }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.context_window_bytes must be 'auto' or positive integer, got -5/);
  } finally { await cleanup(); }
});

const LEGACY_KEYS = [
  ['provider', /provider section was removed; use 'tiers:'/],
  ['enforcement', /enforcement was removed; use per-rule 'severity/],
  ['context_overrides', /context_overrides was removed/],
  ['review', /review section was removed/],
  ['rules', /rules\.disabled \/ rules\.enabled_extra were removed/],
];

for (const [key, expected] of LEGACY_KEYS) {
  test(`legacy key '${key}' throws migration message`, async () => {
    const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
${key}: anything
`);
    try {
      await assert.rejects(loadConfig(dir, { env: {} }), expected);
    } finally { await cleanup(); }
  });
}

test('legacy secrets.ollama.host throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers:
  default: { provider: ollama, model: m, endpoint: "http://x" }
`);
    await writeFile(join(dir, '.autoreview/config.secrets.yaml'), `
ollama:
  host: "http://other"
`);
    await assert.rejects(loadConfig(dir, { env: {} }),
      /secrets\.ollama\.host was removed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('personal config overrides per tier field', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers:
  default: { provider: anthropic, model: claude-haiku, parallel: 4 }
`);
    await writeFile(join(dir, '.autoreview/config.personal.yaml'), `
tiers:
  default:
    model: claude-opus-4-7
`);
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.model, 'claude-opus-4-7');
    assert.equal(cfg.tiers.default.parallel, 4);
    assert.equal(cfg.tiers.default.provider, 'anthropic');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('secrets injected from env vars', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
  try {
    const cfg = await loadConfig(dir, { env: { ANTHROPIC_API_KEY: 'sk-test' } });
    assert.equal(cfg.secrets.anthropic.api_key, 'sk-test');
  } finally { await cleanup(); }
});

test('secrets file beats env when both present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
`);
    await writeFile(join(dir, '.autoreview/config.secrets.yaml'), `
anthropic:
  api_key: sk-from-file
`);
    const cfg = await loadConfig(dir, { env: { ANTHROPIC_API_KEY: 'sk-from-env' } });
    assert.equal(cfg.secrets.anthropic.api_key, 'sk-from-file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('remote_rules.overrides accepted', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
remote_rules:
  - name: corp
    url: "https://example.com/repo"
    ref: v1
    overrides:
      my-rule:
        tier: trivial
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.remote_rules[0].overrides['my-rule'].tier, 'trivial');
  } finally { await cleanup(); }
});

test('remote_rules.overrides unknown field throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
remote_rules:
  - name: corp
    url: "https://example.com/repo"
    ref: v1
    overrides:
      my-rule:
        body: bad
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /unknown override field 'body' for rule 'my-rule' in remote_rules\[corp\]/);
  } finally { await cleanup(); }
});

test('remote_rules name validation preserved', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m }
remote_rules:
  - name: bad/name
    url: "https://example.com/repo"
    ref: v1
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }), /remote_rules\.name must match/);
  } finally { await cleanup(); }
});

test('OLLAMA_HOST env var not consumed at runtime', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: ollama, model: m, endpoint: "http://configured" }
`);
  try {
    const cfg = await loadConfig(dir, { env: { OLLAMA_HOST: 'http://from-env' } });
    assert.equal(cfg.tiers.default.endpoint, 'http://configured');
  } finally { await cleanup(); }
});

test('model is required and must be a string', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.model is required and must be a string/);
  } finally { await cleanup(); }
});

test('model with non-string value throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: 42 }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.model is required and must be a string/);
  } finally { await cleanup(); }
});

test('timeout_ms must be positive integer', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, timeout_ms: "120s" }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.timeout_ms must be a positive integer/);
  } finally { await cleanup(); }
});

test('timeout_ms negative throws', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, timeout_ms: -100 }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.timeout_ms must be a positive integer/);
  } finally { await cleanup(); }
});

test('output_max_tokens must be non-negative integer', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, output_max_tokens: -1 }
`);
  try {
    await assert.rejects(loadConfig(dir, { env: {} }),
      /tiers\.default\.output_max_tokens must be a non-negative integer/);
  } finally { await cleanup(); }
});

test('output_max_tokens 0 is valid (no cap)', async () => {
  const { dir, cleanup } = await repoWithConfig(`
version: "0.1"
tiers:
  default: { provider: anthropic, model: m, output_max_tokens: 0 }
`);
  try {
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.output_max_tokens, 0);
  } finally { await cleanup(); }
});

test('round-trip full config with all features', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers:
  default: { provider: ollama, model: "qwen2.5-coder:7b", endpoint: "http://localhost:11434" }
  critical:
    provider: anthropic
    model: claude-opus-4-7
    parallel: 4
    mode: thinking
    reasoning_effort: high
    consensus: 3
    timeout_ms: 180000
    context_window_bytes: 800000
    output_max_tokens: 16384
remote_rules:
  - name: corp
    url: "https://example.com/repo"
    ref: v1
    path: rules
    overrides:
      my-rule: { tier: trivial, severity: warning, type: manual }
history:
  log_to_file: false
`);
    const cfg = await loadConfig(dir, { env: {} });
    assert.equal(cfg.tiers.default.parallel, 1);
    assert.equal(cfg.tiers.critical.parallel, 4);
    assert.equal(cfg.tiers.critical.mode, 'thinking');
    assert.equal(cfg.tiers.critical.consensus, 3);
    assert.equal(cfg.remote_rules[0].overrides['my-rule'].tier, 'trivial');
    assert.equal(cfg.history.log_to_file, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('repo-only remote_rules entry preserved when personal has none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers: { default: { provider: anthropic, model: m } }
remote_rules:
  - name: corp
    url: "https://x"
    ref: v1
    overrides:
      a: { tier: standard }
`);
    await writeFile(join(dir, '.autoreview/config.personal.yaml'), `
remote_rules:
  - name: other
    url: "https://y"
    ref: v2
`);
    const cfg = await loadConfig(dir, { env: {} });
    const corp = cfg.remote_rules.find(r => r.name === 'corp');
    assert.ok(corp, 'corp entry from repo should survive personal merge');
    assert.equal(corp.overrides.a.tier, 'standard');
    assert.equal(corp.url, 'https://x');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('personal-only remote_rules entry added to merged list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers: { default: { provider: anthropic, model: m } }
remote_rules:
  - name: corp
    url: "https://x"
    ref: v1
`);
    await writeFile(join(dir, '.autoreview/config.personal.yaml'), `
remote_rules:
  - name: extra
    url: "https://z"
    ref: v3
    overrides:
      foo: { type: manual }
`);
    const cfg = await loadConfig(dir, { env: {} });
    const corp = cfg.remote_rules.find(r => r.name === 'corp');
    const extra = cfg.remote_rules.find(r => r.name === 'extra');
    assert.ok(corp, 'corp survives');
    assert.ok(extra, 'extra added from personal');
    assert.equal(extra.overrides.foo.type, 'manual');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('personal remote_rules.overrides merge by name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cfg-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `
version: "0.1"
tiers: { default: { provider: anthropic, model: m } }
remote_rules:
  - name: corp
    url: "https://x"
    ref: v1
    overrides:
      a: { tier: standard }
`);
    await writeFile(join(dir, '.autoreview/config.personal.yaml'), `
remote_rules:
  - name: corp
    overrides:
      a: { tier: critical }
      b: { type: manual }
`);
    const cfg = await loadConfig(dir, { env: {} });
    const corp = cfg.remote_rules.find(r => r.name === 'corp');
    assert.equal(corp.overrides.a.tier, 'critical');
    assert.equal(corp.overrides.b.type, 'manual');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
