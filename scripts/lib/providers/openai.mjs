import { request, withRetry, retryable, parseRetryAfter } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

export function create({ model, apiKey, url = 'https://api.openai.com/v1/chat/completions', timeoutMs = 120_000, _retryOptions = {}, _providerName = 'openai' }) {
  return {
    name: _providerName,
    model,
    async isAvailable() { return !!apiKey; },
    async verify(prompt, { maxTokens, reasoningEffort } = {}) {
      if (!apiKey) return { satisfied: false, providerError: true, raw: 'no api key' };
      const body = {
        model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      };
      if (maxTokens > 0) body.max_tokens = maxTokens;
      if (reasoningEffort) body.reasoning_effort = reasoningEffort;
      try {
        const r = await withRetry(async () => {
          const res = await request({
            url, method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            timeoutMs,
          });
          if (res.status >= 400) {
            const e = new Error(`${_providerName} status:${res.status} body:${res.body}`);
            e.status = res.status;
            e.retryAfterMs = parseRetryAfter(res.headers['retry-after']);
            throw e;
          }
          return res;
        }, {
          shouldRetry: retryable,
          onRetry: ({ attempt, attempts, delay, err }) => {
            process.stderr.write(`[warn] ${_providerName}: ${err.status ?? err.code ?? 'transient'} backing off ${delay}ms (attempt ${attempt}/${attempts})\n`);
          },
          ..._retryOptions,
        });
        if (r.status !== 200) return { satisfied: false, providerError: true, raw: r.body };
        const payload = JSON.parse(r.body);
        const out = parseResponse(payload.choices?.[0]?.message?.content ?? '');
        if (payload.usage) {
          out.usage = {
            input_tokens: payload.usage.prompt_tokens,
            output_tokens: payload.usage.completion_tokens,
            total_tokens: payload.usage.total_tokens,
          };
        }
        return out;
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() { return 128_000 * 4; },
  };
}
