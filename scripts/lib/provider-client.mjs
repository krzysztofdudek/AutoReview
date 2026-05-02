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

export function getProvider(config, { tierName = 'default' } = {}) {
  const tier = config.tiers?.[tierName];
  if (!tier) {
    throw new Error(`tier '${tierName}' not defined in tiers: in .autoreview/config.yaml`);
  }
  if (!FACTORIES[tier.provider]) {
    throw new Error(`unknown provider '${tier.provider}' in tier ${tierName}. Known: ${Object.keys(FACTORIES).join(', ')}`);
  }
  const apiKey = config.secrets?.[tier.provider]?.api_key ?? '';
  const cacheKey = `${tierName}|${tier.provider}|${tier.model}|${tier.endpoint ?? ''}|${apiKey ? 'K' : ''}`;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  const factoryArgs = { model: tier.model, apiKey };
  const epKey = ENDPOINT_KEY[tier.provider];
  if (epKey && tier.endpoint) factoryArgs[epKey] = tier.endpoint;
  if (Number.isInteger(tier.timeout_ms) && tier.timeout_ms > 0) factoryArgs.timeoutMs = tier.timeout_ms;
  const raw = FACTORIES[tier.provider](factoryArgs);

  const max = Number.isInteger(tier.parallel) && tier.parallel >= 1 ? tier.parallel : 1;
  const sem = getOrCreateSemaphore(tierName, max);
  const wrapped = {
    ...raw,
    verify: (prompt, opts) => sem.run(() => raw.verify(prompt, opts)),
  };
  CACHE.set(cacheKey, wrapped);
  return wrapped;
}

export function clearProviderCache() {
  CACHE.clear();
  SEMAPHORES.clear();
}

export { SEMAPHORES as _SEMAPHORES };
