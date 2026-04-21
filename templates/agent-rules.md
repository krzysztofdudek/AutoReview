# AutoReview — Operating Manual

AutoReview is active in this repo. Follow these rules.

## Before editing any file
Before you write or edit `<path>`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>`. Read every rule the output points to. Then write code that satisfies them. This is free (no LLM call).

**Skip context only when:** the path is clearly outside all rule triggers (e.g. README.md, .gitignore), OR you just ran context for the same path in this session.

## Factual questions about existing code
If the user asks "what does line 42 do?" or "is this validated?", read the file and answer directly. No reviewer call. Don't run `validate` for questions you can answer by reading the code.

## When the user asks "will this pass review?"
- File already on disk: run `validate --files <path>`.
- File doesn't exist yet: list rules via `context <path>`, write code satisfying them, then validate.
- Hypothetical draft not yet on disk: use the `autoreview-precheck` skill (1 LLM call per rule, costs money for paid providers).
- Never fabricate a verdict from memory.

## Blocked commit — `[reject]` from the pre-commit hook
The hook at `.git/hooks/pre-commit` ran automatically and produced the reject line. Don't re-run the hook. Use the `autoreview-review` skill to re-check the same rule in thinking mode to get a file:line reason. Then offer to fix the code or (only with explicit user okay) add a suppression.

## Reviewing a past commit
If the user asks whether a specific commit passed, run `validate --sha <commit>`. Supports `HEAD`, `HEAD~1`, tags, branches, full SHAs.

## Validate vs. precommit
- **Pre-commit hook** (soft-fail by default) runs on `git commit`. Stops you only when `enforcement.precommit: hard`.
- **`/autoreview:validate`** (hard by default) is the explicit manual review.
Both use the same engine; only the exit-code policy differs.

## Never handle secrets
- Do NOT ask the user to paste an API key in this conversation.
- If the user pastes one anyway, refuse to use it and tell them to put it in `.autoreview/config.secrets.yaml` (gitignored) or an env var.
- Do NOT read `.autoreview/config.secrets.yaml`. Ask the user to open it themselves.

## Never add suppress markers without confirmation
`@autoreview-ignore <rule-id> <reason>` suppresses a rule. You may propose one, but the user must provide or approve the reason and explicitly okay the suppression before you write it. No bulk additions under time pressure. One marker at a time, each with reason.

## Creating a rule
Use the `autoreview-create-rule` skill or `/autoreview:create-rule`. All 7 steps, even if the user tells you to skip — the wizard guards rule quality.

## Skill index
- `autoreview-setup` — initialize .autoreview/ in a repo.
- `autoreview-context` — rules that apply to a given path (free, pre-write).
- `autoreview-review` — run the reviewer on existing files, debug a blocked commit.
- `autoreview-precheck` — verdict on a draft not yet on disk (1 LLM call per rule).
- `autoreview-guide` — find rules by free-text intent (free).
- `autoreview-create-rule` — author a new rule via 7-step wizard.
