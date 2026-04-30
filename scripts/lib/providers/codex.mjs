import { runCli, whichBinary } from '../cli-base.mjs';
import { parseResponse } from '../response-parser.mjs';

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { satisfied: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['satisfied', 'reason'],
});

export function create({ model, timeoutMs = 120_000, _binary = 'codex', _argPrefix = [] }) {
  return {
    name: 'codex', model,
    async isAvailable() { return !!(await whichBinary(_binary)); },
    async verify(prompt, { maxTokens: _t, reasoningEffort: _r } = {}) {
      const r = await runCli({
        binary: _binary,
        args: [..._argPrefix, 'exec', '-', '--json', '-m', model, '--output-schema', SCHEMA],
        stdin: prompt,
        timeoutMs,
      });
      if (r.timedOut) return { satisfied: false, providerError: true, raw: 'timeout' };
      if (r.exitCode !== 0) return { satisfied: false, providerError: true, raw: r.stderr };
      return parseResponse(r.stdout);
    },
    async contextWindowBytes() { return 128_000 * 4; },
  };
}
