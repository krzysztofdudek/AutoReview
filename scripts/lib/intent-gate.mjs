// scripts/lib/intent-gate.mjs
import { createHash } from 'node:crypto';

export function createIntentGate({ resolveProvider, budget }) {
  const cache = new Map();
  let used = 0, skipped = 0;

  async function check(rule, filePath, content) {
    const sha = createHash('sha256').update(content).digest('hex');
    const provider = resolveProvider(rule);
    const key = `${rule.id}|${provider.name}|${provider.model}|${sha}`;
    if (cache.has(key)) return cache.get(key);
    if (used >= budget) { skipped++; return 'skip-budget'; }
    used++;
    const prompt = `Does the file at ${filePath} implement this intent: ${rule.frontmatter.intent}? Answer exactly 'yes' or 'no'.`;
    const r = await provider.verify(prompt, { maxTokens: 8 });
    const text = String(r.reason ?? '').toLowerCase();
    const verdict = /\byes\b/.test(text) ? 'match' : 'skip-no';
    cache.set(key, verdict);
    return verdict;
  }

  return { check, stats: () => ({ used, skipped }) };
}
