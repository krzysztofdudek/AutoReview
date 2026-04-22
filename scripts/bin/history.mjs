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
  if (values.sha) filtered = filtered.filter(r => r.commit_sha && r.commit_sha.startsWith(values.sha));
  if (values.actor) filtered = filtered.filter(r => r.actor === values.actor);

  if (format === 'jsonl') {
    for (const r of filtered) stdout.write(JSON.stringify(r) + '\n');
    return 0;
  }

  // Aggregate
  const byVerdict = {};
  const byRule = {};
  const byProvider = {};
  let totalInput = 0, totalOutput = 0, hasUsage = false;
  for (const r of filtered) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
    if (r.provider) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
    if (r.usage) {
      hasUsage = true;
      totalInput += r.usage.input_tokens ?? 0;
      totalOutput += r.usage.output_tokens ?? 0;
    }
  }
  const usageTotals = hasUsage ? {
    input_tokens: totalInput,
    output_tokens: totalOutput,
    total_tokens: totalInput + totalOutput,
  } : null;

  if (format === 'json') {
    stdout.write(JSON.stringify({ total: filtered.length, by_verdict: byVerdict, by_rule: byRule, by_provider: byProvider, usage: usageTotals, records: filtered.slice(-10) }, null, 2) + '\n');
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
  if (Object.keys(byProvider).length > 0) {
    stdout.write(`\nBy provider:\n`);
    for (const [p, n] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
      stdout.write(`  ${p}: ${n}\n`);
    }
  }
  if (usageTotals) {
    stdout.write(`\nToken usage (where recorded):\n`);
    stdout.write(`  input:  ${usageTotals.input_tokens}\n`);
    stdout.write(`  output: ${usageTotals.output_tokens}\n`);
    stdout.write(`  total:  ${usageTotals.total_tokens}\n`);
  }
  stdout.write(`\nRecent 10 records:\n`);
  for (const r of filtered.slice(-10)) {
    const sha = r.commit_sha ? ` ${r.commit_sha.slice(0, 7)}` : '';
    const actor = r.actor ? ` <${r.actor}>` : '';
    stdout.write(`  [${r.verdict}]${sha} ${r.ts}${actor} ${r.file} :: ${r.rule}\n`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
