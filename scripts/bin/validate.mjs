#!/usr/bin/env node
// scripts/bin/validate.mjs
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { resolveScope } from '../lib/scope-resolver.mjs';
import { reviewFile } from '../lib/reviewer.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { createIntentGate } from '../lib/intent-gate.mjs';
import { reportVerdicts } from '../lib/report.mjs';
import { createHistorySession } from '../lib/history.mjs';
import { readFileOrNull, isBinary } from '../lib/fs-utils.mjs';
import { readFile } from 'node:fs/promises';
import { pullSource } from '../lib/remote-rules-pull.mjs';

function stubProviderByEnv(env) {
  const mode = env.AUTOREVIEW_STUB_PROVIDER;
  if (!mode) return null;
  const map = {
    pass: { satisfied: true },
    fail: { satisfied: false, reason: 'stub fail' },
    error: { satisfied: false, providerError: true, raw: 'stub' },
  };
  return {
    name: 'stub', model: 'stub',
    async verify() { return map[mode]; },
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

  const { rules, warnings: ruleWarnings } = await loadRules(root, cfg);
  for (const w of ruleWarnings) stderr.write(`[warn] ${w}\n`);
  const filtered = values.rule ? rules.filter(r => values.rule.includes(r.id)) : rules;

  // §15: hypothetical pre-check — content from disk scratch file, logical path supplied.
  let entries;
  if (values['content-file'] && values['target-path']) {
    const buf = await readFile(values['content-file']).catch(() => null);
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
    const scopeArgs = {
      repoRoot: root,
      scope: values.scope ?? ctxOverrides.scope,
      sha: values.sha,
      files: values.files,
      dir: values.dir,
      walkCap: cfg.review.walk_file_cap ?? 10000,
    };
    const scopeResult = await resolveScope(scopeArgs);
    for (const w of scopeResult.warnings) stderr.write(`[warn] ${w}\n`);
    entries = scopeResult.entries;
  }

  // §24: warn if any declared remote source is not on disk. Auto-pull if configured.
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

  const historySession = cfg.history.log_to_file ? createHistorySession(root) : null;

  let hardFailure = false;
  let rejectCount = 0;
  const reviewState = { ctxCache: new Map(), warnedReasoning: new Set() };
  for (const entry of entries) {
    if (entry.binary && filtered.some(r => /content:/.test(r.frontmatter.triggers))) {
      stderr.write(`[warn] ${entry.path}: binary detected, content: predicates will not match\n`);
    }
    const { verdicts } = await reviewFile({
      repoRoot: root, config: cfg, rules: filtered,
      file: { path: entry.path, content: entry.content, binary: entry.binary },
      diff: entry.diff,
      intentGate,
      historyEnabled: cfg.history.log_to_file,
      historyAppend: historySession ? rec => historySession.append(rec) : null,
      _providerOverride: stubProvider,
      _state: reviewState,
    });
    reportVerdicts(entry, verdicts, cfg.review.mode, stderr);
    for (const v of verdicts) {
      if (v.verdict === 'fail') { hardFailure = true; rejectCount++; }
      // Spec §22: provider errors (missing key, unreachable daemon) must NOT block.
      // They already appear as [error] on stderr via reportVerdicts. Never promote to exit 1.
    }
  }

  if (historySession) await historySession.close();

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

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
