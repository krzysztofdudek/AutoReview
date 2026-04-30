#!/usr/bin/env node
// scripts/bin/validate.mjs
import { parseArgs } from '../lib/args.mjs';
import { repoRoot, actorContext } from '../lib/git-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { resolveScope } from '../lib/scope-resolver.mjs';
import { reviewFile } from '../lib/reviewer.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { createIntentGate } from '../lib/intent-gate.mjs';
import { reportVerdicts } from '../lib/report.mjs';
import { createHistorySession } from '../lib/history.mjs';
import { readFileOrNull, isBinary, isMainModule } from '../lib/fs-utils.mjs';
import { readFile, appendFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { pullSource } from '../lib/remote-rules-pull.mjs';
import { parse as parseTrigger, evaluate as evalTrigger, shouldTreatAsNonMatchForContent } from '../lib/trigger-engine.mjs';
import { Semaphore } from '../lib/concurrency.mjs';

function stubProviderByEnv(env) {
  const mode = env.AUTOREVIEW_STUB_PROVIDER;
  if (!mode) return null;
  const customReason = env.AUTOREVIEW_STUB_REASON;
  const map = {
    pass: { satisfied: true },
    fail: { satisfied: false, reason: customReason ?? 'stub fail' },
    error: { satisfied: false, providerError: true, raw: 'stub' },
  };
  const callLogPath = env.AUTOREVIEW_STUB_CALL_LOG;
  // Default Semaphore(1) preserves deterministic verdict-line ordering for tests that assert
  // a specific stderr layout. Benchmarks that need to observe the validate.mjs fan-out
  // (acceptance §F.3.4) override via AUTOREVIEW_STUB_PARALLEL.
  const stubParallel = Number.isInteger(Number(env.AUTOREVIEW_STUB_PARALLEL)) && Number(env.AUTOREVIEW_STUB_PARALLEL) > 0
    ? Number(env.AUTOREVIEW_STUB_PARALLEL)
    : 1;
  const stubDelayMs = Number.isFinite(Number(env.AUTOREVIEW_STUB_DELAY_MS)) && Number(env.AUTOREVIEW_STUB_DELAY_MS) > 0
    ? Number(env.AUTOREVIEW_STUB_DELAY_MS)
    : 0;
  const sem = new Semaphore(stubParallel);
  return {
    name: 'stub', model: 'stub',
    async verify(prompt) {
      return sem.run(async () => {
        if (callLogPath) {
          const line = JSON.stringify({ ts: Date.now(), promptLen: prompt.length, diffPresent: /<diff>\n(?!\(no diff)/.test(prompt) }) + '\n';
          await appendFile(callLogPath, line);
        }
        if (stubDelayMs > 0) await new Promise(r => setTimeout(r, stubDelayMs));
        return map[mode];
      });
    },
    contextWindowBytes: async () => 16384,
  };
}

export async function run(argv, { cwd, env, stdout, stderr }) {
  try {
    return await _run(argv, { cwd, env, stdout, stderr });
  } catch (err) {
    stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    const context = argv.includes('--context') ? argv[argv.indexOf('--context') + 1] : 'validate';
    return context === 'precommit' ? 0 : 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const { values } = parseArgs(argv, {
    multiple: ['rule', 'files', 'dir'],
    aliases: { r: 'rule', f: 'files', s: 'scope' },
  });

  let root;
  try { root = await repoRoot(cwd); }
  catch { stderr.write('[warn] not a git repo\n'); return 0; }

  // Check if .autoreview exists before trying to load
  const cfgPath = `${root}/.autoreview/config.yaml`;
  const cfgRaw = await readFileOrNull(cfgPath);
  if (!cfgRaw) { stderr.write('[warn] autoreview not initialized\n'); return 0; }

  let cfg;
  try { cfg = await loadConfig(root, { env }); }
  catch (err) {
    stderr.write(`[warn] config load failed: ${err.message}\n`);
    return 0;
  }

  const context = values.context ?? 'validate';
  const ctxOverrides = cfg.context_overrides?.[context] ?? {};
  cfg.review = { ...cfg.review, ...ctxOverrides };
  if (values.mode) cfg.review.mode = values.mode;
  if (values['reasoning-effort']) cfg.review.reasoning_effort = values['reasoning-effort'];

  // Design §4 invariant: precommit caps consensus at 1 (spawn budget).
  if (context === 'precommit') cfg.review.consensus = 1;

  const enforcement = cfg.enforcement?.[context] ?? (context === 'precommit' ? 'soft' : 'hard');

  // §24: if remote_rules are declared and their cache is missing, auto-pull BEFORE loading rules
  // so the remote rules are actually available to this review run. Without this reorder,
  // loadRules reads a non-existent directory, then the pull happens after — but too late.
  for (const source of cfg.remote_rules ?? []) {
    const sentinelPath = `${root}/.autoreview/remote_rules/${source.name}/${source.ref}/.autoreview-managed`;
    const sentinel = await readFileOrNull(sentinelPath);
    if (!sentinel) {
      if (cfg.review.remote_rules_auto_pull) {
        try {
          stderr.write(`[info] auto-pulling remote '${source.name}@${source.ref}'...\n`);
          await pullSource({ repoRoot: root, source, env });
        } catch (err) {
          stderr.write(`[warn] auto-pull failed for ${source.name}: ${err.message}\n`);
        }
      } else {
        stderr.write(`[warn] remote source '${source.name}@${source.ref}' has no cache — run /autoreview:pull-remote or set review.remote_rules_auto_pull: true\n`);
      }
    }
  }

  const { rules, warnings: ruleWarnings } = await loadRules(root, cfg);
  for (const w of ruleWarnings) stderr.write(`[warn] ${w}\n`);
  const filtered = values.rule ? rules.filter(r => values.rule.includes(r.id)) : rules;

  // §15: hypothetical pre-check — content from disk scratch file, logical path supplied.
  let entries;
  let resolvedSha = null;  // full SHA when --sha was used; populated by resolveScope
  if (values['content-file'] && values['target-path']) {
    // Relative paths resolve against ctx.cwd (not process.cwd()).
    const contentFile = isAbsolute(values['content-file'])
      ? values['content-file']
      : resolvePath(cwd, values['content-file']);
    const buf = await readFile(contentFile).catch(() => null);
    if (!buf) { stderr.write(`[error] cannot read ${values['content-file']}\n`); return 1; }
    const content = buf.toString('utf8');
    entries = [{
      path: values['target-path'],
      content,
      diff: null,
      binary: isBinary(buf),
      size: buf.length,
    }];
  } else {
    const explicitSelector = values.scope || values.sha || values.files || values.dir;
    const scopeArgs = {
      repoRoot: root,
      scope: values.scope ?? (explicitSelector ? null : ctxOverrides.scope),
      sha: values.sha,
      files: values.files,
      dir: values.dir,
      walkCap: cfg.review.walk_file_cap ?? 10000,
    };
    const scopeResult = await resolveScope(scopeArgs);
    for (const w of scopeResult.warnings) stderr.write(`[warn] ${w}\n`);
    entries = scopeResult.entries;
    resolvedSha = scopeResult.sha ?? null;
  }

  const stubProvider = stubProviderByEnv(env);
  const resolveProvider = (rule) => stubProvider ?? getProvider(cfg, {
    ruleProvider: rule?.frontmatter?.provider,
    ruleModel: rule?.frontmatter?.model,
  });
  const intentGate = createIntentGate({
    resolveProvider,
    budget: cfg.review.intent_trigger_budget,
    onBudgetExhausted: () => stderr.write('[warn] intent budget exhausted — remaining rules evaluated against Layer 1 only\n'),
  });

  // Attribute every verdict: who ran the review, on which host, under which CI job,
  // and against which commit (when --sha was used; null otherwise — pre-commit's target
  // commit doesn't exist yet, and validate on uncommitted has no single sha).
  const attribution = await actorContext(root, env);
  const historyDefaults = { ...attribution };
  if (resolvedSha) historyDefaults.commit_sha = resolvedSha;
  const historySession = cfg.history.log_to_file
    ? createHistorySession(root, { defaults: historyDefaults })
    : null;

  let hardFailure = false;
  let rejectCount = 0;
  const reviewState = { ctxCache: new Map(), warnedReasoning: new Set() };

  const fileState = new Map();
  for (const entry of entries) {
    if (entry.binary && filtered.some(r => /content:/.test(r.frontmatter.triggers))) {
      stderr.write(`[warn] ${entry.path}: binary detected, content: predicates will not match\n`);
    }
    const fileSize = Buffer.byteLength(entry.content);
    const contentForbidden = shouldTreatAsNonMatchForContent(fileSize, entry.binary);
    const matchedRules = filtered.filter(rule => {
      if (!rule._triggersAst) rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
      return evalTrigger(rule._triggersAst, { path: entry.path, content: entry.content, binary: contentForbidden });
    });
    fileState.set(entry.path, {
      entry,
      pendingPairs: matchedRules.length,
      verdicts: {},
      matched: matchedRules.map(r => r.id),
      totalDuration: 0,
    });
  }

  const pairs = [];
  for (const entry of entries) {
    const st = fileState.get(entry.path);
    for (const ruleId of st.matched) {
      const rule = filtered.find(r => r.id === ruleId);
      pairs.push({ entry, rule });
    }
  }

  // Heads-up before a long paid-API run so the user can Ctrl-C early.
  if (pairs.length * cfg.review.consensus > 100) {
    stderr.write(`[info] large run: ${pairs.length} (file, rule) pairs × consensus=${cfg.review.consensus} — Ctrl-C now if this is unexpected\n`);
  }

  // Intent-gate budget race: concurrent intent checks can overshoot the budget under fan-out.
  // Atomic budget decrement is a follow-up; emit a one-time warning so the user is aware.
  const activeParallel = cfg.provider[cfg.provider.active]?.parallel ?? 1;
  if (cfg.review.intent_triggers && activeParallel > 1) {
    stderr.write(`[warn] intent_triggers is on with parallel=${activeParallel}: budget may be exceeded under concurrent fan-out (atomic budget fix is a follow-up)\n`);
  }

  // Files matching zero rules still get an empty file-summary (preserves prior behaviour).
  if (historySession) {
    for (const [, st] of fileState) {
      if (st.pendingPairs === 0) {
        await historySession.append({
          type: 'file-summary',
          file: st.entry.path,
          matched_rules: st.matched,
          verdicts: st.verdicts,
          duration_ms: st.totalDuration,
        });
      }
    }
  }

  try {
    await Promise.all(pairs.map(async ({ entry, rule }) => {
      const { verdicts } = await reviewFile({
        repoRoot: root, config: cfg, rules: [rule],
        file: { path: entry.path, content: entry.content, binary: entry.binary },
        diff: entry.diff,
        intentGate,
        historyEnabled: cfg.history.log_to_file,
        historyAppend: historySession ? rec => historySession.append(rec) : null,
        _providerOverride: stubProvider,
        _state: reviewState,
        stderr,
      });
      reportVerdicts(entry, verdicts, cfg.review.mode, stderr, { softContext: enforcement === 'soft' });
      const st = fileState.get(entry.path);
      for (const v of verdicts) {
        st.verdicts[v.rule] = v.verdict;
        st.totalDuration += v.duration_ms;
        if (v.verdict === 'fail') { hardFailure = true; rejectCount++; }
        // Spec §22: provider errors (missing key, unreachable daemon) must NOT block.
        // They already appear as [error] on stderr via reportVerdicts. Never promote to exit 1.
      }
      // Decrement once per pair, regardless of verdict count: intent skip-no produces 0 verdicts
      // but the pair was still consumed. Decrementing by verdicts.length would leave pendingPairs
      // stuck above 0 and the file-summary would never be emitted.
      st.pendingPairs -= 1;
      if (st.pendingPairs === 0 && historySession) {
        await historySession.append({
          type: 'file-summary',
          file: entry.path,
          matched_rules: st.matched,
          verdicts: st.verdicts,
          duration_ms: st.totalDuration,
        });
      }
    }));
  } finally {
    if (historySession) await historySession.close();
  }

  // UX: print a debug hint when precommit quick-mode has rejects
  if (context === 'precommit' && cfg.review.mode === 'quick' && hardFailure) {
    stderr.write(`\n[hint] One or more rules rejected. For file:line details, re-run with thinking mode:\n  node ${env.CLAUDE_PLUGIN_ROOT ?? 'plugin-root'}/scripts/bin/validate.mjs --files <path> --rule <rule-id> --mode thinking\n  Or ask the AutoReview agent "why did the commit fail?"\n`);
  }

  if (enforcement === 'soft' && hardFailure) {
    stderr.write(`[info] review would have blocked under hard enforcement (${rejectCount} rule(s) rejected) — exit 0 per soft mode\n`);
  }

  if (enforcement === 'hard' && hardFailure) return 1;
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
