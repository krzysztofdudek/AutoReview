# AutoReview

Per-file LLM code review against Markdown rules. Ollama-first, offline, zero npm dependencies.

## Install

1. `/plugin install autoreview` in Claude Code.
2. In your repo: `/autoreview:init --provider ollama` (or another provider).
3. Author your first rule with `/autoreview:create-rule`.
4. Commit — the pre-commit hook runs your rules.

## Key commands

- `/autoreview:init` — scaffold `.autoreview/` in a repo.
- `/autoreview:validate` — review uncommitted files.
- `/autoreview:create-rule` — 7-step guided rule wizard.
- `/autoreview:check-breadth --expr '<expr>'` — test a trigger without the LLM.
- `/autoreview:pull-remote` — fetch rules from a Git URL declared in config.
- `/autoreview:context <path>` — list rules matching a path (pre-write).
- `/autoreview:guide <query>` — find rules by free-text intent.

## Skills

Five auto-triggered skills cover the full workflow: `autoreview-setup`, `autoreview-create-rule`, `autoreview-review`, `autoreview-context`, `autoreview-guide`.

## Design documents

- Functional spec: `docs/specification.md`
- Implementation design: `docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md`
- Implementation plans: `docs/superpowers/plans/`

## Roadmap (post-MVP)

- `suppressed` verdict with `suppressed[]` history records (design §8).
- CLAUDE.md fallback for stdout injection (design §10).
- Guide skill `--smart` LLM rerank (design §7).
- CI workflow wiring (`npm test` ready, no GitHub Actions yet).

## License

MIT
