import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFile } from '../../scripts/lib/reviewer.mjs';
import { parse as parseTrigger } from '../../scripts/lib/trigger-engine.mjs';

const DEFAULT_TIER = {
  provider: 'anthropic', model: 'm', parallel: 1, mode: 'quick',
  reasoning_effort: 'medium', consensus: 1, timeout_ms: 60000,
  context_window_bytes: 'auto', output_max_tokens: 0,
};

const BASE_CFG = {
  tiers: { default: DEFAULT_TIER },
  history: { log_to_file: false },
  secrets: {},
};

function stubProviderClient(verifyResult) {
  return {
    verify: async () => verifyResult,
    contextWindowBytes: async () => 16384,
    name: 'stub', model: 'stub-m',
  };
}

function makeRule({ id, name, triggers, body, tier = 'default', severity = 'error', type = 'auto' } = {}) {
  return {
    id, source: 'local', sourceName: null, path: '/tmp/x.md',
    body: body ?? 'require X',
    frontmatter: { name, triggers, tier, severity, type },
    _triggersAst: parseTrigger(triggers),
  };
}

test('file matches rule, provider says pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content: 'const x = 1;' },
      diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts.length, 1);
    assert.equal(res.verdicts[0].verdict, 'pass');
    assert.equal(res.verdicts[0].tier, 'default');
    assert.equal(res.verdicts[0].severity, 'error');
    assert.equal(res.summary.matched_rules.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rule does not match — no verdict recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"src/api/**"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'other.ts', content: 'x' }, diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts.length, 0);
    assert.equal(res.summary.matched_rules.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('providerError yields error verdict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'x.ts', content: 'code' }, diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: false, providerError: true }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts[0].verdict, 'error');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('binary=true makes content: predicate fail-to-match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'content:"@Controller"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.bin', content: '@Controller text', binary: true },
      diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('contextWindowBytes memoized across rules', async () => {
  let calls = 0;
  const prov = {
    name: 'stub', model: 'm',
    verify: async () => ({ satisfied: true }),
    contextWindowBytes: async () => { calls++; return 16384; },
  };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rules = [
      makeRule({ id: 'r1', name: 'R1', triggers: 'path:"**"' }),
      makeRule({ id: 'r2', name: 'R2', triggers: 'path:"**"' }),
    ];
    const sharedState = { ctxCache: new Map(), warnedReasoning: new Set() };
    await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules,
      file: { path: 'a.ts', content: 'c' }, diff: null, historyEnabled: false,
      _providerOverride: prov, _state: sharedState,
      stderr: { write: () => {} },
    });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('warnedReasoning dedupes under concurrent fan-out — exactly one [warn] for N parallel calls', async () => {
  // Lock-in test: the warn check (`!warnedReasoning.has` + `.add`) is a sync block with
  // no await between has/add, so JavaScript's single-threaded event loop guarantees
  // atomicity. The first reviewFile invocation to reach the warn check (post trigger eval)
  // populates the Set; subsequent invocations see the entry and skip.
  // If a future refactor inserts an await between has() and add(), the duplicate-warn
  // race becomes real — this test fails.
  const warns = [];
  const stderr = { write: (msg) => warns.push(msg) };
  const prov = {
    name: 'ollama', model: 'm',
    verify: async () => { await new Promise(r => setTimeout(r, 5)); return { satisfied: true }; },
    contextWindowBytes: async () => 16384,
  };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-warnrace-'));
  try {
    const cfg = {
      tiers: { default: { ...DEFAULT_TIER, reasoning_effort: 'high' } },
      history: { log_to_file: false },
      secrets: {},
    };
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const sharedState = { ctxCache: new Map(), warnedReasoning: new Set() };
    await Promise.all(Array.from({ length: 10 }, () => reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'a.ts', content: 'c' }, diff: null, historyEnabled: false,
      _providerOverride: prov, _state: sharedState, stderr,
    })));
    const reasoningWarns = warns.filter(w => /reasoning_effort/.test(w));
    assert.equal(reasoningWarns.length, 1,
      `expected exactly 1 reasoning_effort warn under concurrent fan-out, got ${reasoningWarns.length}: ${reasoningWarns.join(' | ')}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('contextWindowBytes memoized under concurrent fan-out — single call across N parallel reviewFile invocations', async () => {
  let calls = 0;
  const prov = {
    name: 'stub', model: 'm',
    verify: async () => ({ satisfied: true }),
    // Add a deliberate delay so concurrent callers all reach the has()/await window
    // before any of them finishes populating the cache. With value-only caching, all
    // N callers would call contextWindowBytes; with promise caching, only one call.
    contextWindowBytes: async () => { calls++; await new Promise(r => setTimeout(r, 30)); return 16384; },
  };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-ctxrace-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const sharedState = { ctxCache: new Map(), warnedReasoning: new Set() };
    await Promise.all(Array.from({ length: 10 }, () => reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content: 'c' }, diff: null, historyEnabled: false,
      _providerOverride: prov, _state: sharedState,
      stderr: { write: () => {} },
    })));
    assert.equal(calls, 1, `contextWindowBytes() must be called once, got ${calls}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('suppressed field in provider reply produces suppressed verdict (§27)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r explain' },
      diff: null, historyEnabled: false,
      _providerOverride: {
        name: 'stub', model: 'm',
        verify: async () => ({ satisfied: true, reason: 'ok', suppressed: [{ line: 1, reason: 'explain' }] }),
        contextWindowBytes: async () => 16384,
      },
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts[0].verdict, 'suppressed');
    assert.equal(res.verdicts[0].suppressed[0].line, 1);
    assert.equal(res.verdicts[0].suppressed[0].reason, 'explain');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('valid @autoreview-ignore marker does NOT short-circuit — LLM decides per §27', async () => {
  let providerCalls = 0;
  const prov = {
    name: 'stub', model: 'm',
    verify: async () => { providerCalls++; return { satisfied: true, reason: 'ok' }; },
    contextWindowBytes: async () => 16384,
  };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"' });
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r explanation here\nconst x = 1;' },
      diff: null, historyEnabled: false,
      _providerOverride: prov,
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(providerCalls, 1);
    assert.equal(res.verdicts[0].verdict, 'pass');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scanSuppressMarkers rejects markers missing reason', async () => {
  const { scanSuppressMarkers } = await import('../../scripts/lib/suppress-parser.mjs');
  const m = scanSuppressMarkers('// @autoreview-ignore r\nconst x = 1;');
  assert.equal(m.length, 1);
  assert.equal(m[0].valid, false);
});

test('warns once when provider does not support reasoning_effort', async () => {
  const warns = [];
  const stderr = { write: (msg) => warns.push(msg) };
  const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
  const cfg = {
    tiers: { default: { ...DEFAULT_TIER, reasoning_effort: 'high' } },
    history: { log_to_file: false },
    secrets: {},
  };
  const prov = { name: 'ollama', model: 'x', verify: async () => ({ satisfied: true }), contextWindowBytes: async () => 16384 };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    await reviewFile({
      repoRoot: dir, config: cfg, rules: [rule, rule],
      file: { path: 'a.ts', content: 'c' }, diff: null, historyEnabled: false,
      _providerOverride: prov,
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr,
    });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /ollama.*reasoning_effort/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid marker (missing reason) emits warning but still calls provider', async () => {
  const warns = [];
  const stderr = { write: (msg) => warns.push(msg) };
  let providerCalls = 0;
  const prov = {
    name: 'stub', model: 'm',
    verify: async () => { providerCalls++; return { satisfied: true }; },
    contextWindowBytes: async () => 16384,
  };
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"' });
    await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r\nconst x = 1;' },
      diff: null, historyEnabled: false,
      _providerOverride: prov,
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr,
    });
    assert.equal(providerCalls, 1);
    assert.ok(warns.some(w => /missing mandatory/.test(w)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scope_hint from parser enriches suppressed records when line matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const content = '// @autoreview-ignore r explain\nconst x = 1;';
    const res = await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'a.ts', content },
      diff: null, historyEnabled: false,
      _providerOverride: {
        name: 'stub', model: 'm',
        verify: async () => ({ satisfied: true, reason: 'ok', suppressed: [{ line: 1, reason: 'explain' }] }),
        contextWindowBytes: async () => 16384,
      },
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts[0].verdict, 'suppressed');
    assert.equal(res.verdicts[0].suppressed[0].scope_hint, 'file-top');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('truncated file + satisfied=true -> verdict=error (no silent false-pass)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-trunc-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    // Force truncation: big file, tiny context window.
    // With context_window_bytes=16000 + boilerplate ~1750 + reserve 2000 → available ~12250.
    // 20000 bytes sits between 12250 and ~36750, so chunker should truncate.
    const huge = 'a'.repeat(20000);
    const cfg = {
      tiers: { default: { ...DEFAULT_TIER, context_window_bytes: 16000 } },
      history: { log_to_file: false },
      secrets: {},
    };
    const res = await reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'a.ts', content: huge },
      diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'looks fine' }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts[0].verdict, 'error');
    assert.match(res.verdicts[0].reason, /truncated|partial content/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('truncated file + satisfied=false -> verdict=fail (violation is real)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-trunc2-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const huge = 'a'.repeat(20000);
    const cfg = {
      tiers: { default: { ...DEFAULT_TIER, context_window_bytes: 16000 } },
      history: { log_to_file: false },
      secrets: {},
    };
    const res = await reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'a.ts', content: huge },
      diff: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: false, reason: 'found violation at line 1' }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    assert.equal(res.verdicts[0].verdict, 'fail');
    assert.match(res.verdicts[0].reason, /found violation/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('historyEnabled writes verdict line only (no file-summary from reviewer)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-h-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    await reviewFile({
      repoRoot: dir, config: BASE_CFG, rules: [rule],
      file: { path: 'x.ts', content: 'c' }, diff: null, historyEnabled: true,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const lines = body.trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, 'verdict');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('parallelism observation: parallel: 5 caps 10 concurrent reviewFile calls to ~200ms (spec §F.1)', async () => {
  const { _SEMAPHORES, clearProviderCache } = await import('../../scripts/lib/provider-client.mjs');
  clearProviderCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-par-'));
  try {
    const cfg = {
      tiers: { default: { ...DEFAULT_TIER, provider: 'ollama', parallel: 5, endpoint: 'http://localhost:11434' } },
      history: { log_to_file: false },
      secrets: {},
    };
    let inFlight = 0, peak = 0;
    const slowProvider = {
      name: 'ollama', model: 'm',
      verify: async () => {
        inFlight++; if (inFlight > peak) peak = inFlight;
        await new Promise(r => setTimeout(r, 100));
        inFlight--;
        return { satisfied: true, reason: 'ok' };
      },
      contextWindowBytes: async () => 16384,
    };
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const { Semaphore } = await import('../../scripts/lib/concurrency.mjs');
    const sem = new Semaphore(5);
    const wrapped = { ...slowProvider, verify: () => sem.run(() => slowProvider.verify()) };
    const start = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'a.ts', content: 'x' }, diff: null, historyEnabled: false,
      _providerOverride: wrapped,
      _state: { ctxCache: new Map(), warnedReasoning: new Set() },
      stderr: { write: () => {} },
    })));
    const elapsed = Date.now() - start;
    assert.equal(peak, 5, `peak in-flight should be 5, got ${peak}`);
    assert.ok(elapsed >= 180 && elapsed < 500, `expected ~200ms (two batches of 5 × 100ms), got ${elapsed}ms`);
  } finally {
    await rm(dir, { recursive: true, force: true });
    clearProviderCache();
  }
});

test('reviewer dispatches via tier in rule frontmatter', async () => {
  let receivedPrompt = null;
  const stub = {
    name: 'stub', model: 'stub-model',
    verify: async (p) => { receivedPrompt = p; return { satisfied: true }; },
    contextWindowBytes: async () => 16384,
  };
  const cfg = {
    tiers: {
      default: { provider: 'anthropic', model: 'haiku', parallel: 1, mode: 'quick', reasoning_effort: 'medium', consensus: 1, timeout_ms: 60000, context_window_bytes: 'auto', output_max_tokens: 0 },
    },
    history: { log_to_file: false },
    secrets: {},
  };
  const rule = {
    id: 'r1', source: 'local',
    frontmatter: { name: 'R', triggers: 'path:"**/*"', tier: 'default', severity: 'error', type: 'auto' },
    body: 'check',
  };
  rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
  const file = { path: 'a.ts', content: 'x', binary: false };
  const { verdicts } = await reviewFile({
    repoRoot: '/tmp/r', config: cfg, rules: [rule], file,
    _providerOverride: stub, _state: { ctxCache: new Map(), warnedReasoning: new Set() },
    stderr: { write: () => {} },
  });
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'pass');
  assert.equal(verdicts[0].provider, 'stub');
  assert.equal(verdicts[0].tier, 'default');
  assert.equal(verdicts[0].severity, 'error');
});

test('rule with _invalid marker produces [error] verdict', async () => {
  const cfg = {
    tiers: { default: { provider: 'anthropic', model: 'm', parallel: 1, mode: 'quick', reasoning_effort: 'medium', consensus: 1, timeout_ms: 60000, context_window_bytes: 'auto', output_max_tokens: 0 } },
    history: { log_to_file: false },
    secrets: {},
  };
  const rule = {
    id: 'bad', source: 'local',
    frontmatter: { name: 'Bad', triggers: 'path:"**/*"', tier: 'bogus', severity: 'error', type: 'auto', _invalid: "tier 'bogus' unknown" },
    body: 'x',
  };
  rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
  const stub = {
    name: 'stub', model: 'sm',
    verify: async () => { throw new Error('should not be called'); },
    contextWindowBytes: async () => 16384,
  };
  const { verdicts } = await reviewFile({
    repoRoot: '/tmp', config: cfg, rules: [rule],
    file: { path: 'a.ts', content: 'x', binary: false },
    _providerOverride: stub, _state: { ctxCache: new Map(), warnedReasoning: new Set() },
    stderr: { write: () => {} },
  });
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'error');
  assert.match(verdicts[0].reason, /tier 'bogus' unknown/);
});

test('_invalid rule with non-matching triggers produces no verdict', async () => {
  const cfg = {
    tiers: { default: { ...DEFAULT_TIER } },
    history: { log_to_file: false },
    secrets: {},
  };
  const rule = {
    id: 'bad', source: 'local',
    frontmatter: { name: 'Bad', triggers: 'path:"src/**"', tier: 'default', severity: 'error', type: 'auto', _invalid: "some error" },
    body: 'x',
  };
  rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
  const { verdicts } = await reviewFile({
    repoRoot: '/tmp', config: cfg, rules: [rule],
    file: { path: 'other/file.ts', content: 'x', binary: false },
    _state: { ctxCache: new Map(), warnedReasoning: new Set() },
    stderr: { write: () => {} },
  });
  assert.equal(verdicts.length, 0);
});

test('reviewer always sees full file content (evaluate gone)', async () => {
  let promptSeen = null;
  const stub = { name: 'stub', model: 'm', verify: async (p) => { promptSeen = p; return { satisfied: true }; }, contextWindowBytes: async () => 16384 };
  const cfg = {
    tiers: { default: { provider: 'anthropic', model: 'm', parallel: 1, mode: 'quick', reasoning_effort: 'medium', consensus: 1, timeout_ms: 60000, context_window_bytes: 'auto', output_max_tokens: 0 } },
    history: { log_to_file: false },
    secrets: {},
  };
  const rule = {
    id: 'r', source: 'local',
    frontmatter: { name: 'R', triggers: 'path:"**/*"', tier: 'default', severity: 'error', type: 'auto' },
    body: 'check',
  };
  rule._triggersAst = parseTrigger(rule.frontmatter.triggers);
  await reviewFile({
    repoRoot: '/tmp', config: cfg, rules: [rule],
    file: { path: 'a.ts', content: 'FULL_FILE_MARKER', binary: false },
    diff: 'DIFF_MARKER',
    _providerOverride: stub, _state: { ctxCache: new Map(), warnedReasoning: new Set() },
    stderr: { write: () => {} },
  });
  assert.match(promptSeen, /FULL_FILE_MARKER/);
});
