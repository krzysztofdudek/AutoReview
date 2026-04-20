// scripts/lib/history.mjs
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const MAX_RECORD_BYTES = 3500;
const SIDECAR_TRUNC = '[… see reason_sidecar]';

function tsNow() { return new Date().toISOString(); }

async function writeSidecar(repoRoot, day, content) {
  const sha = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const rel = `.autoreview/history/${day}/${sha}.txt`;
  const abs = join(repoRoot, rel);
  await mkdir(join(repoRoot, `.autoreview/history/${day}`), { recursive: true });
  await writeFile(abs, content);
  return rel;
}

function truncateFileField(rec) {
  const ellipsis = '…/';
  const line = JSON.stringify(rec);
  const overflow = Buffer.byteLength(line) - MAX_RECORD_BYTES;
  if (overflow <= 0) return rec;
  const maxFileLen = Math.max(0, Buffer.byteLength(rec.file) - overflow - Buffer.byteLength(ellipsis));
  rec.file = ellipsis + rec.file.slice(rec.file.length - maxFileLen);
  return rec;
}

async function fitRecord(repoRoot, rec) {
  rec.ts ??= tsNow();
  rec.type ??= 'verdict';
  const day = rec.ts.slice(0, 10);
  if (rec.reason && Buffer.byteLength(rec.reason) > 2000) {
    const sidecar = await writeSidecar(repoRoot, day, rec.reason);
    rec.reason_sidecar = sidecar;
    rec.reason = rec.reason.slice(0, 500) + ` ${SIDECAR_TRUNC}`;
  }
  let line = JSON.stringify(rec);
  if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
    rec = truncateFileField(rec);
    line = JSON.stringify(rec);
  }
  if (Buffer.byteLength(line) > MAX_RECORD_BYTES && rec.reason) {
    rec.reason = '[... reason truncated]';
    line = JSON.stringify(rec);
  }
  return { rec, line, day };
}

async function append(repoRoot, rec) {
  const { line, day } = await fitRecord(repoRoot, rec);
  const path = join(repoRoot, '.autoreview/history', `${day}.jsonl`);
  await mkdir(join(repoRoot, '.autoreview/history'), { recursive: true });
  await appendFile(path, line + '\n', { flag: 'a' });
}

export async function appendVerdict(repoRoot, record) {
  await append(repoRoot, { type: 'verdict', ...record });
}

export async function appendFileSummary(repoRoot, record) {
  await append(repoRoot, { type: 'file-summary', ...record });
}
