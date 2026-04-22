import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSuppressMarkers } from '../../scripts/lib/suppress-parser.mjs';

test('returns empty for content without any markers', () => {
  assert.deepEqual(scanSuppressMarkers('export const x = 1;\n'), []);
});

test('returns empty for marker outside any comment prefix', () => {
  // No comment prefix and no line.includes('@autoreview-ignore') check triggers — but the
  // inner regex only runs if the line starts with a comment. Plain text with the token
  // anywhere also fires via the fallback `line.includes('@autoreview-ignore')` branch.
  const markers = scanSuppressMarkers('regular text\n');
  assert.deepEqual(markers, []);
});

test('parses // comment with rule id + reason', () => {
  const [m] = scanSuppressMarkers('// @autoreview-ignore no-console debug output\nconsole.log(1);\n');
  assert.equal(m.ruleId, 'no-console');
  assert.equal(m.reason, 'debug output');
  assert.equal(m.valid, true);
  assert.equal(m.line, 1);
});

test('parses # comment (python-style)', () => {
  const [m] = scanSuppressMarkers('# @autoreview-ignore rule body here\n');
  assert.equal(m.ruleId, 'rule');
  assert.equal(m.reason, 'body here');
});

test('parses block comment opener /* … */', () => {
  const [m] = scanSuppressMarkers('/* @autoreview-ignore my-rule because */\n');
  assert.equal(m.ruleId, 'my-rule');
  assert.equal(m.reason, 'because');
});

test('parses leading-star doc comment line', () => {
  const [m] = scanSuppressMarkers(' * @autoreview-ignore my-rule docstring note\n');
  assert.equal(m.ruleId, 'my-rule');
});

test('parses HTML comment marker', () => {
  const [m] = scanSuppressMarkers('<!-- @autoreview-ignore r some reason -->\n');
  assert.equal(m.ruleId, 'r');
  assert.match(m.reason, /some reason/);
});

test('also parses when marker appears mid-line without comment prefix', () => {
  // suppress-parser has a fallback: line.includes('@autoreview-ignore').
  const [m] = scanSuppressMarkers('x = 1 // @autoreview-ignore r inline ok\n');
  assert.equal(m.ruleId, 'r');
  assert.equal(m.reason, 'inline ok');
});

test('missing reason marks valid: false', () => {
  const [m] = scanSuppressMarkers('// @autoreview-ignore no-console\n');
  assert.equal(m.valid, false);
  assert.equal(m.reason, '');
});

test('scope: file-top when line < 5', () => {
  // Line 1, 2, 3, 4 → file-top; line 5 still file-top per <5 boundary; line 6+ → block.
  const src = '\n'.repeat(3) + '// @autoreview-ignore r reason\n';
  const [m] = scanSuppressMarkers(src);
  assert.equal(m.line, 4);
  assert.equal(m.scope, 'file-top');
});

test('scope: block when line >= 5', () => {
  const src = '\n'.repeat(5) + '// @autoreview-ignore r reason\n';
  const [m] = scanSuppressMarkers(src);
  assert.equal(m.line, 6);
  assert.equal(m.scope, 'block');
});

test('scope boundary exactly at line 5 -> file-top', () => {
  const src = '\n'.repeat(4) + '// @autoreview-ignore r reason\n';
  const [m] = scanSuppressMarkers(src);
  assert.equal(m.line, 5);
  // "i < 5" → i=4 (0-based) is still file-top
  assert.equal(m.scope, 'file-top');
});

test('multiple markers on different lines parsed independently', () => {
  const src = [
    '// @autoreview-ignore rule-a first',
    'x',
    '// @autoreview-ignore rule-b second',
  ].join('\n');
  const ms = scanSuppressMarkers(src);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].ruleId, 'rule-a');
  assert.equal(ms[1].ruleId, 'rule-b');
});

test('rule id accepts slashes (namespaced)', () => {
  const [m] = scanSuppressMarkers('// @autoreview-ignore team/shared/rule because\n');
  assert.equal(m.ruleId, 'team/shared/rule');
});

test('rule id accepts dashes + underscores + digits', () => {
  const [m] = scanSuppressMarkers('// @autoreview-ignore rule_1-v2 body\n');
  assert.equal(m.ruleId, 'rule_1-v2');
});

test('trailing */ and --> comment terminators stripped from reason', () => {
  const m1 = scanSuppressMarkers('/* @autoreview-ignore r reason text */\n')[0];
  assert.equal(m1.reason, 'reason text');
  const m2 = scanSuppressMarkers('<!-- @autoreview-ignore r reason text -->\n')[0];
  assert.equal(m2.reason, 'reason text');
});

test('CRLF line endings handled', () => {
  const src = '// @autoreview-ignore r reason\r\nnext\r\n';
  const [m] = scanSuppressMarkers(src);
  assert.equal(m.ruleId, 'r');
  assert.equal(m.reason, 'reason');
});
