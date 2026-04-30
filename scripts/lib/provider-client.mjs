import * as ollama from './providers/ollama.mjs';
import * as anthropic from './providers/anthropic.mjs';
import * as openai from './providers/openai.mjs';
import * as google from './providers/google.mjs';
import * as openaiCompat from './providers/openai-compat.mjs';
import * as claudeCode from './providers/claude-code.mjs';
import * as codex from './providers/codex.mjs';
import * as geminiCli from './providers/gemini-cli.mjs';
import { Semaphore } from './concurrency.mjs';

const FACTORIES = {
  ollama: ollama.create,
  anthropic: anthropic.create,
  openai: openai.create,
  google: google.create,
  'openai-compat': openaiCompat.create,
  'claude-code': claudeCode.create,
  codex: codex.create,
  'gemini-cli': geminiCli.create,
};

const CACHE = new Map();
const SEMAPHORES = new Map();

const ENDPOINT_KEY = {
  ollama: 'endpoint',
  anthropic: 'url',
  openai: 'url',
  google: 'baseUrl',
  'openai-compat': 'endpoint',
  'claude-code': null,
  codex: null,
  'gemini-cli': null,
};

function getOrCreateSemaphore(name, max) {
  const existing = SEMAPHORES.get(name);
  if (existing && existing.max === max) return existing;
  const sem = new Semaphore(max);
  SEMAPHORES.set(name, sem);
  return sem;
}

export function getProvider(config, { ruleProvider, ruleModel } = {}) {
  const name = ruleProvider ?? config.provider.active;
  if (!FACTORIES[name]) throw new Error(`unknown provider: ${name}. Known: ${Object.keys(FACTORIES).join(', ')}`);
  const provCfg = config.provider[name] ?? {};
  const model = ruleModel ?? provCfg.model;
  const endpoint = provCfg.endpoint;
  const apiKey = config.secrets?.[name]?.api_key ?? '';
  const key = `${name}|${model}|${endpoint ?? ''}|${apiKey ? 'K' : ''}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const factoryArgs = { model, apiKey };
  const epKey = ENDPOINT_KEY[name];
  if (epKey && endpoint) factoryArgs[epKey] = endpoint;
  if (Number.isInteger(provCfg.timeout_ms) && provCfg.timeout_ms > 0) factoryArgs.timeoutMs = provCfg.timeout_ms;
  const raw = FACTORIES[name](factoryArgs);
  const max = Number.isInteger(provCfg.parallel) && provCfg.parallel >= 1 ? provCfg.parallel : 1;
  // Per-provider semaphore lives at the provider name granularity (not per cache key) — the
  // upstream rate-limit is per-account, not per-model.
  const sem = getOrCreateSemaphore(name, max);
  const wrapped = {
    ...raw,
    verify: (prompt, opts) => sem.run(() => raw.verify(prompt, opts)),
  };
  CACHE.set(key, wrapped);
  return wrapped;
}

export function clearProviderCache() {
  CACHE.clear();
  SEMAPHORES.clear();
}

export { SEMAPHORES as _SEMAPHORES };
