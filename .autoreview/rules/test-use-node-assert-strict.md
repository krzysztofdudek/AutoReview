---
name: "Test: use node:assert/strict"
triggers: 'path:"tests/**/*.test.mjs"'
description: "Use when authoring a test; import assert from 'node:assert/strict' — never plain 'node:assert'."
---
Every existing test file imports `assert from 'node:assert/strict'`. The strict module makes `assert.equal` behave like `===` and `assert.deepEqual` like `deepStrictEqual`, which is why `assert.strictEqual`/`assert.deepStrictEqual` appear zero times. A new test that imports plain `node:assert` silently loosens comparisons (`'1' == 1`) and produces false positives. Always: `import assert from 'node:assert/strict';` — never `import assert from 'node:assert';` and never mix the two in the same file.

