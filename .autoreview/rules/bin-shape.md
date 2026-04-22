---
name: "Bin shape: run(argv, ctx) + try/catch + guard"
triggers: 'path:"scripts/bin/*.mjs"'
description: "Bin scripts must export run(argv, ctx), wrap in try/catch returning 2 on throw, and have an import.meta.url invocation guard."
---
Every file under `scripts/bin/` must export `async function run(argv, ctx)` where:
- `argv` is an array of string args (the slice after the bin name)
- `ctx` destructures `{ cwd, env, stdout, stderr }`
- `run` returns a `Promise<number>` (exit code: 0 = pass, 1 = hard fail, 2 = internal error)

The `run` function must be wrapped in an outer `try/catch`:
- On caught throw: write `[error] internal: <stack>` to `ctx.stderr`, return `2`
- Exception: `session-start.mjs` must return `0` even on error (hook must never block the session).

The file must also have an invocation guard at the bottom:
```
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), { cwd: process.cwd(), env: process.env,
                                stdout: process.stdout, stderr: process.stderr })
    .then(c => process.exit(c ?? 0));
}
```

Pass if: `run` exported with signature, outer try/catch + exit-2 behavior, invocation guard present.

Fail if: missing `run` export, different signature, no outer try/catch, invocation guard absent, or uses `process.env` directly inside `run` instead of `ctx.env`.

