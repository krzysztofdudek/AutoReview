---
name: "Skill description is trigger, not summary"
triggers: 'path:"skills/*/SKILL.md"'
description: "SKILL.md description must start with 'Use when', be third-person, describe triggers not workflow, and stay under 500 chars."
---
Every `skills/*/SKILL.md` file must have YAML frontmatter with `name` and `description`.

Description rules:
- Start with "Use when" (describes triggering conditions, not the workflow).
- Third person only ("agent does X", not "I do X" or "you do X").
- Describes WHEN the skill triggers — concrete user phrasings, symptoms, contexts.
- Does NOT summarize the skill's internal workflow or steps. A description like "runs a 7-step wizard that does X then Y then Z" is wrong — that belongs in the body.
- Maximum 500 characters.
- Includes at least one exclusion condition ("Skip when...", "Not for...") or counter-trigger when relevant — prevents the skill from being invoked in wrong contexts.

Pass: description starts "Use when", is third-person, describes triggers not workflow, ≤500 chars.

Fail: missing description, workflow summary instead of trigger list, first/second person, over 500 chars, or missing the "Use when" prefix.

