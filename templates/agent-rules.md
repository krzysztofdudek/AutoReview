# AutoReview — Operating Manual

AutoReview is active in this repo. Follow these rules.

## Before editing any file
Before you write or edit `<path>`, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/context.mjs <path>`. Read every rule the output points to. Then write code that satisfies them. This is free (no LLM call).

**Skip context only when:** the path is clearly outside all rule triggers (e.g. README.md, .gitignore), OR you just ran context for the same path in this session.

## Factual questions about existing code
If the user asks "what does line 42 do?" or "is this validated?", read the file and answer directly. No reviewer call. Don't run `validate` for questions you can answer by reading the code.

## When the user asks "will this pass review?"
- File already on disk: invoke the `autoreview:review` skill with `--files <path>`.
- File doesn't exist yet: invoke `autoreview:context <path>` to list rules, write code satisfying them, then run `autoreview:review`.
- Hypothetical draft not yet on disk: use the `autoreview:precheck` skill (1 LLM call per rule, costs money for paid providers).
- Never fabricate a verdict from memory.

## Blocked commit — `[reject]` from the pre-commit hook
The hook at `.git/hooks/pre-commit` ran automatically. Don't re-run it. Use `autoreview:review` to re-check the rule. For a file:line reason: set `tiers.<name>.mode: thinking` in `.autoreview/config.yaml`, re-run, revert. Offer to fix the code or (only with explicit user okay) add a suppression.

## Reviewing a past commit
For "did this commit pass?" — **prefer the `autoreview:history` skill with `--sha <commit>`** first. That reads `.autoreview/.history/*.jsonl` for what the reviewer already decided when the commit was reviewed. Free, no LLM calls.

Only invoke `autoreview:review` with `--sha <commit>` when the user wants a fresh re-review (rules changed, history missing, debugging a verdict).

## Tiers — which model handles each rule
Rules declare `tier:` in frontmatter (omit = `default`). `.autoreview/config.yaml` maps tier names to concrete provider+model combos under `tiers:`. Only `default` is mandatory.

- **trivial** — regex-grade checks; fastest/cheapest model.
- **standard** — file-local logical reasoning; mid-tier model.
- **heavy** — multi-step semantic reasoning; capable/slow model.
- **critical** — top-importance rules; most capable model, may use consensus.
- **default** — fallback for rules without a tier.

## Severity
Rules declare `severity: error|warning` (default `error`). `warning` rules produce `[warn]` verdicts that are printed but do not block the commit. `error` rules produce `[reject]` verdicts that block it.

## Rule types
Rules declare `type: auto|manual` (default `auto`). `manual` rules are skipped in automatic pre-commit runs; invoke them explicitly via `--rule <id>`. Use `type: manual` for expensive or situational rules.

## Remote rules and overlays
Remote rule packs live under `remote_rules:` in config. Adapt upstream rules without forking by adding overlays under `remote_rules[].overrides.<rule-id>`. Overlays can change `name`, `triggers`, `tier`, `severity`, `type`, or `description` — never the body. Use `autoreview:pull-remote` to fetch/refresh remote caches. Use `autoreview:override-rule` to create overlays interactively.

## Never handle secrets
- Do NOT ask the user to paste an API key in this conversation.
- If the user pastes one anyway, refuse to use it and tell them to put it in `.autoreview/config.secrets.yaml` (gitignored) or an env var.
- Do NOT read `.autoreview/config.secrets.yaml`. Ask the user to open it themselves.

## Never add suppress markers without confirmation
`@autoreview-ignore <rule-id> <reason>` suppresses a rule. You may propose one, but the user must provide or approve the reason and explicitly okay the suppression before you write it. No bulk additions under time pressure. One marker at a time, each with reason.

## Creating a rule
Use the `autoreview:create-rule` skill. All wizard steps, even if the user tells you to skip — the wizard guards rule quality.

## Skill index
- `autoreview:setup` — initialize `.autoreview/` in a repo.
- `autoreview:context` — rules that apply to a given path (free, pre-write).
- `autoreview:guide` — find rules by free-text intent (free).
- `autoreview:create-rule` — author a new rule via wizard.
- `autoreview:precheck` — verdict on a draft not yet on disk (1 LLM call per rule).
- `autoreview:review` — run the reviewer on existing files, debug a blocked commit.
- `autoreview:history` — query the verdict log (verdict counts, recent records, free).
- `autoreview:pull-remote` — fetch / refresh remote rule sources.
- `autoreview:override-rule` — wizard for creating per-rule overlays on remote rules.
