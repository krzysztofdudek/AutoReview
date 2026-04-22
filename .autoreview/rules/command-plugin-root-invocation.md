---
name: "Command plugin-root invocation"
triggers: 'path:"commands/*.md" AND content:"Run:"'
description: "Use when authoring a slash command body; Run line must be `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/<name>.mjs $ARGUMENTS`."
---
Slash commands in `commands/*.md` must invoke backing scripts through the plugin-root env var, never a relative or absolute host path. The exact shape is `Run: \`node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/<name>.mjs $ARGUMENTS\``. The `$ARGUMENTS` token is required so user-supplied args flow through — drop it and the command silently ignores flags. Omit `${CLAUDE_PLUGIN_ROOT}` and the command only works in the dev repo, never when installed as a plugin.
Two exceptions: (a) wrapper commands that delegate to a skill and run no script (e.g. create-rule.md) omit the `Run:` line entirely; (b) commands that need pre-interview text may add prose BEFORE the `Run:` line but the run-line shape is fixed.

