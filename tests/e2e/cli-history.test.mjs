// tests/e2e/cli-history.test.mjs — H1..H9: query the review audit log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, skipUnlessE2E } from './helpers/harness.mjs';

async function seedHistory(env, dateStr, records) {
  const file = `.autoreview/.history/${dateStr}.jsonl`;
  const body = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await env.write(file, body);
}

test('H1 + table format: totals, by-verdict, by-rule, recent', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: '2026-04-20T10:00', type: 'verdict', file: 'a.ts', rule: 'api/x', verdict: 'pass' },
      { ts: '2026-04-20T10:01', type: 'verdict', file: 'b.ts', rule: 'api/x', verdict: 'fail', reason: 'r' },
      { ts: '2026-04-20T10:02', type: 'verdict', file: 'c.ts', rule: 'util/y', verdict: 'pass' },
    ]);
    const r = await env.run('history', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 3/);
    assert.match(r.stdout, /pass: 2/);
    assert.match(r.stdout, /fail: 1/);
    assert.match(r.stdout, /api\/x: 2/);
  } finally { await env.cleanup(); }
});

test('H2 + --format json returns aggregate object with records', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: 't1', type: 'verdict', file: 'a.ts', rule: 'r1', verdict: 'pass' },
    ]);
    const r = await env.run('history', ['--format', 'json']);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.by_verdict.pass, 1);
    assert.equal(parsed.records.length, 1);
  } finally { await env.cleanup(); }
});

test('H3 + --rule <id> filter restricts to one rule', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: 't', type: 'verdict', file: 'a.ts', rule: 'api/x', verdict: 'pass' },
      { ts: 't', type: 'verdict', file: 'b.ts', rule: 'util/y', verdict: 'pass' },
    ]);
    const r = await env.run('history', ['--rule', 'api/x']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 1/);
    assert.match(r.stdout, /api\/x: 1/);
    assert.doesNotMatch(r.stdout, /util\/y/);
  } finally { await env.cleanup(); }
});

test('H4 + --file <glob> path filter', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: 't', type: 'verdict', file: 'src/api/a.ts', rule: 'r', verdict: 'pass' },
      { ts: 't', type: 'verdict', file: 'src/util/b.ts', rule: 'r', verdict: 'pass' },
    ]);
    const r = await env.run('history', ['--file', 'src/api/**']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 1/);
  } finally { await env.cleanup(); }
});

test('H5 + --since filter by date-prefix', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-19', [
      { ts: 't', type: 'verdict', file: 'a.ts', rule: 'r', verdict: 'pass' },
    ]);
    await seedHistory(env, '2026-04-21', [
      { ts: 't', type: 'verdict', file: 'b.ts', rule: 'r', verdict: 'pass' },
    ]);
    const r = await env.run('history', ['--since', '2026-04-20']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 1/);
  } finally { await env.cleanup(); }
});

test('H6 + empty .history directory -> exit 0, total 0', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    const r = await env.run('history', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 0/);
  } finally { await env.cleanup(); }
});

test('H7 + --verdict <v> filter works', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: 't', type: 'verdict', file: 'a.ts', rule: 'r', verdict: 'pass' },
      { ts: 't', type: 'verdict', file: 'b.ts', rule: 'r', verdict: 'fail', reason: 'x' },
      { ts: 't', type: 'verdict', file: 'c.ts', rule: 'r', verdict: 'fail', reason: 'y' },
    ]);
    const r = await env.run('history', ['--verdict', 'fail']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 2/);
    assert.match(r.stdout, /fail: 2/);
  } finally { await env.cleanup(); }
});

test('H8 - malformed JSONL lines are skipped silently', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    const raw = [
      JSON.stringify({ ts: 't', type: 'verdict', file: 'a.ts', rule: 'r', verdict: 'pass' }),
      '{this is not json',
      JSON.stringify({ ts: 't', type: 'verdict', file: 'b.ts', rule: 'r', verdict: 'pass' }),
    ].join('\n') + '\n';
    await env.write('.autoreview/.history/2026-04-20.jsonl', raw);
    const r = await env.run('history', []);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 2/);
  } finally { await env.cleanup(); }
});

test('H-until + --until filter by date-prefix (inclusive upper bound)', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-19', [
      { ts: 't', type: 'verdict', file: 'a.ts', rule: 'r', verdict: 'pass' },
    ]);
    await seedHistory(env, '2026-04-21', [
      { ts: 't', type: 'verdict', file: 'b.ts', rule: 'r', verdict: 'pass' },
    ]);
    const r = await env.run('history', ['--until', '2026-04-20']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Total records: 1/);
  } finally { await env.cleanup(); }
});

test('H-jsonl + --format jsonl streams raw records', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    await env.writeConfig();
    await seedHistory(env, '2026-04-20', [
      { ts: 't1', type: 'verdict', file: 'a.ts', rule: 'r1', verdict: 'pass' },
      { ts: 't2', type: 'verdict', file: 'b.ts', rule: 'r1', verdict: 'fail', reason: 'x' },
    ]);
    const r = await env.run('history', ['--format', 'jsonl']);
    assert.equal(r.code, 0);
    const lines = r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].verdict, 'pass');
    assert.equal(lines[1].verdict, 'fail');
  } finally { await env.cleanup(); }
});

test('H9 - no .autoreview at all -> exit 0, [warn] no history directory', async (t) => {
  skipUnlessE2E(t);
  const env = await createEnv('hist');
  try {
    // No writeConfig(), no .autoreview
    const r = await env.run('history', []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /no history directory/);
  } finally { await env.cleanup(); }
});
