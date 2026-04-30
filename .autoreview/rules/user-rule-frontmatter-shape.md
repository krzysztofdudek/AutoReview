---
name: "User rule frontmatter shape"
triggers: 'path:".autoreview/rules/**/*.md" OR path:"templates/example-rule.md"'
description: "Use when authoring a rule; frontmatter must have quoted name, single-quoted triggers, and quoted description before body."
---
Every rule file needs these fields in YAML frontmatter before the markdown body:
- `name: "<Title Case summary>"` — double-quoted, human-readable; shown in verdict output.
- `triggers: '<expr>'` — single-quoted so the YAML parser does not interpret `"` inside globs. Must be a valid path:/content:/AND/OR expression.
- `description: "<one sentence>"` — double-quoted, single line, used by autoreview:guide for free-text matching. Without it, the rule is invisible to intent-based lookup.
Body follows as free markdown. Missing `triggers` silently skips the rule on every file; missing `description` makes /autoreview:guide blind to it.

