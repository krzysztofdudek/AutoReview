---
description: Query AutoReview review history (verdicts, aggregates)
argument-hint: "[--rule <id>] [--verdict pass|fail|error|suppressed] [--file <glob>] [--since YYYY-MM-DD]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/history.mjs $ARGUMENTS`

Without args: prints verdict counts and the 10 most recent records.
