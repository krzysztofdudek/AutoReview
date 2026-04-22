---
name: "SessionStart hook shape"
triggers: 'path:"hooks/hooks.json"'
description: "Use when editing hooks.json; SessionStart entries must have matcher:startup + type:command + bash wrapper invoking ${CLAUDE_PLUGIN_ROOT}."
---
The file is a JSON manifest registering Claude Code hooks. For every `SessionStart` entry, verify three required fields on the entry object:

1. `"matcher": "startup"` — must be exactly the string `"startup"`. `"*"` is wrong. Missing matcher field is wrong.
2. `"type": "command"` — must be exactly the string `"command"`.
3. `"command"` — must be a JSON string whose **value** starts with `bash "$` (i.e. `bash "${CLAUDE_PLUGIN_ROOT}/...` after JSON decoding). Direct `node ...` invocations are forbidden. Anything not starting with `bash "$` is forbidden.

All three conditions must hold for the entry to pass. When all three hold, the rule is satisfied — there is nothing else to check in this JSON file.

Passing example:
```json
{
  "matcher": "startup",
  "type": "command",
  "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\""
}
```
