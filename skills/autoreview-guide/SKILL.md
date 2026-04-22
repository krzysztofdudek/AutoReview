---
name: autoreview-guide
description: Use when the user asks a free-text question about a convention without a concrete file path ("how do I write a command handler here?", "what's the logging policy?"). The agent needs knowledge retrieval, not a review verdict. Skip when a file path is already known (use autoreview-context); skip when the user actually wants a pass/fail verdict on existing code (use autoreview-review); skip when no `.autoreview/` exists — use autoreview-setup first.
---

# AutoReview Guide

Invoke with the query text:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/guide.mjs '<free-text query>'
```

Output: top 5 matching rules with one-line "why relevant" plus `read:` paths. Read them, then answer the user's question citing the rule ids.

If output is "no relevant rules found", suggest the user author one via `/autoreview:create-rule`.
