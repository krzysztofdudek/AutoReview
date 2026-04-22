---
name: "stderr prefix tag"
triggers: 'path:"scripts/bin/*.mjs" AND content:"stderr.write"'
description: "Use when writing to stderr from a bin; every line must start with [error]/[warn]/[info]/[hint] tag."
---
Every `ctx.stderr.write(...)` / `stderr.write(...)` call in a bin script must start with one of the approved prefixes: `[error]`, `[warn]`, `[info]`, or `[hint]`. Verdict prefixes (`[pass]`, `[reject]`, `[suppressed]`) are reserved for `scripts/lib/report.mjs` — bin scripts must not emit them directly. Rules of thumb: `[error]` for unrecoverable problems; `[warn]` for recoverable / degraded-but-continuing; `[info]` for benign status; `[hint]` for debug/next-step guidance. Do not use `console.error` inside bin scripts — always go through `ctx.stderr`. Each write must end with `\n`.

