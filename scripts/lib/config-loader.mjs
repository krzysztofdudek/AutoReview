// scripts/lib/config-loader.mjs
// Loads and merges AutoReview config from 4 sources. Zero deps.

import { join } from 'node:path';
import { readFileOrNull } from './fs-utils.mjs';
import { parse as parseYaml } from './yaml-min.mjs';

export const DEFAULT_CONFIG = {
  version: '0.1',
  provider: {
    active: 'ollama',
    ollama: { endpoint: 'http://localhost:11434', model: 'qwen2.5-coder:7b' },
    'claude-code': { model: 'haiku' },
    codex: { model: 'gpt-5' },
    'gemini-cli': { model: 'gemini-2.5-flash' },
    anthropic: { model: 'claude-haiku-4-5' },
    openai: { model: 'gpt-4o-mini' },
    google: { model: 'gemini-2.5-flash' },
    'openai-compat': { endpoint: '', model: '' },
  },
  review: {
    evaluate: 'diff',
    mode: 'quick',
    reasoning_effort: 'medium',
    consensus: 1,
    intent_triggers: false,
    intent_trigger_budget: 50,
    context_window_bytes: 'auto',
    output_reserve_bytes: 2000,
    walk_file_cap: 10000,
    remote_rules_auto_pull: false,
  },
  enforcement: { precommit: 'soft', validate: 'hard' },
  context_overrides: {
    precommit: { mode: 'quick', consensus: 1, scope: 'staged' },
    validate: { mode: 'thinking', scope: 'uncommitted' },
  },
  rules: { enabled_extra: [], disabled: [] },
  remote_rules: [],
  history: { log_to_file: true },
  secrets: {},
};

function deepMerge(base, overlay) {
  if (overlay === undefined) return base;
  if (Array.isArray(overlay) || typeof overlay !== 'object' || overlay === null) return overlay;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = (typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null)
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

async function loadYaml(path) {
  const raw = await readFileOrNull(path);
  return raw ? parseYaml(raw) : null;
}

function validate(cfg) {
  const names = new Set();
  for (const r of cfg.remote_rules ?? []) {
    if (names.has(r.name)) throw new Error(`duplicate remote_rules name: ${r.name}`);
    names.add(r.name);

    // Security: path traversal defense for remote_rules.
    if (!r.name || typeof r.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(r.name)) {
      throw new Error(`remote_rules.name must match [A-Za-z0-9._-]+, got: ${r.name}`);
    }
    if (!r.ref || typeof r.ref !== 'string' || /\.\.|^\/|^-/.test(r.ref)) {
      throw new Error(`remote_rules.ref invalid (no '..', leading '/', or leading '-'): ${r.ref}`);
    }
    if (r.path !== undefined && r.path !== null) {
      if (typeof r.path !== 'string' || /\.\.|^\/|^-/.test(r.path)) {
        throw new Error(`remote_rules.path invalid: ${r.path}`);
      }
    }
    if (!r.url || typeof r.url !== 'string' || r.url.startsWith('-')) {
      throw new Error(`remote_rules.url must be non-empty and not start with '-': ${r.url}`);
    }
  }
  const knownProviders = ['ollama', 'claude-code', 'codex', 'gemini-cli', 'anthropic', 'openai', 'google', 'openai-compat'];
  if (!knownProviders.includes(cfg.provider.active)) {
    throw new Error(`unknown provider.active: ${cfg.provider.active}`);
  }
  if (!Number.isInteger(cfg.review.consensus) || cfg.review.consensus < 1 || cfg.review.consensus % 2 === 0) {
    throw new Error(`review.consensus must be positive odd integer, got ${cfg.review.consensus}`);
  }
  const cwb = cfg.review.context_window_bytes;
  if (cwb !== 'auto' && (!Number.isInteger(cwb) || cwb <= 0)) {
    throw new Error(`review.context_window_bytes must be 'auto' or positive integer, got ${cwb}`);
  }
}

export async function loadConfig(repoRoot, { env = process.env } = {}) {
  const dir = join(repoRoot, '.autoreview');
  const repoCfg = await loadYaml(join(dir, 'config.yaml')) ?? {};
  const personalCfg = await loadYaml(join(dir, 'config.personal.yaml')) ?? {};
  const secretsCfg = await loadYaml(join(dir, 'config.secrets.yaml')) ?? {};
  let merged = deepMerge(DEFAULT_CONFIG, repoCfg);
  merged = deepMerge(merged, personalCfg);
  merged.secrets = deepMerge(merged.secrets ?? {}, secretsCfg);
  const envMap = {
    ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
    OPENAI_API_KEY: ['openai', 'api_key'],
    GOOGLE_API_KEY: ['google', 'api_key'],
    OPENAI_COMPAT_API_KEY: ['openai-compat', 'api_key'],
  };
  for (const [envName, [provider, key]] of Object.entries(envMap)) {
    if (env[envName]) {
      merged.secrets[provider] = { ...(merged.secrets[provider] ?? {}), [key]: env[envName] };
    }
  }
  // OLLAMA_HOST: secrets.ollama.host > env OLLAMA_HOST > personal > repo
  if (merged.secrets.ollama?.host) {
    merged.provider.ollama.endpoint = merged.secrets.ollama.host;
  } else if (env.OLLAMA_HOST) {
    merged.provider.ollama.endpoint = env.OLLAMA_HOST;
  }
  validate(merged);
  return merged;
}
