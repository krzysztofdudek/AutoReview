#!/usr/bin/env node
// scripts/bin/create-rule.mjs
// Dispatcher for create-rule wizard primitives.

import { readFile } from 'node:fs/promises';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { parse as parseTrigger, evaluate as evalTrigger, shouldTreatAsNonMatchForContent } from '../lib/trigger-engine.mjs';
import { renderRule, saveRule } from '../lib/rule-authoring.mjs';
import { walk, isBinary, sizeOf } from '../lib/fs-utils.mjs';
import { reviewFile } from '../lib/reviewer.mjs';
import { relative, resolve as resolvePath, isAbsolute } from 'node:path';

function resolveCliPath(cwd, p) {
  return isAbsolute(p) ? p : resolvePath(cwd, p);
}

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const [sub, ...rest] = argv;
  if (!sub) {
    stderr.write('[error] usage: create-rule <breadth|intent-test|test-drive|save> [options]\n');
    return 1;
  }
  const { values } = parseArgs(rest, { multiple: ['files'] });

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);

  if (sub === 'breadth') {
    if (!values.expr) { stderr.write('[error] breadth requires --expr\n'); return 1; }
    let ast;
    try { ast = parseTrigger(values.expr); }
    catch (e) { stderr.write(`[error] parse: ${e.message}\n`); return 1; }
    const matches = [];
    for await (const abs of walk({ root, cap: cfg.review.walk_file_cap })) {
      const rel = relative(root, abs);
      const size = await sizeOf(abs);
      const needsContent = /content:/.test(values.expr);
      let content = '', binary = false;
      if (needsContent) {
        const buf = await readFile(abs).catch(() => null);
        if (!buf) continue;
        binary = isBinary(buf);
        content = buf.toString('utf8');
      }
      if (evalTrigger(ast, { path: rel, content, binary: shouldTreatAsNonMatchForContent(size, binary) })) {
        matches.push(rel);
      }
    }
    stdout.write(JSON.stringify({ matches: matches.length, sample: matches.slice(0, 10) }, null, 2) + '\n');
    return 0;
  }

  if (sub === 'intent-test') {
    if (!values.intent || !values.files) {
      stderr.write('[error] intent-test requires --intent and --files\n'); return 1;
    }
    const provider = getProvider(cfg, {});
    const results = [];
    for (const f of values.files.slice(0, 10)) {
      const abs = resolveCliPath(cwd, f);
      const content = await readFile(abs, 'utf8').catch(() => null);
      if (content === null) { results.push({ path: f, match: false, error: 'unreadable' }); continue; }
      const prompt = `Does the file at ${f} implement this intent: ${values.intent}? Answer exactly 'yes' or 'no'.`;
      const r = await provider.verify(prompt, { maxTokens: 8 });
      const text = String(r.reason ?? '').toLowerCase();
      const match = /\byes\b/.test(text);
      results.push({ path: f, match, raw: r.reason });
    }
    stdout.write(JSON.stringify(results, null, 2) + '\n');
    return 0;
  }

  if (sub === 'test-drive') {
    if (!values['rule-body'] || !values.triggers || !values.files) {
      stderr.write('[error] test-drive requires --rule-body --triggers --files\n'); return 1;
    }
    const body = await readFile(resolveCliPath(cwd, values['rule-body']), 'utf8');
    const ephemeral = {
      id: 'ephemeral',
      source: 'local', sourceName: null, path: values['rule-body'],
      frontmatter: { name: 'Ephemeral', triggers: values.triggers, provider: null, model: null, intent: null },
      body,
    };
    const results = [];
    for (const f of values.files) {
      const raw = await readFile(resolveCliPath(cwd, f)).catch(() => null);
      if (!raw) { results.push({ path: f, error: 'unreadable' }); continue; }
      const binary = isBinary(raw);
      const content = raw.toString('utf8');
      const res = await reviewFile({
        repoRoot: root, config: cfg, rules: [ephemeral],
        file: { path: f, content, binary },
        diff: null, intentGate: null, historyEnabled: false,
        stderr,
      });
      results.push({ path: f, verdicts: res.verdicts });
    }
    stdout.write(JSON.stringify(results, null, 2) + '\n');
    return 0;
  }

  if (sub === 'save') {
    if (!values.name || !values.triggers || !values['body-file'] || !values.to) {
      stderr.write('[error] save requires --name --triggers --body-file --to\n'); return 1;
    }
    const body = await readFile(resolveCliPath(cwd, values['body-file']), 'utf8');
    const content = renderRule({
      name: values.name,
      triggers: values.triggers,
      intent: values.intent,
      description: values.description,
      provider: values.provider,
      model: values.model,
      body,
    });
    const abs = await saveRule({ repoRoot: root, relativePath: values.to, content });
    stdout.write(`Saved: ${abs}\nRun 'git add ${abs} && git commit' when ready.\n`);
    return 0;
  }

  stderr.write(`[error] unknown subcommand: ${sub}\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
