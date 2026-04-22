import { request, withRetry, retryable } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

const THINK_BUDGETS = { low: 512, medium: 2048, high: 8192 };

export function create({ model, apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta' }) {
  return {
    name: 'google',
    model,
    async isAvailable() { return !!apiKey; },
    async verify(prompt, { maxTokens, reasoningEffort } = {}) {
      if (!apiKey) return { satisfied: false, providerError: true, raw: 'no api key' };
      const generationConfig = { temperature: 0 };
      // 0 = no explicit cap.
      if (maxTokens > 0) generationConfig.maxOutputTokens = maxTokens;
      if (reasoningEffort && THINK_BUDGETS[reasoningEffort]) {
        generationConfig.thinkingConfig = { thinkingBudget: THINK_BUDGETS[reasoningEffort] };
      }
      try {
        const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const r = await withRetry(async () => {
          const res = await request({
            url, method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig,
            }),
            timeoutMs: 120_000,
          });
          if (res.status >= 500 && res.status < 600) {
            const e = new Error(`google status:${res.status}`); e.status = res.status; throw e;
          }
          return res;
        }, { attempts: 3, initialMs: 500, factor: 2, jitterMs: 200, shouldRetry: retryable });
        if (r.status !== 200) return { satisfied: false, providerError: true, raw: r.body };
        const payload = JSON.parse(r.body);
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        return parseResponse(text);
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() { return 1_000_000 * 4; },
  };
}
