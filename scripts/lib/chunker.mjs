// scripts/lib/chunker.mjs
import { PROMPT_BOILERPLATE_BYTES } from './prompt-builder.mjs';

const TRUNC_MARKER = '\n[... truncated]';

export function fitFile({ fileContent, rule, diff = null, contextWindowBytes, outputReserveBytes = 2000 }) {
  const ruleBytes = Buffer.byteLength(rule.body ?? '');
  const diffBytes = diff ? Buffer.byteLength(diff) : 0;
  const fileBytes = Buffer.byteLength(fileContent);
  const available = contextWindowBytes - PROMPT_BOILERPLATE_BYTES - ruleBytes - diffBytes - outputReserveBytes;
  if (available <= 0) return { action: 'skip', reason: 'rule + diff + reserve overflow window' };
  if (fileBytes <= available) return { action: 'fit', fileContent };
  if (fileBytes > 3 * available) return { action: 'skip', reason: `file ${fileBytes} bytes exceeds 3x available window ${available}` };
  const sliceBytes = available - Buffer.byteLength(TRUNC_MARKER);
  if (sliceBytes <= 0) return { action: 'skip', reason: `available window ${available} bytes smaller than truncation marker — no room to fit content` };
  const truncated = Buffer.from(fileContent).slice(0, sliceBytes).toString('utf8') + TRUNC_MARKER;
  return { action: 'truncate', fileContent: truncated };
}
