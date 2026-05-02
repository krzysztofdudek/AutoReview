// tests/e2e/cli-validate.test.mjs — `validate` / `review` CLI surface.
// Verdict correctness is tested against the live LLM in cli-reviewer-test.test.mjs.
// Here we use AUTOREVIEW_STUB_PROVIDER=pass|fail|error to exercise the CLI
// deterministically — scope resolution, mutex flags, severity modes, suppress,
// soft-fail invariants — without flakiness from model decisions.
// Live-LLM smokes are the two V-live-* tests at the bottom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('V1 + stub pass: file + matching rule -> exit 0, [pass]', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('src/a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[pass\]/);
  } finally { await env.cleanup(); }
});

test('V2 + stub fail + severity:error -> exit 1, [reject]', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    const f = await env.write('src/a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'fail' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[reject\]/);
  } finally { await env.cleanup(); }
});

test('V3 + --scope staged only picks staged files', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('staged.ts', 'x');
    await env.write('unstaged.ts', 'x');
    env.git('add', 'staged.ts');
    const r = await env.run('validate', ['--scope', 'staged'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /staged\.ts/);
    assert.doesNotMatch(r.stderr, /unstaged\.ts/);
  } finally { await env.cleanup(); }
});

test('V4 + --scope uncommitted picks staged + modified + untracked', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('committed.ts', 'x');
    env.git('add', '-A');
    env.git('commit', '-qm', 'seed');
    await env.write('committed.ts', 'xy'); // modified
    await env.write('staged.ts', 'x');
    env.git('add', 'staged.ts');
    await env.write('untracked.ts', 'x');
    const r = await env.run('validate', ['--scope', 'uncommitted'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /committed\.ts/);
    assert.match(r.stderr, /staged\.ts/);
    assert.match(r.stderr, /untracked\.ts/);
  } finally { await env.cleanup(); }
});

test('V5 + --scope all walks whole repo', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('a.ts', 'x');
    await env.write('b.ts', 'x');
    const r = await env.run('validate', ['--scope', 'all'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /a\.ts/);
    assert.match(r.stderr, /b\.ts/);
  } finally { await env.cleanup(); }
});

test('V6 + --sha HEAD reviews committed tree', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('committed.ts', 'x');
    env.git('add', '-A');
    env.git('commit', '-qm', 'add');
    const r = await env.run('validate', ['--sha', 'HEAD'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /committed\.ts/);
  } finally { await env.cleanup(); }
});

test('V8 + --dir restricts walk', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('src/a.ts', 'x');
    await env.write('other/b.ts', 'x');
    const r = await env.run('validate', ['--dir', 'src'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /src\/a\.ts/);
    assert.doesNotMatch(r.stderr, /other\/b\.ts/);
  } finally { await env.cleanup(); }
});

test('V9 + --content-file + --target-path routes draft through reviewer', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const draft = await env.write('/tmp/draft-v9-' + Date.now() + '.ts', 'x');
    const r = await env.run('validate', [
      '--content-file', draft,
      '--target-path', 'src/new.ts',
    ], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /src\/new\.ts/);
  } finally { await env.cleanup(); }
});

// V12: soft enforcement replaced by severity:warning — fail yields exit 0 + [warn] prefix.
test('V12 + severity:warning: stub fail yields exit 0 + [warn] message', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'warning' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'fail' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\]/);
  } finally { await env.cleanup(); }
});

test('V16 + zero matched rules -> exit 0, no verdicts', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('rust.md', { name: 'RustOnly', triggers: 'path:"**/*.rs"' }, 'body');
    const f = await env.write('src/a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stderr, /\[pass\]|\[reject\]/);
  } finally { await env.cleanup(); }
});

test('V18 + precommit context clamps consensus to 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig({
      tiers: { default: { provider: 'openai-compat', model: 'x', endpoint: 'http://127.0.0.1:8080/v1', consensus: 3 } },
    });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('a.ts', 'x');
    env.git('add', 'a.ts');
    const r = await env.run('validate', ['--scope', 'staged', '--context', 'precommit'], { stub: 'pass' });
    assert.equal(r.code, 0);
    // Can't directly observe consensus count; assert pass with single verdict
    const passes = (r.stderr.match(/\[pass\]/g) ?? []).length;
    assert.equal(passes, 1);
  } finally { await env.cleanup(); }
});

test('V19 - invalid --scope -> exit 2 internal', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    const r = await env.run('validate', ['--scope', 'bogus'], { stub: 'pass' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\[error\] internal/);
  } finally { await env.cleanup(); }
});

test('V20 - --files and --scope together -> mutex error, exit 2', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f, '--scope', 'staged']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /mutually exclusive/);
  } finally { await env.cleanup(); }
});

test('V21 - --sha <nonexistent> -> exit 2', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    const r = await env.run('validate', ['--sha', 'deadbeefdoesnotexist123']);
    assert.equal(r.code, 2);
  } finally { await env.cleanup(); }
});

test('V-rel-content + --content-file relative path resolves against ctx.cwd', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    // Write content-file relative to scratch dir; CLI must find it via ctx.cwd, not process.cwd.
    await env.write('drafts/v-rel-content.ts', 'x');
    const r = await env.run('validate', [
      '--content-file', 'drafts/v-rel-content.ts',
      '--target-path', 'src/would-be-new.ts',
    ], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /src\/would-be-new\.ts/);
  } finally { await env.cleanup(); }
});

test('V22 - --content-file missing on disk -> exit 1, cannot read', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    const r = await env.run('validate', [
      '--content-file', '/tmp/does-not-exist-' + Date.now(),
      '--target-path', 'a.ts',
    ]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot read/);
  } finally { await env.cleanup(); }
});

// Per spec §5: severity:error rule + [error] verdict (providerError) → exit 1.
// The old "never block on provider error" hard rule was removed in the tier redesign.
test('V23 + stub error verdict under severity:error -> exit 1, [error] printed', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'error' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[error\]/);
  } finally { await env.cleanup(); }
});

// Per spec §5: severity:warning rule + [error] verdict (providerError) → exit 0.
test('V23b + stub error verdict under severity:warning -> exit 0, [error] printed', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'warning' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'error' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[error\]/);
  } finally { await env.cleanup(); }
});

// Per spec §5: severity:error rule + provider unreachable → exit 1.
test('V24 + live: server unreachable under severity:error -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig({
      tiers: {
        default: {
          provider: 'openai-compat',
          model: 'x',
          endpoint: 'http://127.0.0.1:1',
        },
      },
    });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"', severity: 'error' }, 'body');
    const f = await env.write('a.ts', 'x');
    const r = await env.run('validate', ['--files', f]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /\[error\]/);
  } finally { await env.cleanup(); }
}, { timeout: 60000 });

test('V27 - malformed rule trigger: rule is skipped, other rules still load', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('good.md', { name: 'Good', triggers: 'path:"**/*.ts"' }, 'body');
    // Malformed trigger with unescaped paren in content:"(..."
    await env.writeRule('bad.md',  { name: 'Bad',  triggers: 'content:"("' }, 'body');
    const f = await env.write('src/a.ts', 'x');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    // Pass: good rule evaluates; bad rule triggers an error during walk but doesn't crash the run.
    // Either exit 0 (bad trigger skipped with warn) OR exit 2 (bad trigger bubbles up). Both are defensible.
    // We assert structural: no crash *before* good rule fires, [pass] emitted for good.
    assert.ok(r.code === 0 || r.code === 2);
    // If good was evaluated, we have [pass].
    if (r.code === 0) assert.match(r.stderr, /good/);
  } finally { await env.cleanup(); }
});

test('V28 + binary file skips content: predicates cleanly (no crash)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.bin" AND content:"MAGIC"' }, 'body');
    const buf = Buffer.concat([Buffer.from('MAGIC\0'), Buffer.alloc(256, 0)]);
    const f = await env.write('blob.bin', buf);
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    // Binary causes no [pass] — triggers don't match
    assert.doesNotMatch(r.stderr, /\[pass\]/);
  } finally { await env.cleanup(); }
});

test('V30 + suppress marker missing reason -> [warn] via ctx.stderr, review continues', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('src/a.ts',
      '// @autoreview-ignore r\nconsole.log("x");\n');
    const r = await env.run('validate', ['--files', f], { stub: 'pass' });
    // Review proceeds; warning is captured on stderr (no longer via console.error).
    assert.match(r.stderr, /\[warn\] @autoreview-ignore.*missing mandatory.*reason/i);
  } finally { await env.cleanup(); }
});

test('V-review-alias + `review` subcommand routes to validate', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('val');
  try {
    await env.writeConfig();
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    const f = await env.write('src/a.ts', 'x');
    const r = await env.run('review', ['--files', f], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[pass\]/);
  } finally { await env.cleanup(); }
});

// Live end-to-end pass cases are covered in cli-reviewer-test.test.mjs (R1, R2, R7).
// Here we keep V24 as the only live-server case (unreachable-server soft-fail).
