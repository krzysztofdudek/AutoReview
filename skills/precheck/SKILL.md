---
name: precheck
description: Use when user has drafted file content that is NOT on disk yet and wants a reviewer verdict before writing — explicit phrases like "would this pass review?", "check before I save", "will this be accepted?" with content not yet persisted. Costs 1 LLM call per rule. If the user references an existing file ("does this file pass", "check src/foo.ts") use autoreview:review instead — precheck requires unsaved draft content (pasted, or pointed at via `--content-file`). For plain "I'm about to edit file X", use autoreview:context (free) — don't precheck every edit. Skip when no `.autoreview/` exists — use autoreview:setup first.
---

# AutoReview Pre-check

Use only when user has a draft in hand and wants a verdict BEFORE writing to disk. For "list rules that apply to this path", use `autoreview:context` instead — it's free.

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Translate to your shell on PowerShell (`$env:CLAUDE_PLUGIN_ROOT`) or cmd (`%CLAUDE_PLUGIN_ROOT%`). The plugin requires Node ≥22 — that's the only assumed binary.

## When NOT to use

- User said "edit this file". Just run `autoreview:context` to see rules, then write. Precheck is overkill for routine edits.
- User is about to commit an already-written file. Use `autoreview:review` instead.
- User already has the content on disk. Use `autoreview:review --files <path>`.

## Steps

1. **Save the draft to a temp file.** Resolve the platform tmp dir cross-platform:
   ```
   node -e "console.log(require('os').tmpdir())"
   ```
   Then write the draft into that dir under a unique name (e.g. `<tmpdir>/ar-draft-<timestamp>.ts`). Any writable path is fine — `/tmp/...` on POSIX, `%TEMP%\...` on Windows; the Node call returns the right one for whichever you're on.

2. **Pick a rule** that you suspect is the strictest/most relevant for the target path. Use `autoreview:context` first to list applicable rules.

3. **Run the reviewer test:**
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/reviewer-test.mjs \
     --rule <rule-id> --file <target-path> --content-file <tmpdir>/ar-draft-<timestamp>.ts \
     --mode thinking
   ```
   Where `<target-path>` is the logical destination (e.g. `src/api/users.ts`) and `--content-file` is where the draft actually lives.

4. **Parse the `=== RESULT ===` JSON.** If `satisfied: false`, revise the draft and re-run. If `satisfied: true`, commit the write to `<target-path>`.

For multiple rules, run once per rule. Each call is ~1 LLM invocation.
