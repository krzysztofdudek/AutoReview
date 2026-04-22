---
name: "Test: restore mutated globals in finally"
triggers: 'path:"tests/**/*.test.mjs" AND (content:"process.env." OR content:"console.error =" OR content:"console.log =")'
description: "Use when a test mutates a global (process.env, console method); restore in finally to prevent test bleed."
---
Tests run in a single Node process (`node --test`), so mutations leak between tests unless explicitly restored. Two established patterns:
(1) env vars — `process.env.FOO = 'x'; try { ... } finally { delete process.env.FOO; }`
(2) console spies — `const origError = console.error; console.error = s => warns.push(s); try { ... } finally { console.error = origError; }`
Prefer passing `env: { ...process.env, FOO: 'x' }` into the code under test when possible — it avoids mutation entirely and is how bin tests handle `AUTOREVIEW_STUB_PROVIDER`. A missing `finally` restore silently breaks later tests that read the same var.

