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

## [0.1.0] — TBD

First tagged release.
