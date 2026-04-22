---
name: "External I/O explicit timeoutMs"
triggers: 'path:"scripts/**/*.mjs" AND (content:"runCli" OR content:"request")'
description: "Use when calling request()/runCli(); every external I/O must pass explicit timeoutMs."
---
Every invocation of `request({...})` from `scripts/lib/http-client.mjs` and every invocation of `runCli({...})` from `scripts/lib/cli-base.mjs` must pass an explicit `timeoutMs`. Do not rely on the 120_000 default — stating the budget makes the intent legible (availability probes use 1000-3000ms; reviewer calls use 120_000ms). Short probe calls (isAvailable, ollamaHasModel, reachability checks at init) should use ≤3000ms. LLM completion calls should use 120_000ms and be wrapped in `withRetry()` so 5xx bursts don't surface as verdict errors.

