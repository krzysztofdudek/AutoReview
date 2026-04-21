# AutoReview — Operating Manual

AutoReview is active in this repo. Follow these rules.

## Before editing any file
Before you write or edit `<path>`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>`. Read every rule the output points to. Then write code that satisfies them. This is free (no LLM call).

## When the user asks "will this pass review?"
- If the file is already written, run `validate --files <path>`.
- If the file doesn't exist yet, list applicable rules via `context <path>`, write code satisfying them, then validate.
- Never fabricate a verdict from memory.

## Reviewing a past commit
If the user asks whether a specific commit passed, run `validate --sha <commit>`. Supports `HEAD`, `HEAD~1`, tags, branches, full SHAs.

## Validate vs. precommit
- **Pre-commit hook** (soft-fail by default) runs on `git commit` — stops you only when `enforcement.precommit: hard`.
- **`/autoreview:validate`** (hard by default) is the explicit manual review.
Both use the same engine; only the exit-code policy differs.

## Never handle secrets
- Do NOT ask the user to paste an API key in this conversation.
- Do NOT read `.autoreview/config.secrets.yaml`.
- If setup needs a key, tell the user to fill in the placeholder file out-of-band.

## Never add suppress markers without confirmation
`@autoreview-ignore <rule-id> <reason>` suppresses a rule. You may propose one, but the user must provide (or approve) the reason and explicitly okay the suppression before you write it.

## Creating a rule
Use the `autoreview-create-rule` skill or `/autoreview:create-rule`. Follow all 7 steps — skipping steps produces bad rules.

## Skill index
- `autoreview-setup` — initialize .autoreview/ in a repo.
- `autoreview-context` — rules that apply to a given path (pre-write).
- `autoreview-review` — run the reviewer on files.
- `autoreview-guide` — find rules by free-text intent.
- `autoreview-create-rule` — author a new rule.
