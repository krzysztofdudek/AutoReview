#!/usr/bin/env node
// scripts/bin/history.mjs
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { matchPath } from '../lib/trigger-engine.mjs';

export async function run(argv, { cwd, env, stdout, stderr }) {
  try {
    return await _run(argv, { cwd, env, stdout, stderr });
  } catch (err) {
    stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const { values } = parseArgs(argv);
  const format = values.format ?? 'table';

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const historyDir = join(root, '.autoreview/.history');

  let files;
  try { files = (await readdir(historyDir)).filter(f => f.endsWith('.jsonl')).sort(); }
  catch { stderr.write('[warn] no history directory\n'); return 0; }

  const since = values.since;
  const until = values.until;
  if (since) files = files.filter(f => f.slice(0, 10) >= since);
  if (until) files = files.filter(f => f.slice(0, 10) <= until);

  const records = [];
  for (const f of files) {
    const raw = await readFile(join(historyDir, f), 'utf8').catch(() => '');
    for (const line of raw.split('\n').filter(Boolean)) {
      try { records.push(JSON.parse(line)); } catch {}
    }
  }

  // Filter
  let filtered = records.filter(r => r.type === 'verdict');
  if (values.rule) filtered = filtered.filter(r => r.rule === values.rule);
  if (values.verdict) filtered = filtered.filter(r => r.verdict === values.verdict);
  if (values.file) filtered = filtered.filter(r => matchPath(values.file, r.file));

  if (format === 'jsonl') {
    for (const r of filtered) stdout.write(JSON.stringify(r) + '\n');
    return 0;
  }

  // Aggregate
  const byVerdict = {};
  const byRule = {};
  for (const r of filtered) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
  }

  if (format === 'json') {
    stdout.write(JSON.stringify({ total: filtered.length, by_verdict: byVerdict, by_rule: byRule, records: filtered.slice(-10) }, null, 2) + '\n');
    return 0;
  }

  // table format
  stdout.write(`Total records: ${filtered.length}\n\n`);
  stdout.write(`By verdict:\n`);
  for (const [v, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) {
    stdout.write(`  ${v}: ${n}\n`);
  }
  stdout.write(`\nBy rule:\n`);
  for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    stdout.write(`  ${r}: ${n}\n`);
  }
  stdout.write(`\nRecent 10 records:\n`);
  for (const r of filtered.slice(-10)) {
    stdout.write(`  [${r.verdict}] ${r.ts} ${r.file} :: ${r.rule}\n`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
