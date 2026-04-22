---
description: Test a trigger expression without running the reviewer
argument-hint: "--expr '<expr>' | --rule <id>"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/check-breadth.mjs $ARGUMENTS`

Reports match count and first 10 sample paths. Zero LLM cost.

Use this to sanity-check a trigger before saving a rule — a trigger that matches 0 files is dead code; a trigger that matches 1000 files will 10× your review cost. Trigger DSL:

- `path:"src/api/**/*.ts"` — glob on path (brace expansion supported: `src/{api,handlers}/**`).
- `content:"@Controller"` — regex on file content.
- `dir:"src/api"` — shorthand for `path:"src/api/**"`.
- Combine with `AND` / `OR` / `NOT` and parens: `(path:"src/**" OR path:"lib/**") AND NOT content:"TODO"`.

Invoke via existing rule: `/autoreview:check-breadth --rule api/validate-input` — prints what that rule currently matches.
