---
name: autoreview-context
description: Use when the agent has a concrete file path (about to edit `src/api/users.ts`) and needs to discover which rules apply to THAT path. Returns `read:` pointers — not review verdicts. Free (no LLM call). Invoke BEFORE writing to or creating a file. If no path given, lists all rule ids. Useful when user asks 'show me the rules'.
---

# AutoReview Context

Before editing a file, run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>
```

Output is a Markdown list of matching rules with `read: <absolute-rule-path>` pointers. Read every pointer with the Read tool and internalize the convention before writing the target file. This is zero-cost; skip it only when no rules exist or the path is in an excluded directory.

If you need rules by free-text intent instead of by path, use `autoreview-guide` skill.

## List all rules
If the user wants to see everything defined, invoke with no path:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs`
Output lists every rule id + description. Use when user asks "what rules exist?" or "show me the rules".
