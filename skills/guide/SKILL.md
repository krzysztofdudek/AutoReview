---
name: guide
description: Use when the user asks a free-text question about a convention without a concrete file path ("how do I write a command handler here?", "what's the logging policy?"). The agent needs knowledge retrieval, not a review verdict. Skip when a file path is already known (use autoreview:context); skip when the user actually wants a pass/fail verdict on existing code (use autoreview:review); skip when no `.autoreview/` exists — use autoreview:setup first.
---

# AutoReview Guide

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 — only assumed binary.

Token-based search over rule name / description / body. Returns up to 5 ranked rules with their `read:` paths. Zero LLM cost.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/guide.mjs '<free-text query>'
```

Output: top 5 matching rules with a one-line "why relevant" plus `read:` paths. Read them, then answer the user's question citing the rule ids.

Rules are listed using **effective** frontmatter (post-overlay) — remote rule overrides from `remote_rules[].overrides` are already merged in. What you see is what the reviewer enforces.

For a known file path, use `autoreview:context` instead — it filters by trigger (more precise than text similarity).

If output is "no relevant rules found", invoke `autoreview:create-rule` to author one.
