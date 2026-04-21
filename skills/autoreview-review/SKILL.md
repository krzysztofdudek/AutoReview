---
name: autoreview-review
description: Use when user asks "does this pass review?", when wrapping up feature work before a commit, when a commit got blocked by the pre-commit hook with a [reject] line and user wants to understand why, or when debugging a specific rule verdict. Runs the real LLM reviewer. Skip when no `.autoreview/` exists — use autoreview-setup.
---

# AutoReview Review

## Context: the pre-commit hook runs this automatically

When user runs `git commit`, the hook at `.git/hooks/pre-commit` shells into this same validate script with `--scope staged --context precommit`. If user reports a `[reject]` line from their commit, the hook already ran — you don't need to re-run it, but you CAN re-run with `--mode thinking --rule <id>` to get a detailed reason.

## On-demand invocation

Default scope is `uncommitted`:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs --scope uncommitted
```

Scope options:
- `--scope staged` — only staged changes.
- `--scope uncommitted` — staged + unstaged (default for manual review).
- `--scope all` — sweep entire repo (walk-capped at 10,000 files).
- `--sha <commit>` — post-factum review of a specific commit.
- `--files <path> [--files <path>]` — explicit file list.
- `--rule <id>` — restrict to specific rule(s).
- `--mode thinking` — force reasoning output with file:line refs.

## Debugging a blocked commit

If user says "my commit got rejected with `[reject] src/api/foo.ts :: api/validate-input`":

1. Re-run the same rule in thinking mode to get a file:line reason:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs \
     --files src/api/foo.ts --rule api/validate-input --mode thinking
   ```
2. Show the reason verbatim.
3. Suggest: fix the code to satisfy the rule, OR (if the rule genuinely doesn't apply here) add an inline `@autoreview-ignore` marker — but only after user confirms the suppression.

## Reporting

Report verdicts to the user: `[pass]` / `[reject]` / `[error]` lines per rule. In thinking mode, reasons include file:line refs.

If the tool returns warnings about provider unreachability, mention the warning verbatim — do not attempt to bypass the soft-fail.
