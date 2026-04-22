---
name: "Provider interface uniform"
triggers: 'path:"scripts/lib/providers/*.mjs"'
description: "Providers must expose create(opts) returning {name, model, isAvailable, verify, contextWindowBytes} that never throw; verify returns providerError on failure and accepts reasoningEffort."
---
Every provider file under `scripts/lib/providers/` must export `function create(opts)` that returns an object with exactly this shape:

```
{
  name: string,
  model: string,
  async isAvailable(): Promise<boolean>,
  async verify(prompt: string, opts: { maxTokens, reasoningEffort? }): Promise<VerifyResult>,
  async contextWindowBytes(): Promise<number>
}
```

`VerifyResult` is `{ satisfied: boolean, reason?: string, suppressed?: Array<{line, reason}>, providerError?: boolean, raw?: string }`.

Hard rules:
- `verify` must NEVER throw. Any transport/parse error becomes `{ satisfied: false, providerError: true, raw: <message> }`. Errors propagated via return value, not exceptions.
- `verify` must accept `reasoningEffort` in opts. If the underlying model does not support it, the param is accepted and silently ignored (documented with a comment). Never throw on unsupported effort.
- `isAvailable` must NEVER throw. Return `false` on any error.
- `contextWindowBytes` must NEVER throw. Return a sane default (e.g. 32768 or model-appropriate) on error.
- The returned object must include `name` and `model` as plain string properties readable by callers (used in cache keys and report output).

Pass: all three async methods exist, signature matches, no throws escape, reasoningEffort accepted.

Fail: missing method, throw escapes any method, missing name/model property, reasoningEffort rejected instead of accepted-and-ignored.

