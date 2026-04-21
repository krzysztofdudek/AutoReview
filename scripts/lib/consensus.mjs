// scripts/lib/consensus.mjs
export async function voteConsensus(provider, prompt, { consensus, maxTokens, reasoningEffort } = {}) {
  const calls = [];
  for (let i = 0; i < consensus; i++) {
    calls.push(provider.verify(prompt, { maxTokens, reasoningEffort }));
  }
  const results = await Promise.all(calls);
  const good = results.filter(r => !r.providerError);
  if (good.length <= consensus / 2) {
    return { satisfied: false, providerError: true, votes: consensus, raw: results };
  }
  const trues = good.filter(r => r.satisfied);
  const falses = good.filter(r => !r.satisfied);
  const winners = trues.length >= falses.length ? trues : falses;
  const winner = winners[0];
  return { satisfied: winner.satisfied, reason: winner.reason, suppressed: winner.suppressed, votes: consensus };
}
