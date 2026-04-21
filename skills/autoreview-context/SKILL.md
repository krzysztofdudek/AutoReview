---
name: autoreview-context
description: Use when the agent has a concrete file path (about to edit `src/api/users.ts`) and needs to discover which rules apply to THAT path. Returns `read:` pointers — not review verdicts. Free (no LLM call). Invoke BEFORE writing to or creating a file.
---

# AutoReview Context

Before editing a file, run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>
```

Output is a Markdown list of matching rules with `read: <absolute-rule-path>` pointers. Read every pointer with the Read tool and internalize the convention before writing the target file. This is zero-cost; skip it only when no rules exist or the path is in an excluded directory.

If you need rules by free-text intent instead of by path, use `autoreview-guide` skill.
