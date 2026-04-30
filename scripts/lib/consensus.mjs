// scripts/lib/consensus.mjs
//
// No outer Promise.race timeout: an outer race timer would start ticking the moment
// the verify promise is created — which is before sem.acquire() in the wrapped
// provider — so calls queued behind a slow LLM would die in the queue instead of
// running. Each provider already enforces its own timeout (HTTP `timeoutMs` for
// network providers, `runCli` `timeoutMs` for CLI providers); that timer starts
// when the slot is actually held.

export async function voteConsensus(provider, prompt, { consensus = 1, maxTokens, reasoningEffort } = {}) {
  const calls = [];
  for (let i = 0; i < consensus; i++) {
    calls.push(
      provider.verify(prompt, { maxTokens, reasoningEffort })
        .catch(err => ({ satisfied: false, providerError: true, raw: String(err) })),
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
  // Aggregate token usage across all votes — callers see the real cost of consensus=N.
  const usage = aggregateUsage(good);
  return { satisfied: winner.satisfied, reason: winner.reason, suppressed: winner.suppressed, votes: consensus, usage };
}

function aggregateUsage(results) {
  const withUsage = results.filter(r => r.usage);
  if (withUsage.length === 0) return null;
  return withUsage.reduce((acc, r) => ({
    input_tokens: (acc.input_tokens ?? 0) + (r.usage.input_tokens ?? 0),
    output_tokens: (acc.output_tokens ?? 0) + (r.usage.output_tokens ?? 0),
    total_tokens: (acc.total_tokens ?? 0) + (r.usage.total_tokens ?? 0),
  }), {});
}
