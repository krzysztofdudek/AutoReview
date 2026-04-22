---
name: "Test fixture shape: {dir, cleanup}"
triggers: 'path:"tests/**/*.test.mjs" AND content:"mkdtemp"'
description: "Use when a test authors a fixture helper (makeRepo, mkRepo, fixtureRepo); must return {dir, cleanup}."
---
Every fixture helper in the suite returns `{ dir, cleanup }` (and optionally `run` for git). Callers uniformly destructure and wrap the body in `try { ... } finally { await cleanup(); }`.
A helper that returns only a dir string forces each caller to re-implement `rm(dir, { recursive: true, force: true })`, and one that returns `{ path, teardown }` breaks the destructuring pattern.
If git is needed, also include a bound `run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })` per `tests/lib/git-helpers.mjs`. Helpers that create a git repo MUST also set `user.email` + `user.name` (git refuses to commit without them on fresh CI boxes).

