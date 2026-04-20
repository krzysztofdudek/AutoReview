import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate, matchPath, shouldTreatAsNonMatchForContent } from '../../scripts/lib/trigger-engine.mjs';

test('parse single path predicate', () => {
  const ast = parse('path:"src/**/*.ts"');
  assert.equal(ast.type, 'pred');
  assert.equal(ast.kind, 'path');
  assert.equal(ast.value, 'src/**/*.ts');
});

test('parse AND of two predicates', () => {
  const ast = parse('path:"a/**" AND content:"x"');
  assert.equal(ast.type, 'and');
  assert.equal(ast.children.length, 2);
});

test('parse nested parens and NOT', () => {
  const ast = parse('(path:"a" OR path:"b") AND NOT content:"c"');
  assert.equal(ast.type, 'and');
});

test('case-insensitive operators', () => {
  assert.doesNotThrow(() => parse('path:"a" and path:"b"'));
  assert.doesNotThrow(() => parse('path:"a" Or path:"b"'));
});

test('reserved words inside strings are literal', () => {
  const ast = parse('content:"AND OR NOT"');
  assert.equal(ast.value, 'AND OR NOT');
});

test('matchPath globstar', () => {
  assert.equal(matchPath('src/**/*.ts', 'src/a/b/c.ts'), true);
  assert.equal(matchPath('src/**/*.ts', 'src/a.ts'), true);
  assert.equal(matchPath('src/**/*.ts', 'other/a.ts'), false);
});

test('matchPath brace expansion', () => {
  assert.equal(matchPath('src/{api,handlers}/**', 'src/api/x.ts'), true);
  assert.equal(matchPath('src/{api,handlers}/**', 'src/handlers/y.ts'), true);
  assert.equal(matchPath('src/{api,handlers}/**', 'src/other/z.ts'), false);
});

test('evaluate with binary=true skips content predicates', () => {
  const ast = parse('path:"a.bin" AND content:"anything"');
  assert.equal(evaluate(ast, { path: 'a.bin', content: '', binary: true }), false);
  const astPath = parse('path:"a.bin"');
  assert.equal(evaluate(astPath, { path: 'a.bin', content: '', binary: true }), true);
});

test('evaluate content with regex', () => {
  const ast = parse('content:"@Controller"');
  assert.equal(evaluate(ast, { path: 'x.ts', content: '@Controller\nclass A {}', binary: false }), true);
});

test('parse error carries position', () => {
  try { parse('path: "missing quote'); assert.fail('should throw'); }
  catch (e) { assert.ok(e.message.match(/unterminated|position|column|line/i) || e.position !== undefined); }
});

test('oversized file treated as non-match for content', () => {
  assert.equal(shouldTreatAsNonMatchForContent(2_000_000, false), true);
  assert.equal(shouldTreatAsNonMatchForContent(1000, true), true);
  assert.equal(shouldTreatAsNonMatchForContent(1000, false), false);
});
