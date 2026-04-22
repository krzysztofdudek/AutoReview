import { request, withRetry, retryable } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

export function create({ model, apiKey, url = 'https://api.openai.com/v1/chat/completions', _retryOptions = {} }) {
  return {
    name: 'openai',
    model,
    async isAvailable() { return !!apiKey; },
    async verify(prompt, { maxTokens, reasoningEffort } = {}) {
      if (!apiKey) return { satisfied: false, providerError: true, raw: 'no api key' };
      const body = {
        model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      };
      // 0 = no explicit cap; omit to let the server/model pick its own ceiling.
      if (maxTokens > 0) body.max_tokens = maxTokens;
      if (reasoningEffort) body.reasoning_effort = reasoningEffort;
      try {
        const r = await withRetry(async () => {
          const res = await request({
            url, method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            timeoutMs: 120_000,
          });
          if (res.status >= 500 && res.status < 600) {
            const e = new Error(`openai status:${res.status}`); e.status = res.status; throw e;
          }
          return res;
        }, { attempts: 3, initialMs: 500, factor: 2, jitterMs: 200, shouldRetry: retryable, ..._retryOptions });
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
