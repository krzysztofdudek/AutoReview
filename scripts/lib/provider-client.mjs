import * as ollama from './providers/ollama.mjs';
import * as anthropic from './providers/anthropic.mjs';
import * as openai from './providers/openai.mjs';
import * as google from './providers/google.mjs';
import * as openaiCompat from './providers/openai-compat.mjs';
import * as claudeCode from './providers/claude-code.mjs';
import * as codex from './providers/codex.mjs';
import * as geminiCli from './providers/gemini-cli.mjs';

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

export function getProvider(config, { ruleProvider, ruleModel } = {}) {
  const name = ruleProvider ?? config.provider.active;
  if (!FACTORIES[name]) throw new Error(`unknown provider: ${name}`);
  const provCfg = config.provider[name] ?? {};
  const model = ruleModel ?? provCfg.model;
  const endpoint = provCfg.endpoint;
  const apiKey = config.secrets?.[name]?.api_key ?? '';
  const key = `${name}|${model}|${endpoint ?? ''}|${apiKey ? 'K' : ''}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const p = FACTORIES[name]({ model, endpoint, apiKey });
  CACHE.set(key, p);
  return p;
}

export function clearProviderCache() { CACHE.clear(); }
