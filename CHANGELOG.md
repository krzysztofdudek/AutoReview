# Changelog

All notable changes to AutoReview documented here. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.1.1]

### Fixed
- `chunker.fitFile` produced a negative `sliceBytes` when the available budget was ≤ the 16-byte truncation marker, yielding truncated output that silently exceeded the context window. Guard added — sub-marker budgets now `skip` with a clear reason.
- `history.truncateFileField` crashed with `TypeError: Buffer.from(undefined)` whenever an oversize record (>3500B) lacked a `file` field (e.g. provider-error records carrying a large `raw`). Missing `file` is now a no-op; `raw` gets a final truncation pass so the line stays within `MAX_RECORD_BYTES`.
- `args.parseArgs` silently accepted `--flag` without a value, writing `undefined` into the config, and happily swallowed the next flag as the value (`--mode --rule foo` → `mode='--rule'`). Missing values now throw an explicit `--flag requires a value` error.
- `trigger-engine.toRegex` infinite-looped on globs with an unterminated `[` (e.g. `[abc` with no closing `]`): `indexOf(']', i)` returned `-1`, the for-loop's `i++` reset `i` to `0`, re-processing the same input forever and hanging the reviewer. Now throws `unterminated '[' bracket in glob`.
- Every `scripts/bin/*.mjs` entrypoint silently no-opped on Windows. The main-module guard `import.meta.url === \`file://${process.argv[1]}\`` never matched — `import.meta.url` is `file:///C:/...` while the constructed URL used backslashes and two slashes. Node imported the module, top-level code ran, but `run()` was never invoked. Exit 0, no output, no artifacts. First-time Windows users saw `init --install-precommit` "succeed" with no `.autoreview/` and no hook installed. Replaced with a cross-platform `isMainModule()` helper in `fs-utils.mjs` using `pathToFileURL(argv[1]).href`. Applied to all 11 entrypoints.

### Added
- Automatic `.autoreview/runtime/` upgrade on SessionStart. Previously, bumping the plugin left the bundled runtime pinned to whatever version was installed the last time `init --upgrade` ran, so pre-commit hooks kept executing stale code indefinitely. A `.autoreview/runtime/.version` sentinel is now written on init; SessionStart compares it against the installed plugin manifest and re-copies `scripts/lib/` + `scripts/bin/validate.mjs` when they diverge. `[autoreview] runtime upgraded X → Y` reported to stdout so the agent can relay the change. Shell / CI invocations (no `CLAUDE_PLUGIN_ROOT`) are unaffected — they keep using the bundled copy as before.

### Changed
- `init` no longer modifies the user's repository root `.gitignore`. A dedicated `.autoreview/.gitignore` is written instead (git honors nested per-directory `.gitignore` files), so AutoReview's runtime artifacts are ignored without touching any of the user's existing patterns.
- README, plugin manifest, and marketplace description repositioned away from "LLM reviewer" as the lead framing toward "per-file architecture gates" / "rule engine". Mechanism description unchanged deeper in the README. Keywords dropped `code-review`, `llm`, `linter`, `convention-enforcement`; added `architecture-enforcement`, `rule-engine`, `agentic-guardrails`, `agents-md`, `claude-md`, `markdown-rules`, `pre-commit-hook`. FAQ gained "Is this just another AI code review bot?". Footer "Yggdrasil family" link now clickable.

## [0.1.0]

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

First tagged release.
