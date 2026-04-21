// scripts/lib/reviewer.mjs
import { evaluate as evalTrigger, parse as parseTrigger, shouldTreatAsNonMatchForContent } from './trigger-engine.mjs';
import { getProvider } from './provider-client.mjs';
import { buildPrompt } from './prompt-builder.mjs';
import { fitFile } from './chunker.mjs';
import { voteConsensus } from './consensus.mjs';
import { appendVerdict, appendFileSummary } from './history.mjs';

function resolveMode(config) { return config.review.mode; }
function resolveEvaluate(config, rule) { return rule?.frontmatter?.evaluate ?? config.review.evaluate; }

function triggersAst(rule) {
  if (rule._triggersAst) return rule._triggersAst;
  return rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
}

const CTX_CACHE = new Map();
async function resolveContextWindow(config, provider) {
  if (config.review.context_window_bytes !== 'auto') return config.review.context_window_bytes;
  const key = `${provider.name}|${provider.model}`;
  if (CTX_CACHE.has(key)) return CTX_CACHE.get(key);
  const bytes = provider.contextWindowBytes ? await provider.contextWindowBytes() : 16384;
  CTX_CACHE.set(key, bytes);
  return bytes;
}
export function clearContextWindowCache() { CTX_CACHE.clear(); }

export async function reviewFile(opts) {
  const {
    repoRoot, config, rules, file, diff,
    intentGate, historyEnabled,
    _providerOverride = null,
  } = opts;

  const verdicts = [];
  const matched = [];
  const matchedVerdicts = {};
  const fileSize = Buffer.byteLength(file.content);
  const binary = !!file.binary;
  const contentForbidden = shouldTreatAsNonMatchForContent(fileSize, binary);

  for (const rule of rules) {
    const ast = triggersAst(rule);
    const matches = evalTrigger(ast, { path: file.path, content: file.content, binary: contentForbidden });
    if (!matches) continue;

    if (rule.frontmatter.intent && config.review.intent_triggers && intentGate) {
      const intentResult = await intentGate.check(rule, file.path, file.content);
      if (intentResult === 'skip-no') continue;
      // skip-budget: fall through to Layer 3 verify per design §3
      // (caller emits the one-time warning via onBudgetExhausted)
    }

    matched.push(rule.id);

    const provider = _providerOverride ?? getProvider(config, {
      ruleProvider: rule.frontmatter.provider,
      ruleModel: rule.frontmatter.model,
    });

    const contextWindowBytes = await resolveContextWindow(config, provider);
    const fit = fitFile({
      fileContent: file.content, rule, diff,
      contextWindowBytes,
      outputReserveBytes: config.review.output_reserve_bytes,
    });

    if (fit.action === 'skip') {
      const v = { rule: rule.id, verdict: 'error', reason: `skip: ${fit.reason}`, provider: provider.name, model: provider.model, mode: resolveMode(config), duration_ms: 0 };
      verdicts.push(v);
      matchedVerdicts[rule.id] = v.verdict;
      if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...v });
      continue;
    }

    const effectiveFile = { ...file, content: fit.fileContent };
    const mode = resolveMode(config);
    const prompt = buildPrompt({
      rule, file: effectiveFile, diff,
      mode, evaluate: resolveEvaluate(config, rule),
    });
    const start = Date.now();
    const vote = await voteConsensus(provider, prompt, {
      consensus: config.review.consensus,
      maxTokens: mode === 'quick' ? 100 : 2000,
      reasoningEffort: config.review.reasoning_effort,
    });
    const duration_ms = Date.now() - start;

    const verdict = vote.providerError ? 'error' : (vote.satisfied ? 'pass' : 'fail');
    const rec = { rule: rule.id, verdict, reason: vote.reason ?? null, provider: provider.name, model: provider.model, mode, duration_ms };
    verdicts.push(rec);
    matchedVerdicts[rule.id] = verdict;
    if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...rec });
  }

  const summary = {
    file: file.path,
    matched_rules: matched,
    verdicts: matchedVerdicts,
    duration_ms: verdicts.reduce((s, v) => s + v.duration_ms, 0),
  };
  if (historyEnabled) await appendFileSummary(repoRoot, summary);
  return { verdicts, summary };
}
