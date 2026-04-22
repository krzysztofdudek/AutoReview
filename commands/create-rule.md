---
description: Start the 7-step wizard to author a new rule
---

Use the `autoreview-create-rule` skill. Do not invoke the underlying script directly — the skill owns the multi-step flow (convention → trigger → breadth check → pass/fail samples → intent-trigger decision → test-drive → save).

**Shape of a saved rule:**
```md
---
name: "Short descriptive name"
triggers: 'path:"src/api/**/*.ts" AND content:"@Controller"'
---
Every controller must validate input with zod before processing.
Reject with HTTP 400 if validation fails.
```
Triggers run locally (zero LLM cost). The body is what the reviewer LLM checks against file content.

Edit existing rules by opening the file under `.autoreview/rules/<id>.md` in any editor. Delete to remove.
