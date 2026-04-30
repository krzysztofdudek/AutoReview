---
name: "Bin shape: run(argv, ctx) + try/catch + isMainModule guard"
triggers: 'path:"scripts/bin/*.mjs"'
description: "Bin scripts must export run(argv, ctx), wrap in try/catch returning 2 on throw, and use the cross-platform isMainModule(import.meta.url) invocation guard."
---
Every file under `scripts/bin/` must export `async function run(argv, ctx)` where:
- `argv` is an array of string args (the slice after the bin name)
- `ctx` destructures `{ cwd, env, stdout, stderr }`
- `run` returns a `Promise<number>` (exit code: 0 = pass, 1 = hard fail, 2 = internal error)

The `run` function must be wrapped in an outer `try/catch`:
- On caught throw: write `[error] internal: <stack>` to `ctx.stderr`, return `2`
- Exception: `session-start.mjs` must return `0` even on error (hook must never block the session).

The file must also have an invocation guard at the bottom that uses `isMainModule(import.meta.url)` from `../lib/fs-utils.mjs`:

```
import { isMainModule } from '../lib/fs-utils.mjs';
// …
if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env,
                                stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
```

The legacy form `import.meta.url === \`file://${process.argv[1]}\`` is forbidden — it silently no-ops on Windows because Node yields `file:///C:/...` (forward-slashes, three slashes) while the constructed string uses backslashes and two slashes. `isMainModule` normalises via `pathToFileURL(argv[1]).href` so the guard fires on every platform.

Pass if: `run` exported with the signature above, outer try/catch with exit-2 behaviour, invocation guard present and using `isMainModule`.

Fail if: missing `run` export, different signature, no outer try/catch, invocation guard absent, invocation guard uses the legacy `import.meta.url === \`file://${process.argv[1]}\`` form, or `run` uses `process.env` / `process.cwd()` / `process.stdout` / `process.stderr` directly instead of the `ctx` parameter.

