// tests/e2e/cli-session-start.test.mjs — S1..S6: SessionStart hook (never blocks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E, serverAvailable, REPO_ROOT } from './helpers/harness.mjs';
import { run as sessionStart } from '../../scripts/bin/session-start.mjs';

async function runHook(env, extraEnv = {}) {
  const out = [], err = [];
  const code = await sessionStart([], {
    cwd: env.dir,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT, ...extraEnv },
    stdout: { write: s => out.push(s) },
    stderr: { write: s => err.push(s) },
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

test('S1 + .autoreview present + server reachable -> exit 0, provider reachable', async (t) => {
  skipUnlessE2E(t);
  if (!await serverAvailable()) t.skip('server unreachable');
  const env = await createEnv('ss');
  try {
    await env.writeConfig();
    const r = await runHook(env);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /provider openai-compat:/);
    assert.match(r.stderr, /reachable/);
  } finally { await env.cleanup(); }
});

test('S2 + no .autoreview -> exit 0 with actionable init hint on stdout', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ss');
  try {
    const r = await runHook(env);
    assert.equal(r.code, 0);
    // Hint goes to stdout (agent context) so Claude can relay it to the user.
    assert.match(r.stdout, /\[autoreview\].*does not exist/);
    assert.match(r.stdout, /\/autoreview:init/);
  } finally { await env.cleanup(); }
});

test('S3 + invalid YAML -> exit 0, [warn] on stderr', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ss');
  try {
    await env.write('.autoreview/config.yaml', 'version: "0.1"\n:: bad yaml : broken\n  *anchor\n');
    const r = await runHook(env);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\]|\[error\]/);
  } finally { await env.cleanup(); }
});

test('S4 + anthropic provider without API key -> exit 0, unreachable', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ss');
  try {
    await env.writeConfig({
      provider: { active: 'anthropic', anthropic: { model: 'claude-haiku-4-5' } },
    });
    const r = await runHook(env, { ANTHROPIC_API_KEY: '' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /provider anthropic:\s*(unreachable|timeout)/);
  } finally { await env.cleanup(); }
});

test('S5 + ollama active + unreachable -> exit 0 with unreachable marker', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ss');
  try {
    // Point ollama at a dead port
    await env.writeConfig({
      provider: {
        active: 'ollama',
        ollama: { endpoint: 'http://127.0.0.1:1', model: 'gemma4:e4b' },
      },
    });
    const r = await runHook(env);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /provider ollama:\s*(unreachable|timeout)/);
  } finally { await env.cleanup(); }
});

test('S6 + CLAUDE_PLUGIN_ROOT set -> agent-rules.md streamed to stdout', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ss');
  try {
    await env.writeConfig();
    const r = await runHook(env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /AutoReview/);
  } finally { await env.cleanup(); }
});
