---
name: "Dynamic import must be justified"
triggers: 'path:"scripts/**/*.mjs" AND content:"await import"'
description: "Use when a module uses await import(...); must be subcommand dispatch, cycle-break, or optional lazy load — not deferred cost."
---
Static `import` at the top of the file is the default. `await import(...)` is legitimate in only three shapes:
1. Subcommand dispatch table that lazy-loads each bin (see `scripts/bin/autoreview.mjs` SUBCOMMANDS map).
2. Breaking a require cycle inside a factory closure (see `createHistorySession` in `history.mjs` lazily pulling node:fs).
3. Loading an optional module that may legitimately not exist at call time.
Using `await import()` for a module already statically importable elsewhere in the same file, or to "defer cost" without measurement, is a code smell.

