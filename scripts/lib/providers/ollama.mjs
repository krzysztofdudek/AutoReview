// scripts/lib/providers/ollama.mjs
// reasoningEffort is ignored — Ollama API has no thinking/effort knob.

import { request, withRetry, retryable } from '../http-client.mjs';
import { parseResponse } from '../response-parser.mjs';

export async function ollamaHasModel(endpoint, model) {
  try {
    const r = await request({ url: `${endpoint}/api/tags`, timeoutMs: 2000 });
    if (r.status !== 200) return false;
    const payload = JSON.parse(r.body);
    const models = payload.models ?? [];
    return models.some(m => m.name === model || m.name.startsWith(`${model}:`));
  } catch { return false; }
}

export function create({ endpoint, model }) {
  return {
    name: 'ollama',
    model,
    async isAvailable() {
      try {
        const r = await request({ url: `${endpoint}/api/tags`, timeoutMs: 1000 });
        return r.status === 200;
      } catch { return false; }
    },
    async verify(prompt, { maxTokens, reasoningEffort: _ignored } = {}) {
      try {
        const r = await withRetry(
          async () => {
            const res = await request({
              url: `${endpoint}/api/generate`,
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: { num_predict: maxTokens, temperature: 0 },
              }),
              timeoutMs: 120_000,
            });
            if (res.status >= 500 && res.status < 600) {
              const e = new Error(`ollama status:${res.status}`); e.status = res.status; throw e;
            }
            return res;
          },
          { attempts: 3, initialMs: 500, factor: 2, jitterMs: 200, shouldRetry: retryable },
        );
        if (r.status !== 200) return { satisfied: false, providerError: true, raw: r.body };
        const payload = JSON.parse(r.body);
        return parseResponse(payload.response ?? '');
      } catch (err) {
        return { satisfied: false, providerError: true, raw: String(err) };
      }
    },
    async contextWindowBytes() {
      try {
        const r = await request({
          url: `${endpoint}/api/show`, method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: model }),
          timeoutMs: 3000,
        });
        if (r.status !== 200) return 32768;
        const info = JSON.parse(r.body);
        const ctx = info.model_info?.general?.context_length;
        return ctx ? ctx * 4 : 32768;
      } catch { return 32768; }
    },
  };
}
