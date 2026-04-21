import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/history.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function mkRepoWithHistory(records) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  await mkdir(join(dir, '.autoreview/.history'), { recursive: true });
  for (const [day, lines] of Object.entries(records)) {
    await writeFile(join(dir, '.autoreview/.history', `${day}.jsonl`),
      lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('history no args prints summary', async () => {
  const { dir, cleanup } = await mkRepoWithHistory({
    '2026-04-20': [
      { type: 'verdict', ts: '2026-04-20T10:00:00Z', file: 'a.ts', rule: 'r1', verdict: 'pass', provider: 'o', model: 'm', mode: 'quick', duration_ms: 100 },
      { type: 'verdict', ts: '2026-04-20T10:01:00Z', file: 'b.ts', rule: 'r1', verdict: 'fail', provider: 'o', model: 'm', mode: 'quick', duration_ms: 200 },
      { type: 'verdict', ts: '2026-04-20T10:02:00Z', file: 'c.ts', rule: 'r2', verdict: 'pass', provider: 'o', model: 'm', mode: 'quick', duration_ms: 150 },
    ],
  });
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /Total records: 3/);
    assert.match(c.out(), /pass: 2/);
    assert.match(c.out(), /fail: 1/);
  } finally { await cleanup(); }
});

test('history --rule filters by rule id', async () => {
  const { dir, cleanup } = await mkRepoWithHistory({
    '2026-04-20': [
      { type: 'verdict', ts: '2026-04-20T10:00:00Z', file: 'a.ts', rule: 'r1', verdict: 'pass' },
      { type: 'verdict', ts: '2026-04-20T10:01:00Z', file: 'b.ts', rule: 'r2', verdict: 'pass' },
    ],
  });
  try {
    const c = capture();
    const code = await run(['--rule', 'r1'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /Total records: 1/);
  } finally { await cleanup(); }
});

test('history --format jsonl dumps filtered records', async () => {
  const { dir, cleanup } = await mkRepoWithHistory({
    '2026-04-20': [
      { type: 'verdict', ts: '2026-04-20T10:00:00Z', file: 'a.ts', rule: 'r1', verdict: 'fail' },
    ],
  });
  try {
    const c = capture();
    const code = await run(['--format', 'jsonl', '--verdict', 'fail'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    const rec = JSON.parse(c.out().trim());
    assert.equal(rec.verdict, 'fail');
  } finally { await cleanup(); }
});

test('history with no history dir warns cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-empty-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.err(), /no history/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
