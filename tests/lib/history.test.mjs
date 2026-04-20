import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendVerdict, appendFileSummary, MAX_RECORD_BYTES } from '../../scripts/lib/history.mjs';

test('appendVerdict writes JSONL line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-hist-'));
  try {
    await appendVerdict(dir, { file: 'a.ts', rule: 'r1', mode: 'quick', provider: 'ollama', model: 'x', verdict: 'pass', duration_ms: 100 });
    const day = new Date().toISOString().slice(0, 10);
    const body = await readFile(join(dir, '.autoreview/history', `${day}.jsonl`), 'utf8');
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
    const body = await readFile(join(dir, '.autoreview/history', `${day}.jsonl`), 'utf8');
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
    const body = await readFile(join(dir, '.autoreview/history', `${day}.jsonl`), 'utf8');
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
    const body = await readFile(join(dir, '.autoreview/history', `${day}.jsonl`), 'utf8');
    const rec = JSON.parse(body.trim());
    assert.equal(rec.type, 'file-summary');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
