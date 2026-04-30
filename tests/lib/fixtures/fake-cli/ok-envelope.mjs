#!/usr/bin/env node
// Mimics `claude --print --output-format json` shape.
const envelope = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '```json\n{"satisfied":true,"reason":"ok"}\n```',
  usage: {
    input_tokens: 12,
    output_tokens: 7,
    total_tokens: 19,
  },
};
process.stdout.write(JSON.stringify(envelope) + '\n');
process.exit(0);
