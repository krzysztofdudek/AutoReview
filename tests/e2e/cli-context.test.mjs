// tests/e2e/cli-context.test.mjs — X1..X6: pre-write rule listing (no LLM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

test('X1 + lists matched rule ids for a path', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('api.md', { name: 'Api', triggers: 'dir:"src/api"' }, 'b');
    await env.writeRule('docs.md', { name: 'Docs', triggers: 'dir:"docs"' }, 'b');
    await env.write('src/api/users.ts', 'x');
    const r = await env.run('context', ['src/api/users.ts']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Rules matching src\/api\/users\.ts:/);
    assert.match(r.stdout, /- api:/);
    assert.doesNotMatch(r.stdout, /- docs:/);
  } finally { await env.cleanup(); }
});

test('X2 + no matching rules -> exit 0, explanatory message', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('a.md', { name: 'A', triggers: 'dir:"docs"' }, 'b');
    await env.write('src/x.ts', 'x');
    const r = await env.run('context', ['src/x.ts']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No rules match/);
  } finally { await env.cleanup(); }
});

test('X3 + no argument -> lists all rule ids', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('r1.md', { name: 'R1', triggers: 'dir:"a"' }, 'b');
    await env.writeRule('r2.md', { name: 'R2', triggers: 'dir:"b"' }, 'b');
    const r = await env.run('context', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /All rules/);
    assert.match(r.stdout, /- r1/);
    assert.match(r.stdout, /- r2/);
  } finally { await env.cleanup(); }
});

test('X4 + path with no file on disk still evaluates path-predicates (pre-write)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('api.md', { name: 'Api', triggers: 'dir:"src/api"' }, 'b');
    const r = await env.run('context', ['src/api/does-not-exist-yet.ts']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /- api:/);
  } finally { await env.cleanup(); }
});

test('X5 + binary file with content: trigger -> does not match (suppressed)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('need.md', { name: 'Need', triggers: 'path:"**/*.bin" AND content:"MAGIC"' }, 'b');
    // Write a binary blob containing literal "MAGIC" + lots of NULs
    const buf = Buffer.concat([Buffer.from('MAGIC\0'), Buffer.alloc(256, 0)]);
    await env.write('blob.bin', buf);
    const r = await env.run('context', ['blob.bin']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No rules match/);
  } finally { await env.cleanup(); }
});

test('X6 - malformed rule trigger -> [warn] rule skipped, exit 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('ctx');
  try {
    await env.writeConfig();
    await env.writeRule('good.md', { name: 'Good', triggers: 'dir:"src"' }, 'b');
    await env.writeRule('bad.md',  { name: 'Bad',  triggers: 'bogus(' }, 'b');
    await env.write('src/x.ts', 'x');
    const r = await env.run('context', ['src/x.ts']);
    assert.equal(r.code, 0);
    // bad rule either warned during loadRules or during trigger parse
    assert.match(r.stderr, /\[warn\]/);
    assert.match(r.stdout, /- good:/);
  } finally { await env.cleanup(); }
});
