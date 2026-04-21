import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFile, clearContextWindowCache, clearReasoningWarnings } from '../../scripts/lib/reviewer.mjs';
import { DEFAULT_CONFIG } from '../../scripts/lib/config-loader.mjs';
import { parse as parseTrigger } from '../../scripts/lib/trigger-engine.mjs';
import { buildPrompt } from '../../scripts/lib/prompt-builder.mjs';

function stubProviderClient(verifyResult) {
  return {
    verify: async () => verifyResult,
    contextWindowBytes: async () => 16384,
    name: 'stub', model: 'stub-m',
  };
}

function makeRule({ id, name, triggers, body, provider = null, model = null, intent = null } = {}) {
  return {
    id, source: 'local', sourceName: null, path: '/tmp/x.md',
    body: body ?? 'require X',
    frontmatter: { name, triggers, provider, model, intent },
    _triggersAst: parseTrigger(triggers),
  };
}

test('file matches rule, provider says pass', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content: 'const x = 1;' },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
    });
    assert.equal(res.verdicts.length, 1);
    assert.equal(res.verdicts[0].verdict, 'pass');
    assert.equal(res.summary.matched_rules.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rule does not match — no verdict recorded', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"src/api/**"' });
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'other.ts', content: 'x' }, diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true }),
    });
    assert.equal(res.verdicts.length, 0);
    assert.equal(res.summary.matched_rules.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('providerError yields error verdict', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"' });
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'x.ts', content: 'code' }, diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: false, providerError: true }),
    });
    assert.equal(res.verdicts[0].verdict, 'error');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('intent gate skip-no drops the verdict', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"', intent: 'handler' });
    const cfg = { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, intent_triggers: true } };
    const gate = { check: async () => 'skip-no' };
    const res = await reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'x.ts', content: 'code' }, diff: null, intentGate: gate, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true }),
    });
    assert.equal(res.verdicts.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('intent gate skip-budget falls through to verify (design §3)', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**"', intent: 'handler' });
    const cfg = { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, intent_triggers: true } };
    const gate = { check: async () => 'skip-budget' };
    const res = await reviewFile({
      repoRoot: dir, config: cfg, rules: [rule],
      file: { path: 'x.ts', content: 'code' }, diff: null, intentGate: gate, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
    });
    assert.equal(res.verdicts.length, 1);
    assert.equal(res.verdicts[0].verdict, 'pass');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('binary=true makes content: predicate fail-to-match', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'content:"@Controller"' });
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.bin', content: '@Controller text', binary: true },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: stubProviderClient({ satisfied: true }),
    });
    assert.equal(res.verdicts.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('contextWindowBytes memoized across rules', async () => {
  clearContextWindowCache();
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
    await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules,
      file: { path: 'a.ts', content: 'c' }, diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: prov,
    });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('per-rule frontmatter.evaluate overrides global evaluate (§20)', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    // Global default is 'diff'; rule overrides to 'full'
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    rule.frontmatter.evaluate = 'full';
    let capturedPrompt = null;
    const prov = {
      name: 'stub', model: 'm',
      verify: async (prompt) => { capturedPrompt = prompt; return { satisfied: true, reason: 'ok' }; },
      contextWindowBytes: async () => 16384,
    };
    await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content: 'x' }, diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: prov,
    });
    assert.ok(capturedPrompt, 'provider should have been called');
    assert.match(capturedPrompt, /Evaluate: full/, 'prompt should contain per-rule evaluate=full');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('suppressed field in provider reply produces suppressed verdict (§27)', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r explain' },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: {
        name: 'stub', model: 'm',
        verify: async () => ({ satisfied: true, reason: 'ok', suppressed: [{ line: 1, reason: 'explain' }] }),
        contextWindowBytes: async () => 16384,
      },
    });
    assert.equal(res.verdicts[0].verdict, 'suppressed');
    // suppressed entries now include scope when coming from marker path; provider-supplied suppressed
    // entries pass through as-is (no scope added). This test uses a provider-supplied suppressed field.
    assert.equal(res.verdicts[0].suppressed[0].line, 1);
    assert.equal(res.verdicts[0].suppressed[0].reason, 'explain');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('valid @autoreview-ignore marker does NOT short-circuit — LLM decides per §27', async () => {
  clearContextWindowCache();
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
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r explanation here\nconst x = 1;' },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: prov,
    });
    assert.equal(providerCalls, 1);
    assert.equal(res.verdicts[0].verdict, 'pass'); // stub returned satisfied:true
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scanSuppressMarkers rejects markers missing reason', async () => {
  const { scanSuppressMarkers } = await import('../../scripts/lib/suppress-parser.mjs');
  const m = scanSuppressMarkers('// @autoreview-ignore r\nconst x = 1;');
  assert.equal(m.length, 1);
  assert.equal(m[0].valid, false);
});

test('warns once when provider does not support reasoning_effort', async () => {
  clearContextWindowCache();
  clearReasoningWarnings();
  const origError = console.error;
  const warns = [];
  console.error = (s) => warns.push(s);
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    const cfg = { ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, reasoning_effort: 'high' } };
    const prov = { name: 'ollama', model: 'x', verify: async () => ({ satisfied: true }), contextWindowBytes: async () => 16384 };
    const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
    try {
      await reviewFile({
        repoRoot: dir, config: cfg, rules: [rule, rule],
        file: { path: 'a.ts', content: 'c' }, diff: null, intentGate: null, historyEnabled: false,
        _providerOverride: prov,
      });
      assert.equal(warns.length, 1);
      assert.match(warns[0], /ollama.*reasoning_effort/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  } finally { console.error = origError; }
});

test('invalid marker (missing reason) emits warning but still calls provider', async () => {
  clearContextWindowCache();
  const origError = console.error;
  const warns = [];
  console.error = (s) => warns.push(s);
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
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content: '// @autoreview-ignore r\nconst x = 1;' },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: prov,
    });
    assert.equal(providerCalls, 1);
    assert.ok(warns.some(w => /missing mandatory/.test(w)));
  } finally {
    console.error = origError;
    await rm(dir, { recursive: true, force: true });
  }
});

test('scope_hint from parser enriches suppressed records when line matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    // Line 1 is within first 5 lines → scope 'file-top'
    const content = '// @autoreview-ignore r explain\nconst x = 1;';
    const res = await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'a.ts', content },
      diff: null, intentGate: null, historyEnabled: false,
      _providerOverride: {
        name: 'stub', model: 'm',
        verify: async () => ({ satisfied: true, reason: 'ok', suppressed: [{ line: 1, reason: 'explain' }] }),
        contextWindowBytes: async () => 16384,
      },
    });
    assert.equal(res.verdicts[0].verdict, 'suppressed');
    assert.equal(res.verdicts[0].suppressed[0].scope_hint, 'file-top');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('historyEnabled writes verdict + file-summary lines', async () => {
  clearContextWindowCache();
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-h-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'x.ts', content: 'c' }, diff: null, intentGate: null, historyEnabled: true,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
    });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const lines = body.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].type, 'verdict');
    assert.equal(lines[1].type, 'file-summary');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
