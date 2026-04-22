// tests/e2e/cli-create-rule.test.mjs — create-rule {save, breadth, test-drive, intent-test}.
// test-drive and intent-test exercise the LLM; covered separately once server is confirmed up.
// Focus here: `save` and `breadth` subcommands (no LLM) + CLI surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('C1 + save writes rule with frontmatter + body (relative --body-file resolves against cwd)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    await env.write('body.md', 'Rule body text.');
    // Pass --body-file as a RELATIVE path; the CLI must resolve it against ctx.cwd, not process.cwd.
    const r = await env.run('create-rule', [
      'save',
      '--name', 'Test Rule',
      '--triggers', 'dir:"src"',
      '--body-file', 'body.md',
      '--to', 'mine.md',
    ]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Saved:/);
    const body = await env.read('.autoreview/rules/mine.md');
    assert.match(body, /name: "Test Rule"/);
    assert.match(body, /triggers: 'dir:"src"'/);
    assert.match(body, /Rule body text\./);
  } finally { await env.cleanup(); }
});

test('C2 + save creates nested directories under rules/', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const bodyPath = await env.write('body.md', 'b');
    const r = await env.run('create-rule', [
      'save',
      '--name', 'Nested',
      '--triggers', 'dir:"src"',
      '--body-file', bodyPath,
      '--to', 'a/b/c/nested.md',
    ]);
    assert.equal(r.code, 0);
    assert.ok(env.exists('.autoreview/rules/a/b/c/nested.md'));
  } finally { await env.cleanup(); }
});

test('C3 + save idempotent overwrite (same --to)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const b1 = await env.write('body1.md', 'first');
    const b2 = await env.write('body2.md', 'second');
    const args = (bodyFile) => [
      'save', '--name', 'R', '--triggers', 'dir:"x"', '--body-file', bodyFile, '--to', 'r.md',
    ];
    const r1 = await env.run('create-rule', args(b1));
    assert.equal(r1.code, 0);
    const r2 = await env.run('create-rule', args(b2));
    assert.equal(r2.code, 0);
    const body = await env.read('.autoreview/rules/r.md');
    assert.match(body, /second/);
    assert.doesNotMatch(body, /first/);
  } finally { await env.cleanup(); }
});

test('C4 - save missing --body-file -> exit 1 usage error', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', [
      'save', '--name', 'R', '--triggers', 'dir:"x"', '--to', 'r.md',
    ]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /save requires --name --triggers --body-file --to/);
  } finally { await env.cleanup(); }
});

test('C5 - save with --body-file missing on disk -> exit 2 internal', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', [
      'save', '--name', 'R', '--triggers', 'dir:"x"', '--body-file', 'nope.md', '--to', 'r.md',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\[error\] internal/);
  } finally { await env.cleanup(); }
});

test('C6 + breadth subcommand reports matches as JSON', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    await env.write('src/a.ts', 'x');
    await env.write('src/b.ts', 'x');
    await env.write('other.md', 'x');
    const r = await env.run('create-rule', ['breadth', '--expr', 'dir:"src"']);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.matches, 2);
    assert.ok(parsed.sample.includes('src/a.ts'));
    assert.ok(parsed.sample.includes('src/b.ts'));
  } finally { await env.cleanup(); }
});

test('C7 - breadth requires --expr -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', ['breadth']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /breadth requires --expr/);
  } finally { await env.cleanup(); }
});

test('C8 - no subcommand -> exit 1 usage', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /usage: create-rule/);
  } finally { await env.cleanup(); }
});

test('C-trav - save --to ../escape.md rejected (path-traversal guard)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    await env.write('body.md', 'x');
    const r = await env.run('create-rule', [
      'save',
      '--name', 'Evil', '--triggers', 'dir:"x"',
      '--body-file', 'body.md',
      '--to', '../escape.md',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\.\.|relativePath/i);
    // File must NOT have landed anywhere
    assert.ok(!env.exists('escape.md'));
    assert.ok(!env.exists('.autoreview/escape.md'));
    assert.ok(!env.exists('.autoreview/rules/../escape.md'));
  } finally { await env.cleanup(); }
});

test('C-trav2 - save --to absolute path rejected', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    await env.write('body.md', 'x');
    const r = await env.run('create-rule', [
      'save',
      '--name', 'Evil', '--triggers', 'dir:"x"',
      '--body-file', 'body.md',
      '--to', '/tmp/escape-' + Date.now() + '.md',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /absolute|relativePath/i);
  } finally { await env.cleanup(); }
});

test('C-test-drive + test-drive runs ephemeral rule against sample files', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    // Unreachable provider → verdict must be "error" (deterministic, no LLM).
    await env.writeConfig({
      provider: { active: 'openai-compat', 'openai-compat': { endpoint: 'http://127.0.0.1:1', model: 'x' } },
    });
    await env.write('body.md', 'Rule body');
    await env.write('a.ts', 'x');
    await env.write('b.ts', 'y');
    const r = await env.run('create-rule', [
      'test-drive',
      '--rule-body', 'body.md',
      '--triggers', 'path:"**/*.ts"',
      '--files', `${env.dir}/a.ts`,
      '--files', `${env.dir}/b.ts`,
    ]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.length, 2);
    // Structural: each entry has a verdicts array with at least one verdict.
    for (const entry of parsed) {
      assert.ok(Array.isArray(entry.verdicts));
      assert.ok(entry.verdicts.length >= 1);
      assert.ok(['pass', 'fail', 'error', 'suppressed'].includes(entry.verdicts[0].verdict));
    }
  } finally { await env.cleanup(); }
});

test('C-test-drive-missing - requires --rule-body --triggers --files', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', ['test-drive', '--rule-body', 'x.md']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /test-drive requires/);
  } finally { await env.cleanup(); }
});

test('C-test-drive-unreadable - unreadable files logged with "unreadable" error', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    await env.write('body.md', 'body');
    const r = await env.run('create-rule', [
      'test-drive',
      '--rule-body', 'body.md',
      '--triggers', 'path:"**/*.ts"',
      '--files', '/does/not/exist-' + Date.now() + '.ts',
    ], { stub: 'pass' });
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed[0].error, 'unreadable');
  } finally { await env.cleanup(); }
});

test('C-intent-test-missing - intent-test requires --intent + --files', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', ['intent-test', '--intent', 'does it?']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /intent-test requires/);
  } finally { await env.cleanup(); }
});

test('C-intent-test-unreadable - unreadable sample files flagged "unreadable"', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    // Point provider at dead port so no real call succeeds — we only exercise the unreadable branch.
    await env.writeConfig({
      provider: { active: 'openai-compat', 'openai-compat': { endpoint: 'http://127.0.0.1:1', model: 'x' } },
    });
    const r = await env.run('create-rule', [
      'intent-test',
      '--intent', 'does anything',
      '--files', '/does/not/exist-' + Date.now() + '.ts',
    ]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed[0].match, false);
    assert.equal(parsed[0].error, 'unreadable');
  } finally { await env.cleanup(); }
});

test('C9 - unknown subcommand -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cr');
  try {
    await env.writeConfig();
    const r = await env.run('create-rule', ['bogus']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown subcommand: bogus/);
  } finally { await env.cleanup(); }
});
