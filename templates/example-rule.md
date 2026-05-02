---
name: "Example — No TODO without ticket ID"
triggers: 'path:"**/*.{ts,js,py,go}" AND content:"TODO"'
tier: trivial
severity: warning
description: "TODO comments should reference a ticket id so follow-up is traceable"
---
Every `TODO` comment must reference a ticket id, e.g. `TODO(PROJ-123):`.

Reject if the comment is a bare `TODO` or `TODO:` without a parenthesized identifier.

Accept if the ticket id format matches any of: `TODO(letters-digits):`, `TODO(#digits):`, `TODO(JIRA-digits):`, or if the comment is suppressed via `@autoreview-ignore example <reason>`.
