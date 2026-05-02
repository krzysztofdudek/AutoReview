---
name: review
description: Use when user asks "does this pass review?", "does this file pass our rules", wrapping up feature work before a commit, when a commit got blocked OR rejected by the pre-commit hook (any "[reject]", "commit rejected", "commit being rejected", "why is my commit being rejected", "why is my commit failing", "my commit is being blocked" phrasing), or when debugging a specific rule verdict. Runs the real LLM reviewer. Skip when no `.autoreview/` exists — use autoreview:setup.
---

# AutoReview Review

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 — only assumed binary.

## Context: the pre-commit hook runs this automatically

When user runs `git commit`, the hook at `.git/hooks/pre-commit` shells into this same validate script with `--scope staged --context precommit`. If user reports a `[reject]` line from their commit, the hook already ran — you don't need to re-run it, but you CAN get a detailed file:line reason by temporarily setting `tiers.<name>.mode: thinking` in `.autoreview/config.yaml` and re-running, then reverting the change.

`type: manual` rules are **always skipped** by the pre-commit hook and by default `autoreview:review` invocations. They only run when explicitly named via `--rule <id>`.

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
- `--rule <id>` — restrict to a specific rule (required for `type: manual` rules; also works to narrow `type: auto` rules).

To get file:line reasoning in a verdict, temporarily set `tiers.<name>.mode: thinking` in `.autoreview/config.yaml`, re-run, then revert.

## Explicit opt-in for manual rules

Rules with `type: manual` never run automatically. To invoke them:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs \
  --files src/api/foo.ts --rule corp/audit-log-on-handlers
```

Without `--rule`, `type: manual` rules are silently skipped regardless of whether triggers match.

## Debugging a blocked commit

If user says "my commit got rejected with `[reject] src/api/foo.ts :: api/validate-input`":

1. To get a file:line reason, temporarily set `tiers.<name>.mode: thinking` in `.autoreview/config.yaml` (where `<name>` is the tier the rule uses, e.g. `default`), then re-run:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs \
     --files src/api/foo.ts --rule api/validate-input
   ```
   Revert the mode change after retrieving the reason.
2. Show the reason verbatim.
3. Suggest: fix the code to satisfy the rule, OR (if the rule genuinely doesn't apply here) add an inline `@autoreview-ignore` marker — but only after user confirms the suppression.

## Reporting

Report verdicts to the user verbatim: `[pass]` / `[reject]` / `[warn]` / `[error]` / `[suppressed]` lines per `file :: rule` pair. Preserve the prefixes — pre-commit hooks and CI parse them. When `tiers.<name>.mode` is `thinking`, rejects include a `reason:` line with file:line refs; in quick mode, a `why:` hint tells the user to enable thinking mode in config.

- `[reject]` — rule violated, `severity: error` → blocks commit (exit 1).
- `[warn]` — rule violated, `severity: warning` → printed but exit 0.
- `[error]` — provider unreachable, tier misconfigured, or rule has invalid frontmatter → exit code depends on severity.

Default scope when no flags are passed: `--scope uncommitted --context validate`.

If a `severity: error` rule's tier provider is unreachable, the verdict is `[error]` and the commit is blocked (exit 1). To make a rule non-blocking on provider failure, set `severity: warning` in its frontmatter.
