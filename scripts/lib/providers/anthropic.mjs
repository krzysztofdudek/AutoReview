import { request, withRetry, retryable } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const THINK_BUDGETS = { low: 1024, medium: 4096, high: 16384 };

export function create({ model, apiKey, url = DEFAULT_URL }) {
  return {
    name: 'anthropic',
    model,
    async isAvailable() { return !!apiKey; },
    async verify(prompt, { maxTokens, reasoningEffort } = {}) {
      if (!apiKey) return { satisfied: false, providerError: true, raw: 'no api key' };
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };
      if (reasoningEffort && THINK_BUDGETS[reasoningEffort]) {
        body.thinking = { type: 'enabled', budget_tokens: THINK_BUDGETS[reasoningEffort] };
      }
      try {
        const r = await withRetry(async () => {
          const res = await request({
            url, method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
            timeoutMs: 120_000,
          });
          if (res.status >= 500 && res.status < 600) {
            const e = new Error(`anthropic status:${res.status}`); e.status = res.status; throw e;
          }
          return res;
        }, { attempts: 3, initialMs: 500, factor: 2, jitterMs: 200, shouldRetry: retryable });
        if (r.status !== 200) return { satisfied: false, providerError: true, raw: r.body };
        const payload = JSON.parse(r.body);
        const text = payload.content?.[0]?.text ?? '';
        return parseResponse(text);
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() { return 200_000 * 4; },
  };
}
