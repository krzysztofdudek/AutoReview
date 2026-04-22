---
description: List rules matching a file path (or all rules if no path given)
argument-hint: "[<path>]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs $ARGUMENTS`

- **With a path** (`/autoreview:context src/api/users.ts`) — lists rules whose trigger matches that path. Zero LLM cost.
- **Without a path** (`/autoreview:context`) — lists every rule id in the repo with its description. Use for "what rules does this project have?".

Output carries `read: <absolute-rule-path>` pointers per matched rule. Follow each with the Read tool before writing to the file — the rule body is the source of truth for the agent's behavior.

Pre-write use: invoke BEFORE editing a file the first time in a session. This is free.
