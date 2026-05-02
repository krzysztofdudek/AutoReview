# CLAUDE.md

Notes for agents working on **this repo** (the AutoReview plugin itself — not a repo that has AutoReview installed).

## What this project is

AutoReview is a Claude Code plugin that enforces per-file architecture rules via markdown files + an LLM reviewer, hooked into `git commit`. It ships as:

- A Claude Code plugin (`.claude-plugin/plugin.json`, `hooks/`, `skills/`). The plugin is **agent-first** — there are no `commands/`. Every entry point is a skill with a rich `description: Use when…` so the agent picks it from user intent.
- A zero-dep Node ≥22 CLI under `scripts/bin/` + library under `scripts/lib/`.
- Templates (`templates/`) copied into user repos by the `autoreview:setup` skill (which runs `init.mjs` underneath).

Target user installs the plugin, asks the agent to set AutoReview up (or types `/autoreview:setup`), and gets a pre-commit hook that validates staged files against rules in `.autoreview/rules/`.

## Critical architectural detail: the "runtime" copy

The `autoreview:setup` skill (via `init.mjs`) copies `scripts/lib/` + `scripts/bin/validate.mjs` into `<userrepo>/.autoreview/runtime/`. **This is deliberate** — the pre-commit hook runs outside Claude Code (plain `git commit`, CI runners) with no `CLAUDE_PLUGIN_ROOT` to locate the plugin. The bundled runtime makes repos self-contained and reproducible across machines.

Version handshake: `.autoreview/runtime/.version` holds the plugin version that last copied the runtime. SessionStart hook (`scripts/bin/session-start.mjs` → `scripts/lib/runtime-sync.mjs`) compares it against the installed plugin manifest and re-copies on mismatch. Don't bypass this — changes to `scripts/lib/` or `scripts/bin/validate.mjs` only reach end users through `syncRuntime`.

## Layout

- `scripts/bin/*.mjs` — CLI entrypoints. Each exports `run(argv, ctx)` and ends with `if (isMainModule(import.meta.url))` to also run directly. `autoreview.mjs` is the unified dispatcher.
- `scripts/lib/*.mjs` — pure modules, zero deps, reused by CLIs and tests.
- `scripts/lib/providers/*.mjs` — LLM provider adapters (Ollama, Anthropic, OpenAI, Google, OpenAI-compat, Claude Code, Codex, Gemini CLI). Each implements `{ name, model, verify(prompt, opts), isAvailable(), contextWindowBytes() }`.
- `hooks/session-start.sh` → `scripts/bin/session-start.mjs` — runs on Claude Code SessionStart.
- `skills/<name>/SKILL.md` — agent-facing skill definitions (9 skills: setup, create-rule, context, guide, precheck, review, history, pull-remote, override-rule). No `commands/` — skills are the only Claude Code surface.
- `templates/` — files copied into user repos.
- `tests/lib/`, `tests/bin/`, `tests/e2e/`, `tests/api/`, `tests/plugin/` — node:test, no frameworks.

## Commands

```
npm test              # unit (lib + bin + plugin + api), fast, no LLM
npm run test:e2e      # e2e — forks real CLIs against an OpenAI-compat server
npm run test:ollama   # one round-trip against a real local Ollama daemon
npm run test:all      # unit + e2e, single command
npm run coverage      # 90% lines/branches/functions gate
```

E2E config: copy `.env.example` to `.env` (gitignored) and set `AUTOREVIEW_E2E_ENDPOINT` / `AUTOREVIEW_E2E_MODEL` for your local LLM. Each e2e test guards itself with `serverAvailable()` and skips when the endpoint is unreachable, so failures here mean a real test failure, not a missing server.

Every feature lands with tests. There's no linter/formatter — the style is whatever's already in the file.

## Hard rules for this repo

1. **Zero npm dependencies.** Stdlib only. Includes tests. If you reach for a dep, find the stdlib alternative.
2. **TDD: test first.** Write the failing test, watch it fail, then write code. Not negotiable — this repo reviews commits against its own rules.
3. **No comments explaining WHAT code does.** Only WHY (non-obvious constraint, past incident, subtle invariant). Well-named identifiers carry the what.
4. **Never edit the user's root `.gitignore`.** The plugin writes `.autoreview/.gitignore` instead. Any code path that touches files in user repos must respect that boundary.
5. **Scripts in `scripts/bin/`** must be Windows-safe (use `isMainModule(import.meta.url)` from `fs-utils.mjs`, never `import.meta.url === \`file://${process.argv[1]}\``).
6. **`validate.mjs` runs both under the `autoreview:review` skill (Claude Code agentic) and as a frozen runtime copy invoked by the pre-commit hook.** Any breaking change to its interface is a coordinated plugin bump — users stay on the old behavior until SessionStart auto-upgrades their runtime.

**Exit code policy:** `severity: error` rules block on both `[reject]` and `[error]` verdicts (including provider unreachable). `severity: warning` rules never block. The old "soft precommit" blanket pass-through on provider errors is gone; per-rule `severity: warning` is the opt-out.

**Tiers replace per-rule provider/model:** rules declare `tier:` (logical cost tier); each repo's `tiers:` config maps tier names to concrete provider+model. Five allowed names: `default`, `trivial`, `standard`, `heavy`, `critical`. `default` is mandatory.

**The `override-rule` skill** is the path to adapt remote rules (change tier, severity, type, triggers) without forking the upstream source. Local rules are edited directly.

## Version bumps

Three files move in lockstep:
- `.claude-plugin/plugin.json`
- `package.json`
- `CHANGELOG.md` (promote `## [Unreleased]` entries to `## [X.Y.Z]`)

The `.version` sentinel in user repos is written from `.claude-plugin/plugin.json` at runtime — nothing else to update.

## When debugging a user-reported review failure

1. First ask what version the user is on: `cat .autoreview/runtime/.version`. If missing or older than current plugin, have them restart Claude Code so SessionStart re-syncs.
2. `node .autoreview/runtime/bin/validate.mjs --files <path> --rule <id>` — same invocation the hook uses. To get file:line reasons, temporarily set `mode: thinking` on the relevant tier in `.autoreview/config.yaml`, re-run, then revert.
3. `.autoreview/.history/<date>.jsonl` holds every verdict with attribution (actor, host, ci_run_id, commit_sha, tier, severity). That's the audit trail.

## Conventions in test writing

- One behavior per test. If the name needs "and", split it.
- Temp dirs via `mkdtemp(join(tmpdir(), 'ar-<purpose>-'))`, cleaned in `finally`.
- Assertions against observable behavior (files written, stdout/stderr, exit codes), not internal mock call counts.
- Infinite-loop guards: add `{ timeout: 2000 }` to any test that exercises a regex/parser on malformed input.
