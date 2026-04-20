import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFile, clearContextWindowCache } from '../../scripts/lib/reviewer.mjs';
import { DEFAULT_CONFIG } from '../../scripts/lib/config-loader.mjs';
import { parse as parseTrigger } from '../../scripts/lib/trigger-engine.mjs';

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

test('binary=true makes content: predicate fail-to-match', async () => {
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

test('historyEnabled writes verdict + file-summary lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rv-h-'));
  try {
    const rule = makeRule({ id: 'r', name: 'R', triggers: 'path:"**/*.ts"' });
    await reviewFile({
      repoRoot: dir, config: DEFAULT_CONFIG, rules: [rule],
      file: { path: 'x.ts', content: 'c' }, diff: null, intentGate: null, historyEnabled: true,
      _providerOverride: stubProviderClient({ satisfied: true, reason: 'ok' }),
    });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/history', `${day}.jsonl`), 'utf8');
    const lines = body.trim().split('\n').map(JSON.parse);
    assert.equal(lines[0].type, 'verdict');
    assert.equal(lines[1].type, 'file-summary');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
