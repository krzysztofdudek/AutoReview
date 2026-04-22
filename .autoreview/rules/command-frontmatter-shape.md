---
name: "Command frontmatter shape"
triggers: 'path:"commands/*.md"'
description: "Use when editing a slash command; frontmatter needs description (imperative, no trailing period) and argument-hint (quoted) unless skill-delegating."
---
Every commands/*.md needs YAML frontmatter with:
- `description:` — imperative mood ("Review files against AutoReview rules", not "Reviews..." or "This command..."). No trailing period. Under ~60 chars so it renders in the `/` picker.
- `argument-hint:` — double-quoted string showing the flag grammar. Use `<required>`, `[--optional]`, `|` for alternatives. Required whenever the script accepts args.
Commands that delegate wholly to a skill (no `$ARGUMENTS` in body) may omit `argument-hint`. Every other command must have it — otherwise the picker gives the user no hint of the grammar and they guess wrong.

