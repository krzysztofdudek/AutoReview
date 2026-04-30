import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendVerdict, appendFileSummary, createHistorySession, MAX_RECORD_BYTES } from '../../scripts/lib/history.mjs';

test('appendVerdict writes JSONL line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    await appendVerdict(dir, { file: 'a.ts', rule: 'r1', mode: 'quick', provider: 'ollama', model: 'x', verdict: 'pass', duration_ms: 100 });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.equal(rec.type, 'verdict');
    assert.equal(rec.file, 'a.ts');
    assert.ok(rec.ts);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('long reason truncated with sidecar written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    const longReason = 'x'.repeat(10000);
    await appendVerdict(dir, { file: 'a.ts', rule: 'r1', mode: 'thinking', provider: 'anthropic', model: 'h', verdict: 'fail', reason: longReason });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.ok(rec.reason.length < 1000);
    assert.ok(rec.reason_sidecar);
    assert.ok(rec.reason.endsWith('[… see reason_sidecar]') || rec.reason.endsWith('[... see reason_sidecar]'));
    const sidecar = await readFile(join(dir, rec.reason_sidecar), 'utf8');
    assert.equal(sidecar, longReason);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('record always ≤ MAX_RECORD_BYTES', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    const longFile = 'x'.repeat(5000);
    await appendVerdict(dir, { file: longFile, rule: 'r1', mode: 'quick', provider: 'p', model: 'm', verdict: 'pass' });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const line = body.trim();
    assert.ok(Buffer.byteLength(line) <= MAX_RECORD_BYTES);
    const rec = JSON.parse(line);
    assert.ok(rec.file.startsWith('…/') || rec.file.length < longFile.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('appendFileSummary writes type:file-summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    await appendFileSummary(dir, { file: 'a.ts', matched_rules: ['r1'], verdicts: { r1: 'pass' }, duration_ms: 42 });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.equal(rec.type, 'file-summary');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fitRecord: truncates reason when even after sidecar the line is too big', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    // Reason >2000 triggers sidecar; truncated to 500 chars + marker → still <3500, so ok.
    // To hit the final `reason = '[... reason truncated]'` branch, combine with a huge file path.
    const longFile = 'a/'.repeat(2000) + 'end.ts';
    const longReason = 'r'.repeat(10000);
    await appendVerdict(dir, { file: longFile, rule: 'r1', mode: 'thinking', provider: 'p', model: 'm', verdict: 'fail', reason: longReason });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const line = body.trim();
    assert.ok(Buffer.byteLength(line) <= MAX_RECORD_BYTES);
    const rec = JSON.parse(line);
    assert.ok(rec.reason_sidecar, 'sidecar must still be written even when reason gets truncated');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHistorySession split across two days', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    const s = createHistorySession(dir);
    await s.append({ type: 'verdict', file: 'a.ts', rule: 'r1', verdict: 'pass', ts: '2026-04-20T23:00:00Z' });
    await s.append({ type: 'verdict', file: 'b.ts', rule: 'r1', verdict: 'pass', ts: '2026-04-21T00:01:00Z' });
    await s.close();
    const body20 = await readFile(join(dir, '.autoreview/.history/2026-04-20.jsonl'), 'utf8');
    const body21 = await readFile(join(dir, '.autoreview/.history/2026-04-21.jsonl'), 'utf8');
    assert.equal(JSON.parse(body20.trim()).file, 'a.ts');
    assert.equal(JSON.parse(body21.trim()).file, 'b.ts');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHistorySession throws on append after close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    const s = createHistorySession(dir);
    await s.append({ type: 'verdict', file: 'a.ts', rule: 'r1', verdict: 'pass' });
    await s.close();
    await assert.rejects(s.append({ type: 'verdict', file: 'b.ts', rule: 'r1', verdict: 'pass' }), /closed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('appendVerdict auto-populates ts when missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    await appendVerdict(dir, { file: 'a.ts', rule: 'r', verdict: 'pass' });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('oversize record without file field does not crash', async () => {
  // Records with providerError carry `raw` but may legitimately lack `file` at the
  // call site (e.g. rule-level errors unattached to a specific path). If JSON line
  // exceeds MAX_RECORD_BYTES, truncateFileField was called with rec.file=undefined,
  // and `Buffer.from(undefined)` threw TypeError, killing the append.
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-nofile-'));
  try {
    const longRaw = 'x'.repeat(5000);
    await appendVerdict(dir, { rule: 'r1', mode: 'quick', provider: 'p', model: 'm', verdict: 'error', raw: longRaw });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/.history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.equal(rec.rule, 'r1');
    assert.equal(rec.verdict, 'error');
    assert.ok(Buffer.byteLength(body.trim()) <= MAX_RECORD_BYTES);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHistorySession keeps one stream open per day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-sess-'));
  try {
    const s = createHistorySession(dir);
    await s.append({ type: 'verdict', file: 'a.ts', rule: 'r1', verdict: 'pass', ts: '2026-04-21T10:00:00Z' });
    await s.append({ type: 'verdict', file: 'b.ts', rule: 'r1', verdict: 'pass', ts: '2026-04-21T10:01:00Z' });
    await s.close();
    const body = await readFile(join(dir, '.autoreview/.history/2026-04-21.jsonl'), 'utf8');
    const lines = body.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).file, 'a.ts');
    assert.equal(JSON.parse(lines[1]).file, 'b.ts');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createHistorySession: 50 concurrent appends produce 50 well-formed JSONL lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-conc-'));
  try {
    const s = createHistorySession(dir);
    const records = Array.from({ length: 50 }, (_, i) => ({
      type: 'verdict',
      file: `f${i}.ts`,
      rule: `r${i % 5}`,
      verdict: i % 3 === 0 ? 'pass' : i % 3 === 1 ? 'fail' : 'error',
      reason: `reason for ${i} ${'x'.repeat(50)}`,
      ts: '2026-04-30T12:00:00Z',
      provider: 'stub', model: 'm', mode: 'quick', duration_ms: i,
    }));
    await Promise.all(records.map(r => s.append(r)));
    await s.close();
    const body = await readFile(join(dir, '.autoreview/.history/2026-04-30.jsonl'), 'utf8');
    const lines = body.trim().split('\n');
    assert.equal(lines.length, 50);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.file);
      assert.ok(parsed.rule);
      assert.ok(parsed.verdict);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
