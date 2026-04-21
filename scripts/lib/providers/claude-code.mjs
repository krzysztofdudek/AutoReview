// reasoningEffort reserved — CLI does not accept it as an arg today. Ignored.
import { runCli, whichBinary } from '../cli-base.mjs';
import { parseResponse } from '../response-parser.mjs';

export function create({ model, _binary = 'claude' }) {
  return {
    name: 'claude-code',
    model,
    async isAvailable() { return !!(await whichBinary(_binary)); },
    async verify(prompt, { maxTokens: _t, reasoningEffort: _r } = {}) {
      const r = await runCli({
        binary: _binary,
        args: ['--model', model, '--print'],
        stdin: prompt,
        timeoutMs: 120_000,
      });
      if (r.timedOut) return { satisfied: false, providerError: true, raw: 'timeout' };
      if (r.exitCode !== 0) return { satisfied: false, providerError: true, raw: r.stderr };
      return parseResponse(r.stdout);
    },
    async contextWindowBytes() { return 200_000 * 4; },
  };
}
