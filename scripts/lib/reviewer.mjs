// scripts/lib/reviewer.mjs
import { evaluate as evalTrigger, parse as parseTrigger, shouldTreatAsNonMatchForContent } from './trigger-engine.mjs';
import { getProvider } from './provider-client.mjs';
import { buildPrompt } from './prompt-builder.mjs';
import { fitFile } from './chunker.mjs';
import { voteConsensus } from './consensus.mjs';
import { appendVerdict } from './history.mjs';
import { scanSuppressMarkers } from './suppress-parser.mjs';

function triggersAst(rule) {
  if (rule._triggersAst) return rule._triggersAst;
  return rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
}

const REASONING_SUPPORT = new Set(['anthropic', 'openai', 'google', 'openai-compat']);

async function resolveContextWindow(tier, provider, _state) {
  if (tier.context_window_bytes !== 'auto') return tier.context_window_bytes;
  const key = `${provider.name}|${provider.model}`;
  // Cache the in-flight promise so concurrent reviewFile() calls under Promise.all share
  // a single contextWindowBytes() round-trip. Caching only the resolved value would race
  // between has()/await/set, letting N pairs each call the provider once before any
  // populated the cache.
  if (!_state.ctxCache.has(key)) {
    const promise = provider.contextWindowBytes ? provider.contextWindowBytes() : Promise.resolve(16384);
    _state.ctxCache.set(key, promise);
  }
  return await _state.ctxCache.get(key);
}

export async function reviewFile(opts) {
  const {
    repoRoot, config, rules, file, diff,
    historyEnabled, historyAppend,
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

    if (rule.frontmatter._invalid) {
      const v = {
        rule: rule.id, verdict: 'error', reason: rule.frontmatter._invalid,
        provider: null, model: null, mode: null,
        tier: rule.frontmatter.tier ?? 'default',
        severity: rule.frontmatter.severity ?? 'error',
        duration_ms: 0,
      };
      verdicts.push(v);
      matchedVerdicts[rule.id] = 'error';
      if (historyAppend) await historyAppend({ type: 'verdict', file: file.path, ...v });
      else if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...v });
      continue;
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

    const tierName = rule.frontmatter.tier ?? 'default';
    const tier = config.tiers?.[tierName];

    let provider;
    try {
      provider = _providerOverride ?? getProvider(config, { tierName });
    } catch (err) {
      const v = {
        rule: rule.id, verdict: 'error', reason: err.message,
        provider: null, model: null, mode: null,
        tier: tierName,
        severity: rule.frontmatter.severity ?? 'error',
        duration_ms: 0,
      };
      verdicts.push(v);
      matchedVerdicts[rule.id] = 'error';
      if (historyAppend) await historyAppend({ type: 'verdict', file: file.path, ...v });
      else if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...v });
      continue;
    }

    // Dedupe under concurrent fan-out depends on has()/add() being in one synchronous block
    // (no await between them) — JS event loop then guarantees one warn per shared _state.
    // Inserting an await here would let two concurrent reviewFile invocations both pass the
    // !has() check before either adds, producing duplicate warns.
    if (tier?.reasoning_effort && !REASONING_SUPPORT.has(provider.name) && !_state.warnedReasoning.has(provider.name)) {
      _state.warnedReasoning.add(provider.name);
      warn(`[warn] provider ${provider.name} does not support reasoning_effort; ignoring for this run`);
    }

    const effectiveTier = tier;
    const contextWindowBytes = await resolveContextWindow(effectiveTier, provider, _state);
    const fit = fitFile({
      fileContent: file.content, rule, diff,
      contextWindowBytes,
    });

    if (fit.action === 'skip') {
      const v = {
        rule: rule.id, verdict: 'error', reason: `skip: ${fit.reason}`,
        provider: provider.name, model: provider.model, mode: effectiveTier.mode,
        tier: tierName,
        severity: rule.frontmatter.severity ?? 'error',
        duration_ms: 0,
      };
      verdicts.push(v);
      matchedVerdicts[rule.id] = v.verdict;
      if (historyAppend) await historyAppend({ type: 'verdict', file: file.path, ...v });
      else if (historyEnabled) await appendVerdict(repoRoot, { file: file.path, ...v });
      continue;
    }

    const effectiveFile = { ...file, content: fit.fileContent };
    const mode = effectiveTier.mode;
    const prompt = buildPrompt({
      rule, file: effectiveFile, diff,
      mode,
    });
    const start = Date.now();
    // Single output cap for both modes via tier.output_max_tokens. Default 0 = no cap
    // (adapters omit the field / use -1 / fall back to provider minimum where the API
    // demands it). Reasoning-first models need headroom for their trace before the
    // verdict JSON — hardcoded caps kept silently chopping their output.
    const vote = await voteConsensus(provider, prompt, {
      consensus: effectiveTier.consensus,
      maxTokens: effectiveTier.output_max_tokens ?? 0,
      reasoningEffort: effectiveTier.reasoning_effort,
    });
    const duration_ms = Date.now() - start;

    const hasSuppressed = Array.isArray(vote.suppressed) && vote.suppressed.length > 0;
    // Truncated content is asymmetric: satisfied=true on a partial file is unreliable
    // (violation may sit in the cut-off tail), satisfied=false is trustworthy (the model
    // actually spotted a problem in what it saw). Reject stays reject, pass gets demoted
    // to an `error` verdict naming the truncation so users don't silently believe a
    // big file passed when only the first ~155kB was judged.
    const unreliablePass = fit.action === 'truncate' && vote.satisfied && !vote.providerError;
    let verdict;
    if (vote.providerError) verdict = 'error';
    else if (unreliablePass) verdict = 'error';
    else if (vote.satisfied && hasSuppressed) verdict = 'suppressed';
    else verdict = vote.satisfied ? 'pass' : 'fail';

    const reason = unreliablePass
      ? `truncated: reviewer saw only first ${Buffer.byteLength(fit.fileContent)} bytes of ${Buffer.byteLength(file.content)}; pass verdict on partial content is unreliable — bump context_window_bytes in the tier or split the file`
      : (vote.reason ?? null);
    const rec = {
      rule: rule.id, verdict, reason,
      provider: provider.name, model: provider.model, mode,
      tier: tierName,
      severity: rule.frontmatter.severity ?? 'error',
      duration_ms,
    };
    if (vote.usage) rec.usage = vote.usage;
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
  return { verdicts, summary };
}
