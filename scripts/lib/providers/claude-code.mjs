// reasoningEffort reserved — CLI does not accept it as an arg today. Ignored.
import { runCli, whichBinary } from '../cli-base.mjs';
import { parseResponse } from '../response-parser.mjs';

// Maximum-isolation flags. Each one strips a class of caller-side context that would
// otherwise pollute the verdict prompt:
//   --tools ""                       -- no built-in tools
//   --disable-slash-commands         -- no skills loaded
//   --setting-sources ""             -- no user/project/local settings (skips hooks too)
//   --strict-mcp-config + empty cfg  -- ignore MCP servers in the host config
//   --no-session-persistence         -- don't write session to disk
//   --exclude-dynamic-system-prompt-sections -- drop cwd/env/git-status from system prompt
//   --output-format json             -- structured envelope around the model response
//                                       (extracted as `.result`, fed to parseResponse)
const ISOLATION_ARGS = [
  '--tools', '',
  '--disable-slash-commands',
  '--setting-sources', '',
  '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}',
  '--no-session-persistence',
  '--exclude-dynamic-system-prompt-sections',
  '--output-format', 'json',
];

export function create({ model, timeoutMs = 120_000, _binary = 'claude', _argPrefix = [] }) {
  return {
    name: 'claude-code',
    model,
    async isAvailable() { return !!(await whichBinary(_binary)); },
    async verify(prompt, { maxTokens: _t, reasoningEffort: _r } = {}) {
      const r = await runCli({
        binary: _binary,
        args: [..._argPrefix, '--print', '--model', model, ...ISOLATION_ARGS],
        stdin: prompt,
        timeoutMs,
      });
      if (r.timedOut) return { satisfied: false, providerError: true, raw: 'timeout' };
      if (r.exitCode !== 0) return { satisfied: false, providerError: true, raw: r.stderr };
      let envelope;
      try { envelope = JSON.parse(r.stdout); }
      catch { return { satisfied: false, providerError: true, raw: r.stdout }; }
      const out = parseResponse(envelope.result ?? '');
      if (envelope.usage) {
        const inT = envelope.usage.input_tokens ?? 0;
        const outT = envelope.usage.output_tokens ?? 0;
        out.usage = {
          input_tokens: inT,
          output_tokens: outT,
          total_tokens: envelope.usage.total_tokens ?? inT + outT,
        };
      }
      return out;
    },
    async contextWindowBytes() { return 200_000 * 4; },
  };
}
