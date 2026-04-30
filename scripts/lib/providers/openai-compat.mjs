import { create as createOpenai } from './openai.mjs';

export function create({ model, apiKey = '', endpoint, timeoutMs }) {
  if (!endpoint) throw new Error('openai-compat requires endpoint');
  const normalized = endpoint.replace(/\/$/, '') + '/chat/completions';
  const impl = createOpenai({ model, apiKey: apiKey || 'placeholder', url: normalized, timeoutMs, _providerName: 'openai-compat' });
  return {
    ...impl,
    async isAvailable() { return !!apiKey || !!endpoint; },
    async contextWindowBytes() { return 16384; },
  };
}
