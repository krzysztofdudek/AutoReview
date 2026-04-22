// tests/e2e/cli-check-breadth.test.mjs — B1..B8: deterministic trigger-expression evaluator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('B1 + --expr dir:"src" reports correct count and samples', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    await env.write('src/a.ts', 'x');
    await env.write('src/sub/b.ts', 'y');
    await env.write('other/c.ts', 'z');
    const r = await env.run('check-breadth', ['--expr', 'dir:"src"']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /2 matches/);
    assert.match(r.stdout, /src\/a\.ts/);
    assert.match(r.stdout, /src\/sub\/b\.ts/);
    assert.doesNotMatch(r.stdout, /other\/c\.ts/);
  } finally { await env.cleanup(); }
});

test('B2 + AND / NOT / content combinator', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    await env.write('README.md', '# readme\n');
    await env.write('TODO.md', '- TODO: something');
    await env.write('notes.md', 'no todos here');
    const r = await env.run('check-breadth', ['--expr', 'path:"**/*.md" AND NOT content:"TODO"']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /2 matches/);
    assert.doesNotMatch(r.stdout, /TODO\.md/);
  } finally { await env.cleanup(); }
});

test('B3 + zero matches reports 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    const r = await env.run('check-breadth', ['--expr', 'path:"**/*.rs"']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^0 matches/);
  } finally { await env.cleanup(); }
});

test('B4 + walk_file_cap triggers warning', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig({ review: { walk_file_cap: 3, evaluate: 'full', mode: 'quick', consensus: 1, context_window_bytes: 'auto', output_reserve_bytes: 2000 } });
    for (let i = 0; i < 10; i++) await env.write(`src/f${i}.ts`, 'x');
    const r = await env.run('check-breadth', ['--expr', 'path:"**/*.ts"']);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[warn\] reached walk cap/);
  } finally { await env.cleanup(); }
});

test('B5 - unescaped paren content:"(" -> non-zero exit, regex error', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    await env.write('a.ts', 'something');
    const r = await env.run('check-breadth', ['--expr', 'content:"("']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /\[error\]/);
  } finally { await env.cleanup(); }
});

test('B6 - REDOS pattern (a+)+b -> non-zero exit, REDOS guard message', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    await env.write('a.ts', 'sample');
    const r = await env.run('check-breadth', ['--expr', 'content:"(a+)+b"']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /nested quantifier|pathological/i);
  } finally { await env.cleanup(); }
});

test('B7 - missing --expr and --rule -> exit 1 usage error', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    const r = await env.run('check-breadth', []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--expr or --rule required/);
  } finally { await env.cleanup(); }
});

test('B8 + --rule <id> resolves rule.triggers from disk', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    await env.writeRule('mine.md', { name: 'Mine', triggers: 'dir:"src"' }, 'body');
    await env.write('src/a.ts', 'x');
    await env.write('other.ts', 'y');
    const r = await env.run('check-breadth', ['--rule', 'mine']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /1 matches/);
    assert.match(r.stdout, /src\/a\.ts/);
  } finally { await env.cleanup(); }
});

test('B8n - --rule <unknown> -> exit 1', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('cb');
  try {
    await env.writeConfig();
    const r = await env.run('check-breadth', ['--rule', 'does-not-exist']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /rule not found/);
  } finally { await env.cleanup(); }
});
