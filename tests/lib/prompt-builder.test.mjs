import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, PROMPT_BOILERPLATE_BYTES } from '../../scripts/lib/prompt-builder.mjs';

const rule = {
  id: 'api/validate',
  frontmatter: { name: 'Validate Input' },
  body: 'Use zod on every handler.',
};
const file = { path: 'src/api/users.ts', content: 'export const x = 1;' };

test('prompt includes diff tag with content when diff is provided', () => {
  const p = buildPrompt({ rule, file, diff: '+ added\n- removed', mode: 'quick' });
  assert.match(p, /<task>[\s\S]+<\/task>/);
  assert.match(p, /<rule id="api\/validate"/);
  assert.match(p, /<file path="src\/api\/users\.ts"/);
  assert.match(p, /<diff>[\s\S]*\+ added[\s\S]*<\/diff>/);
  assert.match(p, /Mode: quick/);
});

test('no diff emits diff tag with placeholder', () => {
  const p = buildPrompt({ rule, file, diff: null, mode: 'thinking' });
  assert.match(p, /<diff>/);
  assert.match(p, /no diff — reviewing file state/);
  assert.match(p, /Mode: thinking/);
});

test('non-null diff emits diff content unchanged', () => {
  const p = buildPrompt({ rule, file, diff: '+ added line\n- removed line', mode: 'quick' });
  assert.match(p, /<diff>/);
  assert.match(p, /\+ added line/);
  assert.match(p, /- removed line/);
});

test('PROMPT_BOILERPLATE_BYTES roughly matches a rendering', () => {
  const empty = buildPrompt({
    rule: { id: 'x', frontmatter: { name: 'X' }, body: '' },
    file: { path: 'p', content: '' },
    diff: null, mode: 'quick',
  });
  assert.ok(Math.abs(Buffer.byteLength(empty) - PROMPT_BOILERPLATE_BYTES) < 500);
});

test('rule-body HTML-like tags are NOT escaped', () => {
  const rulex = { id: 'a', frontmatter: { name: 'A' }, body: 'Use <div> markup.' };
  const p = buildPrompt({ rule: rulex, file, diff: null, mode: 'quick' });
  assert.match(p, /Use <div> markup\./);
});

test('quick mode instructs reviewer to output ONLY {"satisfied": bool}', () => {
  const p = buildPrompt({ rule, file, diff: null, mode: 'quick' });
  assert.match(p, /quick: output exactly \{"satisfied": true\|false\}/);
});

test('thinking mode instructs reviewer to include reason with file:line refs', () => {
  const p = buildPrompt({ rule, file, diff: null, mode: 'thinking' });
  assert.match(p, /reason.*file:line/i);
});
