---
description: Review files against AutoReview rules
argument-hint: "[--scope staged|uncommitted|all] [--sha <sha>] [--rule <id>] [--files <path>] [--mode quick|thinking]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/validate.mjs $ARGUMENTS`

Default scope when no args: `--scope uncommitted --mode thinking --context validate`. Hard enforcement — exit 1 on any reject.

**Common invocations:**
- `/autoreview:validate` — review uncommitted files (staged + modified + untracked).
- `/autoreview:validate --scope all` — sweep the entire repo (walk-capped at `walk_file_cap`).
- `/autoreview:validate --sha HEAD~1` — post-factum review of a past commit.
- `/autoreview:validate --files src/api/foo.ts --rule api/validate-input --mode thinking` — debug one file against one rule with file:line reasoning.

**Output shape:** one line per `file :: rule` pair, prefixed with `[pass]` / `[reject]` / `[error]` / `[suppressed]`. Under thinking mode, rejects include a `reason:` line; under quick mode, a `why:` hint tells the user how to re-run for the reason.

Report verdicts verbatim. Preserve the prefixes so CI/hooks can parse.
