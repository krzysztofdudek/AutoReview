---
name: "Test: stub provider via sanctioned paths only"
triggers: 'path:"tests/**/*.test.mjs" AND (content:"reviewFile" OR content:"validate.mjs")'
description: "Use when bypassing the LLM in a test; only _providerOverride injection or AUTOREVIEW_STUB_PROVIDER env var are sanctioned."
---
There are exactly two sanctioned ways to neutralize the LLM in tests:
(a) inject `_providerOverride: { name, model, verify: async () => ({...}), contextWindowBytes: async () => N }` into `reviewFile` (library tests).
(b) pass `env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' | 'fail' | 'error' }` to the CLI `run(...)` (bin tests).
Never import a real provider factory (`create` from `providers/anthropic.mjs` et al.) in a non-provider test — doing so risks real network calls if `apiKey` leaks from `process.env`. Provider-specific test files are the only place `create()` is called, and those tests always point `url:` at a local 127.0.0.1:${port} fake.

