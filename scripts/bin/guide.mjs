#!/usr/bin/env node
// scripts/bin/guide.mjs
import { repoRoot } from '../lib/git-utils.mjs';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config-loader.mjs';
import { loadRules } from '../lib/rule-loader.mjs';
import { isMainModule } from '../lib/fs-utils.mjs';

const STOPWORDS = new Set(['a','an','the','to','of','in','is','how','do','i','for','on','it']);

function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !STOPWORDS.has(t));
}

function countHits(tokens, text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    let idx = 0;
    while ((idx = lower.indexOf(t, idx)) !== -1) { total++; idx += t.length; }
  }
  return total;
}

function score(rule, qTokens) {
  const nameHits = countHits(qTokens, rule.frontmatter.name ?? '');
  const descHits = countHits(qTokens, rule.frontmatter.description ?? '');
  const bodyHits = countHits(qTokens, (rule.body ?? '').slice(0, 200));
  return (3 * nameHits + 2 * descHits + bodyHits) / Math.max(1, qTokens.length);
}

function extractLinkedPaths(body) {
  const out = new Set();
  // Markdown links: [text](path)
  for (const m of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const p = m[1].trim();
    if (p && !p.startsWith('http') && !p.startsWith('#')) out.add(p);
  }
  // Backtick-quoted paths ending in common source extensions
  for (const m of body.matchAll(/`([^`]+\.(?:ts|js|py|go|rs|java|rb|mjs|cjs))`/g)) {
    out.add(m[1]);
  }
  return Array.from(out);
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
  const query = argv.join(' ').trim();
  if (!query) { stderr.write('[error] usage: guide <query>\n'); return 1; }

  let root;
  try { root = await repoRoot(cwd); } catch { root = cwd; }
  const cfg = await loadConfig(root, { env }).catch(() => DEFAULT_CONFIG);
  const { rules } = await loadRules(root, cfg);

  const qTokens = tokenize(query);
  const scored = rules
    .map(r => ({ rule: r, score: score(r, qTokens) }))
    .filter(x => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (scored.length === 0) {
    stdout.write(`No relevant rules found. Consider creating one via \`/autoreview:create-rule\`.\n`);
    return 0;
  }

  stdout.write(`Top rules for "${query}":\n`);
  for (const { rule, score } of scored) {
    const desc = rule.frontmatter.description ?? rule.frontmatter.name ?? rule.id;
    stdout.write(`- ${rule.id}: ${desc} — read: ${rule.path} (score ${score.toFixed(2)})\n`);
    const linked = extractLinkedPaths(rule.body ?? '');
    if (linked.length > 0) {
      stdout.write(`  example code paths:\n`);
      for (const p of linked) stdout.write(`    - ${p}\n`);
    }
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
