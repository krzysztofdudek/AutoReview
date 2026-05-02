---
name: history
description: Use when the user asks about review verdicts over time — "what's been getting rejected", "rejection rate this week", "show recent reviews", "history of verdicts", "which rule fails most often", "show suppressed reviews", or filtering reviews by rule / file / date / verdict / tier / severity. Zero LLM cost — pure read of stored review records. Skip when the user wants a FRESH verdict (use autoreview:review) or when no `.autoreview/` exists (use autoreview:setup first).
---

# AutoReview History

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 — only assumed binary.

Query the verdict log written by every `validate` run. Zero LLM cost — purely a read of stored records.

## Default — no args

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/history.mjs
```

Prints total record count, verdicts grouped by type, by rule, and the 10 most recent records. Good first invocation when the user says "what's been getting rejected lately?".

## Common filters

- `--rule <id>` — only records for one rule (e.g. `--rule api/validate-input`).
- `--verdict pass|fail|error|suppressed` — narrow to a single outcome.
- `--file '<glob>'` — glob filter on file paths (e.g. `--file 'src/api/**'`).
- `--since YYYY-MM-DD --until YYYY-MM-DD` — date range. Either end is optional.
- `--tier <name>` — filter to records where the rule ran on a specific tier (e.g. `--tier critical`). Useful for auditing what the heavy reviewer is catching.
- `--severity <error|warning>` — filter to records where the rule's severity matches. Useful for `--severity warning` to review non-blocking findings separately.

Combine freely: `--rule auth/no-direct-db --verdict fail --since 2026-04-01 --tier critical`.

## Output formats

- `--format table` (default) — aggregates + the 10 most recent.
- `--format json` — single JSON object: `{ total, by_verdict, by_rule, records }`. Good for "give me the totals as JSON".
- `--format jsonl` — one record per line, raw. Pipe through `jq` (POSIX) / parse with `node -e "for await (const line of process.stdin) ..."` (cross-platform) for custom queries.

## Record fields

Each record includes: `rule`, `verdict`, `reason`, `provider`, `model`, `mode`, `duration_ms`, `usage`, `actor`, `host`, `commit_sha`, plus two fields added in the tier redesign:
- `tier` — the tier that handled the rule (effective post-overlay).
- `severity` — the rule's severity at run time (effective post-overlay).

## Storage layout

History lives at `.autoreview/.history/<YYYY-MM-DD>.jsonl` (one file per day). Long `reason` fields spill to sidecar files referenced by `reason_sidecar` in the record — read those with the Read tool when the inline reason is truncated.

## Reporting

Quote the table or relevant records back to the user. For "rejection rate" questions, compute from `by_verdict` totals. For "which rule fails most" questions, sort `by_rule` by `fail` count.
