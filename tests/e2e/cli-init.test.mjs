// tests/e2e/cli-init.test.mjs — I1..I10: scaffolding `.autoreview/` in a repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createEnv, skipUnlessE2E, REPO_ROOT } from './helpers/harness.mjs';

test('I1 + fresh repo + --provider openai-compat -> full scaffold', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r.code, 0);
    for (const rel of [
      '.autoreview/config.yaml',
      '.autoreview/config.personal.yaml',
      '.autoreview/config.secrets.yaml',
      '.autoreview/rules',
      '.autoreview/.history',
      '.autoreview/remote_rules',
      '.autoreview/runtime',
    ]) {
      assert.ok(env.exists(rel), `missing ${rel}`);
    }
    const cfg = await env.read('.autoreview/config.yaml');
    assert.match(cfg, /active:\s*openai-compat/);
  } finally { await env.cleanup(); }
});

test('I2 + --install-precommit installs executable hook; idempotent on --upgrade', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'openai-compat', '--install-precommit']);
    assert.equal(r.code, 0);
    assert.ok(env.exists('.git/hooks/pre-commit'));
    const body1 = await env.read('.git/hooks/pre-commit');
    // Re-run with --upgrade: idempotent path, should not error
    const r2 = await env.run('init', ['--provider', 'openai-compat', '--install-precommit', '--upgrade']);
    assert.equal(r2.code, 0);
    const body2 = await env.read('.git/hooks/pre-commit');
    assert.equal(body1, body2, 'hook body must not drift');
  } finally { await env.cleanup(); }
});

test('I3 + second run without --upgrade -> [info] already exists, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r1 = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r1.code, 0);
    const r2 = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r2.code, 0);
    assert.match(r2.stderr, /already exists/);
  } finally { await env.cleanup(); }
});

test('I4 + --upgrade rewrites config but preserves user rules', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r1 = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r1.code, 0);
    await env.writeRule('mine.md', { name: 'Mine', triggers: 'dir:"src"' }, 'custom rule');
    const r2 = await env.run('init', ['--provider', 'ollama', '--upgrade']);
    assert.equal(r2.code, 0);
    assert.ok(env.exists('.autoreview/rules/mine.md'), 'user rule deleted');
    const cfg = await env.read('.autoreview/config.yaml');
    assert.match(cfg, /active:\s*ollama/);
  } finally { await env.cleanup(); }
});

test('I5 + --provider not given -> exit 1, stdout lists options', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', []);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ollama/);
    assert.match(r.stdout, /anthropic/);
    assert.match(r.stderr, /re-run with --provider/);
  } finally { await env.cleanup(); }
});

test('I6 - unknown --provider foo -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'foo']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown provider/);
  } finally { await env.cleanup(); }
});

test('I7 - not a git repo -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init', { noGit: true });
  try {
    const r = await env.run('init', ['--provider', 'ollama']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a git repo/);
  } finally { await env.cleanup(); }
});

test('I8 + paid provider without API key env -> [warn] printed, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    // Deliberately strip key env vars via override
    const r = await env.run('init', ['--provider', 'anthropic'], {
      env: { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GOOGLE_API_KEY: '' },
    });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /requires an API key/);
  } finally { await env.cleanup(); }
});

test('I9 + gitignore patched with 4 runtime patterns', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r.code, 0);
    const gi = await env.read('.gitignore');
    for (const pat of [
      '.autoreview/config.personal.yaml',
      '.autoreview/config.secrets.yaml',
      '.autoreview/.history/',
      '.autoreview/runtime/',
    ]) {
      assert.ok(gi.includes(pat), `gitignore missing ${pat}`);
    }
  } finally { await env.cleanup(); }
});

test('I-skip-example + --skip-example writes no example rule', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'openai-compat', '--skip-example']);
    assert.equal(r.code, 0);
    assert.ok(!env.exists('.autoreview/rules/example.md'), 'example.md should not exist');
  } finally { await env.cleanup(); }
});

test('I-runtime-copy + init populates .autoreview/runtime/{lib,bin/validate.mjs}', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    const r = await env.run('init', ['--provider', 'openai-compat']);
    assert.equal(r.code, 0);
    assert.ok(env.exists('.autoreview/runtime/bin/validate.mjs'));
    // lib is copied as a directory — verify at least one known file is present.
    assert.ok(env.exists('.autoreview/runtime/lib/reviewer.mjs'));
    assert.ok(env.exists('.autoreview/runtime/lib/config-loader.mjs'));
    assert.ok(env.exists('.autoreview/runtime/lib/scope-resolver.mjs'));
  } finally { await env.cleanup(); }
});

test('I-precommit-skip + existing hook + --precommit-skip keeps it untouched', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    await env.write('.git/hooks/pre-commit', '#!/bin/sh\necho mine\n');
    await chmod(join(env.dir, '.git/hooks/pre-commit'), 0o755);
    const r = await env.run('init',
      ['--provider', 'openai-compat', '--install-precommit', '--precommit-skip']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /kept existing/);
    const body = await env.read('.git/hooks/pre-commit');
    assert.match(body, /echo mine/);
  } finally { await env.cleanup(); }
});

test('I-precommit-append + existing hook + --precommit-append concats both', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    await env.write('.git/hooks/pre-commit', '#!/bin/sh\necho mine\n');
    await chmod(join(env.dir, '.git/hooks/pre-commit'), 0o755);
    const r = await env.run('init',
      ['--provider', 'openai-compat', '--install-precommit', '--precommit-append']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /appended/);
    const body = await env.read('.git/hooks/pre-commit');
    assert.match(body, /echo mine/);
    assert.match(body, /validate\.mjs/);
  } finally { await env.cleanup(); }
});

test('I10 + existing different pre-commit hook -> exit 1 unless overwrite flag', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('init');
  try {
    // Pre-seed a different hook
    await env.write('.git/hooks/pre-commit', '#!/bin/sh\necho "existing hook"\nexit 0\n');
    await chmod(join(env.dir, '.git/hooks/pre-commit'), 0o755);

    const r1 = await env.run('init', ['--provider', 'openai-compat', '--install-precommit']);
    assert.equal(r1.code, 1);
    assert.match(r1.stderr, /pre-commit exists.*--precommit-/);

    const r2 = await env.run('init', ['--provider', 'openai-compat', '--install-precommit', '--upgrade', '--precommit-overwrite']);
    assert.equal(r2.code, 0);
    const hook = await env.read('.git/hooks/pre-commit');
    assert.doesNotMatch(hook, /existing hook/);
  } finally { await env.cleanup(); }
});
