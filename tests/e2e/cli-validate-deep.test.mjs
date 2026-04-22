// tests/e2e/cli-validate-deep.test.mjs — deeper validate scenarios beyond the core V-set.
// Focus on config-driven behavior: context overrides, rule filters, chunker,
// history artifacts, remote auto-pull. Stubbed for determinism.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

const baseCfg = {
  review: {
    evaluate: 'full', mode: 'quick', consensus: 1,
    context_window_bytes: 'auto', output_reserve_bytes: 2000, walk_file_cap: 10000,
  },
};

test('DV1 + --context precommit applies context_overrides (scope=staged picked automatically)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('staged.ts', 'x');
    await env.write('unstaged.ts', 'x');
    env.git('add', 'staged.ts');
    // No explicit scope — precommit context defaults to scope: staged via context_overrides.
    const r = await env.run('validate', ['--context', 'precommit'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /staged\.ts/);
    assert.doesNotMatch(r.stderr, /unstaged\.ts/);
  } finally { await env.cleanup(); }
});

test('DV2 + chunker skips files that cannot fit context_window_bytes -> [error] skip: reason', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    // Very small window forces skip decision.
    await env.writeConfig({
      review: { ...baseCfg.review, context_window_bytes: 200 },
    });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    // File well above the window budget.
    const big = 'x'.repeat(10000);
    const f = await env.write('big.ts', big);
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    // skip gets reported as [error] with "skip:" reason; exit 0 because it's a tool-side issue.
    assert.match(r.stderr, /\[error\].*skip:|skip:/);
    assert.equal(r.code, 0);
  } finally { await env.cleanup(); }
});

test('DV3 + rules.disabled list excludes named rule', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({
      ...baseCfg,
      rules: { disabled: ['rule-b'], enabled_extra: [] },
    });
    await env.writeRule('rule-a.md', { name: 'A', triggers: 'path:"**/*.ts"' }, 'body');
    await env.writeRule('rule-b.md', { name: 'B', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /rule-a/);
    assert.doesNotMatch(r.stderr, /rule-b/);
  } finally { await env.cleanup(); }
});

test('DV4 + rules.enabled_extra re-enables a rule with default:disabled frontmatter', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({
      ...baseCfg,
      rules: { disabled: [], enabled_extra: ['opt-in-rule'] },
    });
    // Rule with default: disabled is skipped unless enabled_extra lists it.
    await env.writeRule('opt-in-rule.md',
      { name: 'Opt', triggers: 'path:"**/*.ts"', default: 'disabled' },
      'body');
    await env.writeRule('always-on.md',
      { name: 'Always', triggers: 'path:"**/*.ts"' },
      'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /opt-in-rule/);
    assert.match(r.stderr, /always-on/);
  } finally { await env.cleanup(); }
});

test('DV4b + default:disabled rule is excluded when NOT in enabled_extra', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('opt.md',
      { name: 'Opt', triggers: 'path:"**/*.ts"', default: 'disabled' },
      'body');
    await env.writeRule('on.md',
      { name: 'On', triggers: 'path:"**/*.ts"' },
      'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /:: opt\b/);
    assert.match(r.stderr, /:: on\b/);
  } finally { await env.cleanup(); }
});

test('DV5 + history JSONL written during validate (streaming)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({ ...baseCfg, history: { log_to_file: true } });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    const files = await readdir(join(env.dir, '.autoreview/.history'));
    const jsonl = files.filter(f => f.endsWith('.jsonl'));
    assert.ok(jsonl.length >= 1, `expected .jsonl file, got: ${files.join(',')}`);
    const raw = await readFile(join(env.dir, '.autoreview/.history', jsonl[0]), 'utf8');
    const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(lines.some(l => l.type === 'verdict' && l.verdict === 'pass'));
  } finally { await env.cleanup(); }
});

test('DV6 + remote_rules_auto_pull: true clones source during validate', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    // Create a tiny local "remote" git repo to act as rule source.
    const remote = await (await import('node:fs/promises')).mkdtemp(join(tmpdir(), 'ar-vd-remote-'));
    const run = (...a) => spawnSync('git', a, { cwd: remote, encoding: 'utf8' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'rem@test');
    run('config', 'user.name', 'rem');
    await mkdir(join(remote, 'rules'), { recursive: true });
    await writeFile(join(remote, 'rules', 'shared.md'),
      `---\nname: "Shared"\ntriggers: 'path:"**/*.ts"'\n---\nbody\n`);
    run('add', '-A');
    run('commit', '-qm', 'seed');
    run('tag', 'v1.0.0');

    await env.writeConfig({
      ...baseCfg,
      review: { ...baseCfg.review, remote_rules_auto_pull: true },
      remote_rules: [{ name: 'team', url: `file://${remote}`, ref: 'v1.0.0', path: 'rules' }],
    });
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    // Remote rules must have been cloned & cached under <target>/<path>/
    assert.ok(env.exists('.autoreview/remote_rules/team/v1.0.0/rules/shared.md'));
    // The remote rule must have been applied (rule id = team/shared)
    assert.match(r.stderr, /team\/shared/);
    // Cleanup remote
    await (await import('node:fs/promises')).rm(remote, { recursive: true, force: true });
  } finally { await env.cleanup(); }
});

test('DV6b + remote_rules_auto_pull: false only warns about missing cache', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({
      ...baseCfg,
      review: { ...baseCfg.review, remote_rules_auto_pull: false },
      remote_rules: [{ name: 'team', url: 'https://example.com/x.git', ref: 'v1', path: '.' }],
    });
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\] remote source.*has no cache/);
  } finally { await env.cleanup(); }
});

test('DV7 + --rule filter limits evaluation to named rule', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('alpha.md', { name: 'Alpha', triggers: 'path:"**/*.ts"' }, 'body');
    await env.writeRule('beta.md',  { name: 'Beta',  triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f, '--rule', 'alpha'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /:: alpha/);
    assert.doesNotMatch(r.stderr, /:: beta/);
  } finally { await env.cleanup(); }
});

test('DV8 + --reasoning-effort flag overrides config value', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({ ...baseCfg, review: { ...baseCfg.review, reasoning_effort: 'medium' } });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f, '--reasoning-effort', 'high'], { stub: 'pass' });
    assert.equal(r.code, 0);
    // Stub provider doesn't support reasoning_effort — warn must fire with the effective value
    assert.match(r.stderr, /reasoning_effort/);
  } finally { await env.cleanup(); }
});

test('DV9 + consensus: 3 makes three provider calls (stub call-log counts)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({ ...baseCfg, review: { ...baseCfg.review, consensus: 3 } });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    const logPath = join(tmpdir(), `ar-calls-${Date.now()}.jsonl`);
    const r = await env.run('validate', ['--files', f], {
      stub: 'pass',
      env: { AUTOREVIEW_STUB_CALL_LOG: logPath },
    });
    assert.equal(r.code, 0);
    const lines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 3, `expected 3 calls, got ${lines.length}`);
  } finally { await env.cleanup(); }
});

test('DV10 + evaluate: diff mode passes diff to reviewer (call log records diff presence)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({ ...baseCfg, review: { ...baseCfg.review, evaluate: 'diff' } });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    // Create a file, commit it, then modify — so `--scope uncommitted` produces a non-empty diff.
    await env.write('file.ts', 'one\n');
    env.git('add', '-A');
    env.git('commit', '-qm', 'seed');
    await env.write('file.ts', 'one\ntwo\n');
    const logPath = join(tmpdir(), `ar-diff-${Date.now()}.jsonl`);
    const r = await env.run('validate', ['--scope', 'uncommitted'], {
      stub: 'pass',
      env: { AUTOREVIEW_STUB_CALL_LOG: logPath },
    });
    assert.equal(r.code, 0);
    const lines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(lines.length >= 1);
    assert.ok(lines[0].diffPresent, 'prompt must contain a non-empty <diff> block in diff mode');
  } finally { await env.cleanup(); }
});

test('DV11 + history sidecar: long reason spills to sidecar file, JSONL keeps reason_sidecar ref', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({ ...baseCfg, enforcement: { precommit: 'soft', validate: 'soft' } });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('a.ts', 'x');
    // Reason > MAX_RECORD_BYTES (3500) — forces sidecar
    const longReason = 'x'.repeat(5000);
    const r = await env.run('validate', ['--files', f], {
      stub: 'fail',
      env: { AUTOREVIEW_STUB_REASON: longReason },
    });
    assert.equal(r.code, 0); // soft, reject doesn't block
    const dir = `${env.dir}/.autoreview/.history`;
    const files = await readdir(dir);
    const jsonl = files.find(f => f.endsWith('.jsonl'));
    assert.ok(jsonl, 'expected jsonl file');
    const raw = await readFile(`${dir}/${jsonl}`, 'utf8');
    const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const verdict = lines.find(l => l.type === 'verdict');
    assert.ok(verdict.reason_sidecar, 'reason_sidecar should point to offloaded file');
    // Sidecar path is repo-root-relative (e.g. ".autoreview/.history/2026-04-22/<sha>.txt")
    const sidecarPath = `${env.dir}/${verdict.reason_sidecar}`;
    const sidecarBody = await readFile(sidecarPath, 'utf8');
    assert.ok(sidecarBody.length >= 5000);
  } finally { await env.cleanup(); }
});

test('DV12 + per-rule provider frontmatter override routes to named provider', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    // Config: default provider = anthropic (no key → unavailable).
    // Rule frontmatter: provider = openai (also no key). Each triggers a distinct error.
    await env.writeConfig({
      ...baseCfg,
      provider: { active: 'anthropic', anthropic: { model: 'claude-haiku-4-5' }, openai: { model: 'gpt-4o-mini' } },
    });
    await env.writeRule('base.md',
      { name: 'Base', triggers: 'path:"**/*.ts"' },
      'body');
    await env.writeRule('overridden.md',
      { name: 'Overridden', triggers: 'path:"**/*.ts"', provider: 'openai' },
      'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], {
      env: { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    });
    assert.equal(r.code, 0); // soft on error
    // History should record each rule's provider distinctly.
    const dir = `${env.dir}/.autoreview/.history`;
    const files = await readdir(dir);
    const jsonl = files.find(f => f.endsWith('.jsonl'));
    const raw = await readFile(`${dir}/${jsonl}`, 'utf8');
    const lines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const baseV = lines.find(l => l.type === 'verdict' && l.rule === 'base');
    const overV = lines.find(l => l.type === 'verdict' && l.rule === 'overridden');
    assert.equal(baseV.provider, 'anthropic');
    assert.equal(overV.provider, 'openai');
  } finally { await env.cleanup(); }
});

test('DV13 + intent-gate budget exhaustion emits one-time warning', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('vd');
  try {
    await env.writeConfig({
      ...baseCfg,
      review: { ...baseCfg.review, intent_triggers: true, intent_trigger_budget: 0 },
    });
    // Rule with intent frontmatter — requires the Layer-2 intent gate.
    await env.writeRule('r.md',
      { name: 'R', triggers: 'path:"**/*.ts"', intent: 'Files that implement payment mutations' },
      'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    // Budget=0 → first intent check exhausts immediately, warning surfaces.
    assert.match(r.stderr, /intent budget exhausted|intent budget/);
  } finally { await env.cleanup(); }
});
