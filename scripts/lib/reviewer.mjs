// scripts/lib/reviewer.mjs
import { evaluate as evalTrigger, parse as parseTrigger, shouldTreatAsNonMatchForContent } from './trigger-engine.mjs';
import { getProvider } from './provider-client.mjs';
import { buildPrompt } from './prompt-builder.mjs';
import { fitFile } from './chunker.mjs';
import { voteConsensus } from './consensus.mjs';
import { appendVerdict, appendFileSummary } from './history.mjs';
import { scanSuppressMarkers } from './suppress-parser.mjs';

function resolveMode(config) { return config.review.mode; }
function resolveEvaluate(config, rule) { return rule?.frontmatter?.evaluate ?? config.review.evaluate; }

function triggersAst(rule) {
  if (rule._triggersAst) return rule._triggersAst;
  return rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
}

const REASONING_SUPPORT = new Set(['anthropic', 'openai', 'google', 'openai-compat']);

async function resolveContextWindow(config, provider, _state) {
  if (config.review.context_window_bytes !== 'auto') return config.review.context_window_bytes;
  const key = `${provider.name}|${provider.model}`;
  if (_state.ctxCache.has(key)) return _state.ctxCache.get(key);
  const bytes = provider.contextWindowBytes ? await provider.contextWindowBytes() : 16384;
  _state.ctxCache.set(key, bytes);
  return bytes;
}

export async function reviewFile(opts) {
  const {
    repoRoot, config, rules, file, diff,
    intentGate, historyEnabled, historyAppend,
    _providerOverride = null,
  } = opts;
  const _state = opts._state ?? { ctxCache: new Map(), warnedReasoning: new Set() };
  // Optional structured stderr; defaults to console.error for CLIs that don't plumb ctx through.
  const warn = opts.stderr
    ? (msg) => opts.stderr.write(msg + '\n')
    : (msg) => console.error(msg);

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

    // Spec §27: suppress markers present in code. Scan for reason-validation only — warn when
    // reason is missing. The LLM decides contextually (file-top/function/block) whether any
    // given marker applies to the code being judged, returning a `suppressed[]` array in
    // thinking mode (see prompt-builder.mjs). No deterministic short-circuit here — that
    // would ignore positional scope.
    const markers = scanSuppressMarkers(file.content);
    const ruleMarkers = markers.filter(m => m.ruleId === rule.id);
    for (const bad of ruleMarkers.filter(m => !m.valid)) {
      warn(`[warn] @autoreview-ignore at ${file.path}:${bad.line} missing mandatory <reason>`);
    }

    const provider = _providerOverride ?? getProvider(config, {
      ruleProvider: rule.frontmatter.provider,
      ruleModel: rule.frontmatter.model,
    });

    if (config.review.reasoning_effort && !REASONING_SUPPORT.has(provider.name) && !_state.warnedReasoning.has(provider.name)) {
      _state.warnedReasoning.add(provider.name);
      warn(`[warn] provider ${provider.name} does not support reasoning_effort; ignoring for this run`);
    }

    const contextWindowBytes = await resolveContextWindow(config, provider, _state);
    const fit = fitFile({
      fileContent: file.content, rule, diff,
      contextWindowBytes,
      outputReserveBytes: config.review.output_reserve_bytes,
    });

    if (fit.action === 'skip') {
      const v = { rule: rule.id, verdict: 'error', reason: `skip: ${fit.reason}`, provider: provider.name, model: provider.model, mode: resolveMode(config), duration_ms: 0 };
      verdicts.push(v);
      matchedVerdicts[rule.id] = v.verdict;
      if (historyAppend) await historyAppend({ type: 'verdict', file: file.path, ...v });
      else if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...v });
      continue;
    }

    const effectiveFile = { ...file, content: fit.fileContent };
    const mode = resolveMode(config);
    const prompt = buildPrompt({
      rule, file: effectiveFile, diff,
      mode, evaluate: resolveEvaluate(config, rule),
    });
    const start = Date.now();
    // Quick mode: always ~100 tokens (just the verdict JSON).
    // Thinking mode: honor `review.output_max_tokens`. 0 = no limit (adapters omit the field
    // or fall back to their minimum required by the API).
    const thinkingMax = config.review.output_max_tokens ?? 0;
    const vote = await voteConsensus(provider, prompt, {
      consensus: config.review.consensus,
      maxTokens: mode === 'quick' ? 100 : thinkingMax,
      reasoningEffort: config.review.reasoning_effort,
    });
    const duration_ms = Date.now() - start;

    const hasSuppressed = Array.isArray(vote.suppressed) && vote.suppressed.length > 0;
    let verdict;
    if (vote.providerError) verdict = 'error';
    else if (vote.satisfied && hasSuppressed) verdict = 'suppressed';
    else verdict = vote.satisfied ? 'pass' : 'fail';

    const rec = { rule: rule.id, verdict, reason: vote.reason ?? null, provider: provider.name, model: provider.model, mode, duration_ms };
    if (hasSuppressed) {
      rec.suppressed = vote.suppressed.map(s => {
        const match = ruleMarkers.find(m => m.line === s.line);
        return match ? { ...s, scope_hint: match.scope } : s;
      });
    }
    verdicts.push(rec);
    matchedVerdicts[rule.id] = verdict;
    if (historyAppend) await historyAppend({ type: 'verdict', file: file.path, ...rec });
    else if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...rec });
  }

  const summary = {
    file: file.path,
    matched_rules: matched,
    verdicts: matchedVerdicts,
    duration_ms: verdicts.reduce((s, v) => s + v.duration_ms, 0),
  };
  if (historyAppend) await historyAppend({ type: 'file-summary', ...summary });
  else if (historyEnabled) await appendFileSummary(repoRoot, summary);
  return { verdicts, summary };
}
