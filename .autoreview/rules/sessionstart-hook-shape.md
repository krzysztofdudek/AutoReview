---
name: "SessionStart hook shape"
triggers: 'path:"hooks/hooks.json"'
description: "Use when editing hooks.json; SessionStart entries must have matcher:startup + type:command + bash wrapper invoking ${CLAUDE_PLUGIN_ROOT}."
---
The `SessionStart` hook entry must carry `"matcher": "startup"` (not `"*"`, not omitted — the harness filters by matcher and omitting it fires on every sub-session resume). `"type": "command"` is the only supported shape. The `command` field must shell through bash with the plugin-root env var quoted: `"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\""`. Direct `node` invocations from hooks.json lose stderr plumbing on some platforms and break when the plugin path contains spaces; the bash wrapper also gives the script a place to `set -e` + `exec` so it never holds a shell child open.

