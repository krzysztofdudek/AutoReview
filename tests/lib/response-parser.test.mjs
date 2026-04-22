import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from '../../scripts/lib/response-parser.mjs';

test('tier 1: direct JSON, reason dropped on pass', () => {
  const r = parseResponse('{"satisfied":true,"reason":"ok"}');
  assert.equal(r.satisfied, true);
  assert.equal(r.reason, undefined);
});

test('tier 1: direct JSON, reason kept on fail', () => {
  const r = parseResponse('{"satisfied":false,"reason":"missing validation"}');
  assert.equal(r.satisfied, false);
  assert.equal(r.reason, 'missing validation');
});

test('tier 2: markdown fence', () => {
  const r = parseResponse('Some preamble\n```json\n{"satisfied":false,"reason":"x"}\n```\nTrailer');
  assert.equal(r.satisfied, false);
  assert.equal(r.reason, 'x');
});

test('tier 2: bare fence (no json tag)', () => {
  const r = parseResponse('```\n{"satisfied":true}\n```');
  assert.equal(r.satisfied, true);
});

test('tier 3: balanced brace in noisy text, pass drops reason', () => {
  const r = parseResponse('model output: {"satisfied": true, "reason": "nested {braces} fine"} end');
  assert.equal(r.satisfied, true);
  assert.equal(r.reason, undefined);
});

test('tier 3: strings with escaped quotes do not throw', () => {
  const r = parseResponse('blah {"satisfied":false,"reason":"he said \\"hi\\""} blah');
  assert.equal(r.satisfied, false);
  assert.match(r.reason, /he said/);
});

test('tier 4: natural-language fallback', () => {
  const r = parseResponse('The file is not satisfied because of missing validation.');
  assert.equal(r.satisfied, false);
  assert.match(r.reason, /satisfied/);
});

test('tier 4: positive natural language', () => {
  const r = parseResponse('Yes, this file is satisfied. All checks pass.');
  assert.equal(r.satisfied, true);
});

test('empty / unparseable returns providerError', () => {
  const r = parseResponse('');
  assert.equal(r.providerError, true);
});
