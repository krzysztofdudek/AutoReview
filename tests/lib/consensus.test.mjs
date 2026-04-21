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

test('voteConsensus times out a hanging provider call', async () => {
  const stuck = {
    name: 'stuck', model: 'x',
    async verify() { return new Promise(() => {}); }, // never resolves
  };
  const start = Date.now();
  const r = await voteConsensus(stuck, 'p', { consensus: 1, maxTokens: 100, timeoutMs: 100 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `expected ~100ms, took ${elapsed}ms`);
  assert.equal(r.providerError, true);
});
