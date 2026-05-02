---
name: "Example — Audit log on state-mutating handlers"
triggers: '(dir:"src/api" OR dir:"src/handlers") AND content:"export\\s+(async\\s+)?function"'
tier: heavy
severity: error
description: "Every handler that mutates persistent state must emit an audit-log entry before returning."
---
Check every exported function in `src/api/` or `src/handlers/` that mutates persistent state (writes to a database, calls an external service that changes state, enqueues a job). Mutating handlers must emit an audit-log entry BEFORE returning.

An audit-log entry is any call to `audit.log(...)`, `logger.audit(...)`, or a function named `emitAudit*()`. The entry must be reachable on every successful return path — guarded `if/else` branches that each return without logging are a violation. Logging inside a `catch` or after `throw` doesn't count; the audit call must precede the success return.

Pure reads (SELECT queries, cache lookups, HTTP GETs to idempotent endpoints) are exempt — this rule only targets state-mutating handlers.

Pass examples:
- Handler performs `db.update(...)` then `audit.log({ action: 'update', subject })` then `return result`.
- Handler delegates to a helper that already emits the audit call, and the helper's name is in the file (shared pattern).

Fail examples:
- Handler calls `db.update(...)` and returns without any audit-log call.
- Handler has two return paths, one of which skips the audit call.
- Handler logs via `logger.info(...)` — info-level logs are not audit logs.

Suppress with `// @autoreview-ignore audit-log-on-handlers <why this handler is exempt>` above the function for read-only handlers misdetected as mutating.
