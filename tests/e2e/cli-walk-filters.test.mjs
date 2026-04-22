// tests/e2e/cli-walk-filters.test.mjs — walk skipDirs + .gitignore precedence in scope=all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

const baseCfg = {
  review: {
    evaluate: 'full', mode: 'quick', consensus: 1,
    context_window_bytes: 'auto', output_reserve_bytes: 2000, walk_file_cap: 10000,
  },
};

test('W1 + walk skips node_modules / .git / dist / build / .autoreview by default', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('walk');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('src/ok.ts', 'x');
    await env.write('node_modules/skip.ts', 'x');
    await env.write('dist/skip.ts', 'x');
    await env.write('build/skip.ts', 'x');
    const r = await env.run('validate', ['--scope', 'all'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /src\/ok\.ts/);
    assert.doesNotMatch(r.stderr, /node_modules/);
    assert.doesNotMatch(r.stderr, /dist\/skip/);
    assert.doesNotMatch(r.stderr, /build\/skip/);
  } finally { await env.cleanup(); }
});

test('W2 + .gitignore patterns honored by walk', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('walk');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('.gitignore', 'ignored-file.ts\nignored-dir/\n');
    await env.write('visible.ts', 'x');
    await env.write('ignored-file.ts', 'x');
    await env.write('ignored-dir/nested.ts', 'x');
    const r = await env.run('validate', ['--scope', 'all'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /visible\.ts/);
    assert.doesNotMatch(r.stderr, /ignored-file\.ts/);
    assert.doesNotMatch(r.stderr, /ignored-dir\/nested/);
  } finally { await env.cleanup(); }
});

test('W3 + hidden files excluded unless includeHidden (walk default)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('walk');
  try {
    await env.writeConfig(baseCfg);
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    await env.write('.hidden/secret.ts', 'x');
    await env.write('visible.ts', 'x');
    const r = await env.run('validate', ['--scope', 'all'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /visible\.ts/);
    assert.doesNotMatch(r.stderr, /\.hidden\/secret/);
  } finally { await env.cleanup(); }
});

test('W4 + walk_file_cap honored with onCapReached warn', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('walk');
  try {
    await env.writeConfig({
      review: { ...baseCfg.review, walk_file_cap: 2 },
    });
    await env.writeRule('r.md', { name: 'R', triggers: 'path:"**/*.ts"' }, 'body');
    for (let i = 0; i < 10; i++) await env.write(`f${i}.ts`, 'x');
    const r = await env.run('validate', ['--scope', 'all'], { stub: 'pass' });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /reached walk cap/);
  } finally { await env.cleanup(); }
});
