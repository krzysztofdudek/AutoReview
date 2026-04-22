---
description: Query AutoReview review history (verdicts, aggregates)
argument-hint: "[--rule <id>] [--verdict pass|fail|error|suppressed] [--file <glob>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--format table|json|jsonl]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/history.mjs $ARGUMENTS`

**Without args:** prints total record count, verdicts grouped by type, by rule, and the 10 most recent records. Good for "what's been getting rejected lately?".

**Common filters:**
- `--rule api/validate-input` — only records for one rule.
- `--verdict fail` — only rejects.
- `--file 'src/api/**'` — glob filter on file paths.
- `--since 2026-04-01 --until 2026-04-22` — date range (YYYY-MM-DD).

**Formats:**
- `--format table` (default) — aggregates + top 10.
- `--format json` — JSON object with `{total, by_verdict, by_rule, records}`.
- `--format jsonl` — one record per line, raw. Pipe through `jq` for custom queries.

History lives at `.autoreview/.history/<YYYY-MM-DD>.jsonl`. Long `reason` fields spill to sidecar files referenced by `reason_sidecar` in the record.
