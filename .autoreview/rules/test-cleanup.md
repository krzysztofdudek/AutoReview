---
name: "Test cleanup in finally"
triggers: 'path:"tests/**/*.test.mjs" AND content:"mkdtemp"'
description: "Tests using mkdtemp must rm the dir recursively in a finally block, not after try. Avoid /tmp pollution."
---
Every test that creates a temp directory via `mkdtemp(...)` must clean it up via `rm(dir, { recursive: true, force: true })` in a `finally` block.

The cleanup must:
- Run in `finally`, not after `try` — so it executes on both pass and throw.
- Use `{ recursive: true, force: true }` to handle non-empty dirs and already-deleted paths safely.
- Clean up every `mkdtemp` in the test (one per `mkdtemp`, matched 1-to-1).

A helper that returns `{ dir, cleanup }` and is called in `finally { await cleanup(); }` satisfies this too.

Pass if: every `mkdtemp` in the file has a corresponding `rm` in a `finally` block within the same test, OR is wrapped in a helper that cleans up in `finally`.

Fail if: a `mkdtemp` has no cleanup, cleanup is outside `finally` (so it skips on throw), or cleanup uses non-recursive `rm`/`rmdir` that would fail on non-empty dirs.

