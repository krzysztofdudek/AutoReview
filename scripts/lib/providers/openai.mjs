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
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      };
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
        return parseResponse(payload.choices?.[0]?.message?.content ?? '');
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() { return 128_000 * 4; },
  };
}
