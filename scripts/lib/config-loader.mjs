import { join } from 'node:path';
import { readFileOrNull } from './fs-utils.mjs';
import { parse as parseYaml } from './yaml-min.mjs';

export const DEFAULT_CONFIG = {
  version: '0.1',
  tiers: {},
  remote_rules: [],
  history: { log_to_file: true },
  secrets: {},
};

export const ALLOWED_TIER_NAMES = ['default', 'trivial', 'standard', 'heavy', 'critical'];
export const ALLOWED_PROVIDERS = ['ollama', 'anthropic', 'openai', 'google', 'openai-compat', 'claude-code', 'codex', 'gemini-cli'];
const ENDPOINT_REQUIRED = new Set(['ollama', 'openai-compat']);
const ALLOWED_MODES = ['quick', 'thinking'];
const ALLOWED_EFFORTS = ['low', 'medium', 'high'];
const LEGACY_KEY_HINTS = {
  provider: `provider section was removed; use 'tiers:' (see CHANGELOG)`,
  enforcement: `enforcement was removed; use per-rule 'severity: error|warning' in frontmatter`,
  context_overrides: `context_overrides was removed; tiers + severity unify hook and skill behaviour`,
  review: `review section was removed; tier-level fields moved to tiers.<name>.{mode, reasoning_effort, consensus, context_window_bytes, output_max_tokens}`,
  rules: `rules.disabled / rules.enabled_extra were removed; use type: manual in rule frontmatter (local) or remote_rules[].overrides (remote)`,
};
export const ALLOWED_OVERRIDE_FIELDS = new Set(['name', 'triggers', 'tier', 'severity', 'type', 'description']);

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
  if (!cfg.tiers || typeof cfg.tiers !== 'object' || Array.isArray(cfg.tiers)) {
    throw new Error('tiers section is required and must be a map of tier-name → tier-config');
  }
  if (!cfg.tiers.default) {
    throw new Error('tiers.default is required');
  }

  for (const name of Object.keys(cfg.tiers)) {
    if (!ALLOWED_TIER_NAMES.includes(name)) {
      throw new Error(`unknown tier name '${name}' (allowed: ${ALLOWED_TIER_NAMES.join(', ')})`);
    }
  }

  for (const [name, tier] of Object.entries(cfg.tiers)) {
    if (!tier || typeof tier !== 'object') {
      throw new Error(`tier '${name}' must be an object`);
    }
    if (!ALLOWED_PROVIDERS.includes(tier.provider)) {
      throw new Error(`unknown provider '${tier.provider}' in tier ${name} (allowed: ${ALLOWED_PROVIDERS.join(', ')})`);
    }
    if (!tier.model || typeof tier.model !== 'string') {
      throw new Error(`tiers.${name}.model is required and must be a string`);
    }
    if (ENDPOINT_REQUIRED.has(tier.provider) && !tier.endpoint) {
      throw new Error(`tier ${name} uses provider ${tier.provider} which requires endpoint`);
    }

    if (tier.parallel == null) {
      tier.parallel = 1;
    } else if (!Number.isInteger(tier.parallel) || tier.parallel < 1) {
      throw new Error(`tiers.${name}.parallel must be a positive integer, got ${JSON.stringify(tier.parallel)}`);
    }

    if (tier.consensus == null) {
      tier.consensus = 1;
    } else if (!Number.isInteger(tier.consensus) || tier.consensus < 1 || tier.consensus % 2 === 0) {
      throw new Error(`tiers.${name}.consensus must be a positive odd integer, got ${tier.consensus}`);
    }

    if (tier.mode == null) {
      tier.mode = 'quick';
    } else if (!ALLOWED_MODES.includes(tier.mode)) {
      throw new Error(`tiers.${name}.mode must be one of ${ALLOWED_MODES.join('|')}, got '${tier.mode}'`);
    }

    if (tier.reasoning_effort == null) {
      tier.reasoning_effort = 'medium';
    } else if (!ALLOWED_EFFORTS.includes(tier.reasoning_effort)) {
      throw new Error(`tiers.${name}.reasoning_effort must be one of ${ALLOWED_EFFORTS.join('|')}, got '${tier.reasoning_effort}'`);
    }

    if (tier.timeout_ms == null) {
      tier.timeout_ms = 120000;
    } else if (!Number.isInteger(tier.timeout_ms) || tier.timeout_ms <= 0) {
      throw new Error(`tiers.${name}.timeout_ms must be a positive integer, got ${JSON.stringify(tier.timeout_ms)}`);
    }
    if (tier.context_window_bytes == null) tier.context_window_bytes = 'auto';
    if (tier.output_max_tokens == null) {
      tier.output_max_tokens = 0;
    } else if (!Number.isInteger(tier.output_max_tokens) || tier.output_max_tokens < 0) {
      throw new Error(`tiers.${name}.output_max_tokens must be a non-negative integer, got ${JSON.stringify(tier.output_max_tokens)}`);
    }

    const cwb = tier.context_window_bytes;
    if (cwb !== 'auto' && (!Number.isInteger(cwb) || cwb <= 0)) {
      throw new Error(`tiers.${name}.context_window_bytes must be 'auto' or positive integer, got ${cwb}`);
    }
  }

  const names = new Set();
  for (const r of cfg.remote_rules ?? []) {
    if (names.has(r.name)) throw new Error(`duplicate remote_rules name: ${r.name}`);
    names.add(r.name);

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

    if (r.overrides) {
      if (typeof r.overrides !== 'object' || Array.isArray(r.overrides)) {
        throw new Error(`remote_rules[${r.name}].overrides must be a map`);
      }
      for (const [ruleId, fields] of Object.entries(r.overrides)) {
        if (!fields || typeof fields !== 'object') {
          throw new Error(`remote_rules[${r.name}].overrides.${ruleId} must be an object`);
        }
        for (const k of Object.keys(fields)) {
          if (!ALLOWED_OVERRIDE_FIELDS.has(k)) {
            throw new Error(`unknown override field '${k}' for rule '${ruleId}' in remote_rules[${r.name}]`);
          }
        }
      }
    }
  }
}

function seenLegacy(cfg) {
  for (const k of Object.keys(LEGACY_KEY_HINTS)) {
    if (k in cfg) return k;
  }
  return null;
}

export async function loadConfig(repoRoot, { env = process.env } = {}) {
  const dir = join(repoRoot, '.autoreview');
  const repoCfg = await loadYaml(join(dir, 'config.yaml')) ?? {};
  const personalCfg = await loadYaml(join(dir, 'config.personal.yaml')) ?? {};
  const secretsCfg = await loadYaml(join(dir, 'config.secrets.yaml')) ?? {};

  for (const candidate of [repoCfg, personalCfg]) {
    const k = seenLegacy(candidate);
    if (k) throw new Error(LEGACY_KEY_HINTS[k]);
  }
  if (secretsCfg?.ollama?.host !== undefined) {
    throw new Error(`secrets.ollama.host was removed; set endpoint in the relevant tier instead`);
  }

  let merged = deepMerge(DEFAULT_CONFIG, repoCfg);
  merged = deepMerge(merged, personalCfg);

  if (Array.isArray(repoCfg.remote_rules) && Array.isArray(personalCfg.remote_rules)) {
    const repoEntries = repoCfg.remote_rules ?? [];
    const personalEntries = personalCfg.remote_rules ?? [];
    const byName = new Map(repoEntries.map(r => [r.name, JSON.parse(JSON.stringify(r))]));
    for (const pr of personalEntries) {
      if (!pr.name) continue;
      const target = byName.get(pr.name);
      if (target) {
        target.overrides = deepMerge(target.overrides ?? {}, pr.overrides ?? {});
        for (const k of Object.keys(pr)) {
          if (k !== 'overrides' && k !== 'name') target[k] = pr[k];
        }
      } else {
        byName.set(pr.name, JSON.parse(JSON.stringify(pr)));
      }
    }
    merged.remote_rules = [...byName.values()];
  }

  merged.secrets = deepMerge(merged.secrets ?? {}, secretsCfg);

  const envMap = {
    ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
    OPENAI_API_KEY: ['openai', 'api_key'],
    GOOGLE_API_KEY: ['google', 'api_key'],
    OPENAI_COMPAT_API_KEY: ['openai-compat', 'api_key'],
  };
  for (const [envName, [provider, key]] of Object.entries(envMap)) {
    if (env[envName] && !merged.secrets?.[provider]?.[key]) {
      merged.secrets ??= {};
      merged.secrets[provider] ??= {};
      merged.secrets[provider][key] = env[envName];
    }
  }

  validate(merged);
  return merged;
}
