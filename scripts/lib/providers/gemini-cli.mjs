import { runCli, whichBinary } from '../cli-base.mjs';
import { parseResponse } from '../response-parser.mjs';

export function create({ model, _binary = 'gemini', _runCli = runCli }) {
  return {
    name: 'gemini-cli', model,
    async isAvailable() { return !!(await whichBinary(_binary)); },
    async verify(prompt, { maxTokens: _t, reasoningEffort: _r } = {}) {
      const r = await _runCli({
        binary: _binary,
        args: ['-p', prompt, '-o', 'json', '-m', model],
        stdin: null,
        timeoutMs: 120_000,
      });
      if (r.timedOut) return { satisfied: false, providerError: true, raw: 'timeout' };
      if (r.spawnError === 'E2BIG') return { satisfied: false, providerError: true, raw: 'prompt too large for arg mode' };
      if (r.exitCode !== 0) return { satisfied: false, providerError: true, raw: r.stderr };
      return parseResponse(r.stdout);
    },
    async contextWindowBytes() { return 1_000_000 * 4; },
  };
}
