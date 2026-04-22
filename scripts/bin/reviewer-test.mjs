#!/usr/bin/env node
// scripts/bin/reviewer-test.mjs
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { parseArgs } from '../lib/args.mjs';
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { getProvider } from '../lib/provider-client.mjs';
import { buildPrompt } from '../lib/prompt-builder.mjs';

export async function run(argv, ctx) {
  try {
    return await _run(argv, ctx);
  } catch (err) {
    ctx.stderr.write(`[error] internal: ${err.stack ?? err.message ?? String(err)}\n`);
    return 2;
  }
}

async function _run(argv, { cwd, env, stdout, stderr }) {
  const { values } = parseArgs(argv);
  if (!values.rule || !values.file) {
    stderr.write('[error] usage: reviewer-test --rule <id> --file <path> [--content-file <path>] [--provider <name>] [--model <id>] [--mode quick|thinking]\n');
    return 1;
  }

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);
  const { rules } = await loadRules(root, cfg);
  const rule = rules.find(r => r.id === values.rule);
  if (!rule) { stderr.write(`[error] rule not found: ${values.rule}\n`); return 1; }

  // --content-file lets agents submit hypothetical content while keeping --file as the logical path.
  // Relative paths resolve against the CLI ctx.cwd (not process.cwd()).
  const rawContentPath = values['content-file'] ?? values.file;
  const contentPath = isAbsolute(rawContentPath) ? rawContentPath : resolvePath(cwd, rawContentPath);
  const content = await readFile(contentPath, 'utf8').catch(() => null);
  if (content === null) { stderr.write(`[error] cannot read ${rawContentPath}\n`); return 1; }

  const provider = getProvider(cfg, {
    ruleProvider: values.provider ?? rule.frontmatter.provider,
    ruleModel: values.model ?? rule.frontmatter.model,
  });

  const mode = values.mode ?? cfg.review.mode;
  const evaluate = cfg.review.evaluate;
  // Always use values.file as the logical path presented to the reviewer.
  const prompt = buildPrompt({
    rule, file: { path: values.file, content }, diff: null, mode, evaluate,
  });

  stdout.write(`=== PROVIDER ===\n${provider.name} / ${provider.model}\n\n`);
  stdout.write(`=== PROMPT ===\n${prompt}\n\n`);

  const start = Date.now();
  const result = await provider.verify(prompt, {
    // 0 = no limit (adapters handle). Config default is 0.
    maxTokens: cfg.review.output_max_tokens ?? 0,
    reasoningEffort: cfg.review.reasoning_effort,
  });
  const duration = Date.now() - start;

  stdout.write(`=== RESULT ===\n${JSON.stringify(result, null, 2)}\n\n`);
  stdout.write(`=== DURATION ===\n${duration}ms\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
