# Changelog

All notable changes to AutoReview documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Initial implementation covering all 29 points of the functional specification.
- Claude Code plugin with 6 skills, 8 slash commands (including `/autoreview:history`), and SessionStart hook.
- Zero-dep Node stdlib implementation. Runs on Node 20+.
- 225 tests, 1 env-gated smoke test for real Ollama.
- 8 provider adapters: Ollama, Anthropic, OpenAI, Google, OpenAI-compatible, Claude Code CLI, Codex CLI, Gemini CLI.
- Public JS API via `scripts/index.mjs` and unified CLI via `scripts/bin/autoreview.mjs`.
- `review.output_max_tokens` config (default `0` = no limit) to cap LLM output on paid APIs or let local models finish their thinking trace.
- E2E test suite (~140 scenarios) covering every CLI + a 90% coverage gate (`npm run coverage`) on lines, branches, functions.

### Fixed
- Response parser mis-picked the input file's JSON when a model quoted it in its reasoning trace. Now scans all candidates and takes the last one that carries a `satisfied` key.
- `scope-resolver` silently dropped content for `--files <absolute-path>` via `path.join(repoRoot, absPath)` producing a bogus path. Now detects absolute paths and normalizes to repo-relative.
- `validate` + `reviewer-test` `--content-file` resolved against `process.cwd()` instead of the CLI's `ctx.cwd`.
- `create-rule --body-file` same issue — relative paths from Claude Code's cwd now resolve correctly.
- `saveRule` now guards against path traversal (`../`, absolute paths) on `--to`.
- `worktreeModifiedPaths` includes untracked files so `--scope uncommitted` matches the name.
- `remote-rules-pull` preserved `path:` layout on `cp` so rule-loader's base matches the pulled tree.
- Thinking-mode suppress + reasoning warnings go through `ctx.stderr` instead of `console.error`.
- Prompt no longer requests `reason` on `satisfied=true`; parser drops it client-side too.
- Quick-mode `maxTokens: 100` hardcode was too tight for reasoning-first models (Qwen, R1, o1) — their short reasoning trace exhausted the cap before the verdict JSON, producing silent `[error]` verdicts that let rule violations slip past hard enforcement. Unified both modes under a single `review.output_max_tokens` knob with default 0 = no cap. Adapters handle 0 per their API (omit field / `num_predict: -1` / 8192 fallback for Anthropic).
- Truncated-file verdict no longer silently passes. When a file exceeds the context window but fits within 3× (chunker's truncate branch), a `satisfied: true` verdict on partial content is now promoted to `[error] truncated: reviewer saw only first N bytes of M — pass verdict on partial content is unreliable`. `satisfied: false` still counts as a real reject (violation found in what the reviewer saw).
- README `autoreview validate …` shell example replaced with real invocations: `/autoreview:validate …` (Claude Code) + `node .autoreview/runtime/bin/validate.mjs …` (shell). The bare `autoreview` binary requires `npm install -g` which plugin-marketplace users don't do.
- `[reject]` hint block `${AUTOREVIEW}` placeholder replaced with the real post-init path `node .autoreview/runtime/bin/validate.mjs`.

### Changed
- Pre-commit hook template passes `"$@"` through to the CLI.
- `init --upgrade` + `--precommit-{skip,append}` branches covered by tests.
- `[reject]` lines under soft enforcement are now tagged `(warn-only — commit proceeds under soft enforcement)` so users don't mistake a soft-mode warning for a hard block.
- `[reject]` hints now include `why (Claude Code)` + `why (shell)` + `skip:` + `edit:` + `help:` lines inline. Blocked users don't have to leave the terminal to know what to do.

## [0.1.0] — TBD

First tagged release.
