---
name: "Skill body sections"
triggers: 'path:"skills/*/SKILL.md"'
description: "Use when writing a SKILL.md body; requires H1 matching skill name + at least one H2 structural section."
---
Every SKILL.md body begins with an H1 (`# AutoReview <TitleCase>`) directly after the frontmatter, then organizes content under H2s. Accepted H2 patterns: `## Steps` (setup/precheck), `## On-demand invocation` + `## Debugging ...` + `## Reporting` (review), `## The N steps` + `## Red flags — STOP` (wizards), `## When NOT to use` (skills easy to over-invoke).
Minimum: one H2 OR an inline code block with the primary script invocation. A body of only paragraphs (no structural anchors) makes the agent scan linearly and miss the exit conditions; multi-step skills lacking a `Red flags` or `When NOT to use` section reliably get invoked in the wrong context.

