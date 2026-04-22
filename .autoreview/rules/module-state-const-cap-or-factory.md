---
name: "Module state: const ALL_CAPS or factory"
triggers: 'path:"scripts/lib/**/*.mjs"'
description: "Use when a library module declares top-level Map/Set; must be frozen ALL_CAPS const or moved into a factory."
---
Module-level `new Map()`/`new Set()` in `scripts/lib/` is acceptable only as a frozen lookup declared with `const` and a SCREAMING_SNAKE_CASE name, populated inline at declaration (e.g. `const REASONING_SUPPORT = new Set(['anthropic', ...])` in `reviewer.mjs`, `STOPWORDS` in `guide.mjs`). The single sanctioned exception is the process-wide `CACHE` in `provider-client.mjs`, paired with an exported `clearProviderCache()` reset. Per-request mutable state (accumulators, per-file caches, sessions) MUST live inside a factory (`createIntentGate`, `createHistorySession`, `_state` object) so tests create fresh instances. Module-level `let` collections or mutable `const` camelCase collections without reset export are forbidden.

