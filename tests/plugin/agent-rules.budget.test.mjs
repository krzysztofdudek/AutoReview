import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function roughTokens(text) { return Math.ceil(Buffer.byteLength(text) / 4); }

test('agent-rules.md within 1200-token hard ceiling', async () => {
  const body = await readFile('templates/agent-rules.md', 'utf8');
  const toks = roughTokens(body);
  assert.ok(toks <= 1200, `agent-rules.md is ${toks} tokens, ceiling 1200`);
});

test('agent-rules.md within 1000-token target (warning only)', async () => {
  const body = await readFile('templates/agent-rules.md', 'utf8');
  const toks = roughTokens(body);
  if (toks > 1000) {
    console.warn(`[budget] agent-rules.md is ${toks} tokens, target 1000 exceeded`);
  }
});
