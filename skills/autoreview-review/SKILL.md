---
name: autoreview-review
description: Validate files against AutoReview rules by invoking the real LLM reviewer. Triggered before committing, when wrapping up feature work, or when the user asks "does this pass review?". Skip when no `.autoreview/` exists — use autoreview-setup instead.
---

# AutoReview Review

Invoke the validate script. Default scope is `uncommitted`.

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

Report verdicts to the user: `[pass]` / `[reject]` lines per rule. In thinking mode, reasons include file:line refs.

If the tool returns warnings about provider unreachability, mention the warning verbatim — do not attempt to bypass the soft-fail.
