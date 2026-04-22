---
description: Find rules by free-text intent
argument-hint: "<query text>"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/guide.mjs $ARGUMENTS`

Token-based search over rule name/description/body. Returns up to 5 ranked rules with their `read:` paths. Zero LLM cost.

Use when no file path is in hand yet: "how do I add audit logging?", "what's our policy on error handling?". For a known file path, use `/autoreview:context <path>` instead — it filters by trigger, not by text similarity.

If nothing relevant comes back, the tool suggests `/autoreview:create-rule` to author a new one.
