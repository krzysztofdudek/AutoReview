---
description: Review files against AutoReview rules
argument-hint: "[--scope staged|uncommitted|all] [--sha <sha>] [--rule <id>]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs $ARGUMENTS`

Default scope when no args: `--scope uncommitted --context validate` (thinking mode).

Report verdicts verbatim to the user. Preserve `[pass]`/`[reject]`/`[error]` prefixes so they can be parsed.
