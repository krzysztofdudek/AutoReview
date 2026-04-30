---
name: context
description: Use when the agent has a concrete file path (about to edit `src/api/users.ts`) and needs the rules that apply to THAT path. Also use with no path to list all rule ids — triggers "what rules does this project have", "list all rules", "which rules exist", "show me the rules". Other triggers: "before I edit X, what rules apply?", a path reference without a review request. Skip when the agent wants an actual verdict (use autoreview:review); skip when no path yet and the user asks an abstract convention question (use autoreview:guide); skip when no `.autoreview/` exists — use autoreview:setup first.
---

# AutoReview Context

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 — only assumed binary.

Pre-write use: invoke BEFORE editing a file the first time in a session. Zero LLM cost.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>
```

Output is a Markdown list of matching rules with `read: <absolute-rule-path>` pointers per rule. Open every pointer with the Read tool and internalize the convention before writing — the rule body is the source of truth for the agent's behavior, not the trigger (the trigger only decides applicability).

Skip only when no rules exist in the repo or the path is in an excluded directory.

If you need rules by free-text intent instead of by path, use `autoreview:guide` skill (text similarity search) — it filters by relevance, not by trigger.

## List all rules

If the user wants to see everything defined ("what rules exist?", "show me the rules", "what rules does this project have?"), invoke with no path:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs
```

Output lists every rule id + its description.
