---
name: autoreview-context
description: Use when the agent has a concrete file path (about to edit `src/api/users.ts`) and needs the rules that apply to THAT path. Also use with no path to list all rule ids — triggers "what rules does this project have", "list all rules", "which rules exist", "show me the rules". Other triggers: "before I edit X, what rules apply?", a path reference without a review request. Skip when the agent wants an actual verdict (use autoreview-review); skip when no path yet and the user asks an abstract convention question (use autoreview-guide); skip when no `.autoreview/` exists — use autoreview-setup first.
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
