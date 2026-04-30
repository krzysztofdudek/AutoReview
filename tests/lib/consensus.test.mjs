import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voteConsensus } from '../../scripts/lib/consensus.mjs';

function stubProvider(sequence) {
  let i = 0;
  return {
    name: 'stub', model: 'x',
    async isAvailable() { return true; },
    async verify() { return sequence[i++ % sequence.length]; },
  };
}

test('consensus=1 returns single call verbatim', async () => {
  const p = stubProvider([{ satisfied: true, reason: 'ok' }]);
  const r = await voteConsensus(p, 'p', { consensus: 1, maxTokens: 100 });
  assert.equal(r.satisfied, true);
  assert.equal(r.reason, 'ok');
  assert.equal(r.votes, 1);
});

test('consensus=3 majority true', async () => {
  const p = stubProvider([
    { satisfied: true, reason: 'a' },
    { satisfied: true, reason: 'b' },
    { satisfied: false, reason: 'c' },
  ]);
  const r = await voteConsensus(p, 'p', { consensus: 3, maxTokens: 100 });
  assert.equal(r.satisfied, true);
  assert.ok(r.reason === 'a' || r.reason === 'b');
});

test('consensus=3 majority false', async () => {
  const p = stubProvider([
    { satisfied: false, reason: 'x' },
    { satisfied: true, reason: 'y' },
    { satisfied: false, reason: 'z' },
  ]);
  const r = await voteConsensus(p, 'p', { consensus: 3, maxTokens: 100 });
  assert.equal(r.satisfied, false);
  assert.ok(r.reason === 'x' || r.reason === 'z');
});

test('majority providerError surfaces providerError', async () => {
  const p = stubProvider([
    { satisfied: false, providerError: true },
    { satisfied: false, providerError: true },
    { satisfied: true, reason: 'ok' },
  ]);
  const r = await voteConsensus(p, 'p', { consensus: 3, maxTokens: 100 });
  assert.equal(r.providerError, true);
});

test('aggregateUsage sums token counts across votes', async () => {
  const p = stubProvider([
    { satisfied: true, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
    { satisfied: true, usage: { input_tokens: 110, output_tokens: 25, total_tokens: 135 } },
    { satisfied: true, usage: { input_tokens: 120, output_tokens: 22, total_tokens: 142 } },
  ]);
  const r = await voteConsensus(p, 'p', { consensus: 3, maxTokens: 100 });
  assert.equal(r.usage.input_tokens, 330);
  assert.equal(r.usage.output_tokens, 67);
  assert.equal(r.usage.total_tokens, 397);
});

test('aggregateUsage returns null when no vote carried usage', async () => {
  const p = stubProvider([{ satisfied: true }, { satisfied: true }]);
  const r = await voteConsensus(p, 'p', { consensus: 1, maxTokens: 100 });
  assert.equal(r.usage, null);
});

// Note: voteConsensus no longer wraps verify in a Promise.race timeout. An outer
// timer started ticking the moment the verify promise was created — i.e. before
// sem.acquire() in provider-client's wrapped provider — so calls queued behind a
// slow LLM died in the queue with provider:0% load. Each provider now enforces
// its own timeout (HTTP `timeoutMs` for network providers, `runCli` `timeoutMs`
// for CLI providers); the timer starts when the slot is actually held.
