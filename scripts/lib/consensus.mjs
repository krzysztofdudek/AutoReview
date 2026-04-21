// scripts/lib/consensus.mjs

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function voteConsensus(provider, prompt, { consensus = 1, maxTokens, reasoningEffort, timeoutMs = 120_000 } = {}) {
  const calls = [];
  for (let i = 0; i < consensus; i++) {
    calls.push(
      withTimeout(
        provider.verify(prompt, { maxTokens, reasoningEffort }),
        timeoutMs,
        `${provider.name} verify call ${i + 1}/${consensus}`,
      ).catch(err => ({ satisfied: false, providerError: true, raw: String(err) })),
    );
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
