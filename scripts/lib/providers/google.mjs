import { request, withRetry, retryable, parseRetryAfter } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

const THINK_BUDGETS = { low: 512, medium: 2048, high: 8192 };

export function create({ model, apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', timeoutMs = 120_000 }) {
  return {
    name: 'google',
    model,
    async isAvailable() { return !!apiKey; },
    async verify(prompt, { maxTokens, reasoningEffort } = {}) {
      if (!apiKey) return { satisfied: false, providerError: true, raw: 'no api key' };
      const generationConfig = { temperature: 0 };
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
            timeoutMs,
          });
          if (res.status >= 400) {
            const e = new Error(`google status:${res.status} body:${res.body}`);
            e.status = res.status;
            e.retryAfterMs = parseRetryAfter(res.headers['retry-after']);
            throw e;
          }
          return res;
        }, {
          shouldRetry: retryable,
          onRetry: ({ attempt, attempts, delay, err }) => {
            process.stderr.write(`[warn] google: ${err.status ?? err.code ?? 'transient'} backing off ${delay}ms (attempt ${attempt}/${attempts})\n`);
          },
        });
        if (r.status !== 200) return { satisfied: false, providerError: true, raw: r.body };
        const payload = JSON.parse(r.body);
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const out = parseResponse(text);
        if (payload.usageMetadata) {
          out.usage = {
            input_tokens: payload.usageMetadata.promptTokenCount,
            output_tokens: payload.usageMetadata.candidatesTokenCount,
            total_tokens: payload.usageMetadata.totalTokenCount,
          };
        }
        return out;
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() { return 1_000_000 * 4; },
  };
}
