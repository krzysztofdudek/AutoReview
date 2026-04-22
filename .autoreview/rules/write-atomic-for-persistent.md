---
name: "Write atomic for persistent repo files"
triggers: 'path:"scripts/**/*.mjs" AND content:"writeFile"'
description: "Use when persisting a durable repo-level file (hook, .gitignore, config); prefer writeAtomic over plain writeFile."
---
Use `writeAtomic(path, content)` from `scripts/lib/fs-utils.mjs` when writing files that (a) live under the user's repo long-term and (b) could be read concurrently or leave the repo broken if a partial write is observed. This covers: `.git/hooks/pre-commit`, `.gitignore`, anything under `.autoreview/` that a subsequent process might race against.
Plain `writeFile` is fine only for: ephemeral sidecars (history sidecar files, content-addressed by sha), one-shot init-time template dumps where a crash mid-write is recoverable by re-running `init`, and JSONL append-log entries (use `appendFile`). If in doubt, prefer `writeAtomic` — the cost is one rename().

