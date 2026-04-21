---
name: autoreview-guide
description: Use when the user asks a free-text question about a convention and you don't have a file path yet ("how do I write a command handler here?"). Returns `read:` pointers to relevant rules. Knowledge retrieval, not review. Zero LLM call.
---

# AutoReview Guide

Invoke with the query text:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/guide.mjs '<free-text query>'
```

Output: top 5 matching rules with one-line "why relevant" plus `read:` paths. Read them, then answer the user's question citing the rule ids.

If output is "no relevant rules found", suggest the user author one via `/autoreview:create-rule`.
