---
name: "SessionStart hook shape"
triggers: 'path:"hooks/hooks.json"'
description: "Use when editing hooks.json; SessionStart entries must have matcher:startup, a nested hooks[] array of {type:command, command:bash wrapper invoking ${CLAUDE_PLUGIN_ROOT}}."
---
The file is a JSON manifest registering Claude Code hooks. Claude Code ≥2.x requires each `SessionStart` entry to be a **matcher object** that wraps a nested `hooks` array — the older flat form (`matcher` + `type` + `command` siblings) is rejected with `Hook load failed: expected array, received undefined` at path `hooks.SessionStart.<i>.hooks`.

For every element of `hooks.SessionStart`, verify:

1. `"matcher": "startup"` — must be exactly the string `"startup"`. `"*"` is wrong. Missing matcher field is wrong.
2. `"hooks"` — must be a JSON **array** (not an object, not absent). Each element of the array describes one command to run.
3. For every element of that nested `hooks` array:
   - `"type": "command"` — must be exactly the string `"command"`.
   - `"command"` — must be a JSON string whose **value** starts with `bash "$` (i.e. `bash "${CLAUDE_PLUGIN_ROOT}/...` after JSON decoding). Direct `node ...` invocations are forbidden. Anything not starting with `bash "$` is forbidden.

All conditions must hold. When they do, the rule is satisfied — there is nothing else to check in this JSON file.

Passing example:
```json
{
  "matcher": "startup",
  "hooks": [
    {
      "type": "command",
      "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\""
    }
  ]
}
```
