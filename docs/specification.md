# Auto Review — Functional Specification

## What it is

A local code review tool. A developer writes rules in plain Markdown, the tool runs an LLM reviewer against source files on commit, and returns a verdict per rule.

Scope is deliberately narrow: per-file review only. No cross-file context, no codebase indexing, no graph. One file in, one verdict out. This is the wedge that separates it from heavier architectural-enforcement tools.

Default mode: Ollama running locally. Offline-first, zero cloud, zero API keys required. Cloud providers (Anthropic, OpenAI, Google) are supported but opt-in.

Distribution: CLI + API + Claude Code skill plugin. All three expose the same operations.

Positioning: zero-config time-to-first-value. Install, write one Markdown rule, commit, tool works.

---

## Core functional requirements

### 1. Single-file review

Reviewer sees one file at a time. No access to other files in the repo. No indexing, no RAG, no graph walks.

### 2. Reviewer input shape

For each review invocation the reviewer gets:
- The full file content (always, for context)
- Below the file: an explicit section showing the diff of what changed in this commit

Both always provided. The rule's configuration decides whether the reviewer *evaluates* only the diff or the whole file. Context is always full-file regardless.

### 3. Rules are Markdown

Each rule is a `.md` file. Plain prose describing what must be true. No YAML schema for the rule content itself. Human-readable, human-writable, diff-friendly.

A rule file may include frontmatter or equivalent metadata for triggers and config (see below), but the body is free prose.

### 4. Rules organized in directory structure

Rules live in a directory tree under a known location in the repo (e.g., `.autoreview/`). Subdirectories are for organization only — no inheritance, no special semantics. `.autoreview/api/auth.md` and `.autoreview/domain/aggregates.md` are just two independent rules.

---

## Triggers — two-layer system

Triggers decide which rules apply to which file during a review run. A rule without triggers applies to nothing.

### 5. Layer 1 — regex/glob expressions (mandatory)

Every rule must declare a regex/glob trigger. The expression system supports:
- File path patterns (`src/api/**/*.ts`)
- File content patterns (regex against file contents)
- Logical operators: `AND`, `OR`, `NOT`, brackets for grouping
- Example: `(path:"src/api/**/*.ts" OR path:"src/handlers/**/*.ts") AND content:matches("@Controller")`

Layer 1 is deterministic. Evaluated locally. No LLM call. Free.

### 6. Layer 2 — intent trigger (optional)

If enabled in config and declared in the rule, a natural-language intent trigger runs after Layer 1 narrows the file set. Example: "applies only when the file implements a command handler that mutates state."

Intent triggers cost an LLM call. Must be explicitly opt-in per rule AND globally enabled in config. Default off.

### 7. Directory-based convention triggers

Rules can express "every file in directory X must satisfy Y." A subset of Layer 1 but common enough to deserve first-class treatment in the trigger syntax and rule-creator UX.

---

## Rule lifecycle — creation, validation, management

### 8. Rule creator — guided creation

An interactive flow (available via CLI and as a Claude Code skill) that helps a developer create a new rule:
- Asks what convention they want to enforce
- Proposes a Layer 1 trigger expression
- Tests the trigger against the current repo, shows match count + sample matches
- Lets user refine trigger until match set is right
- Generates the rule file

Zero-friction onboarding for rule authoring is a primary design goal. Writing good rules is the hard part in tools like this; this step has to be pleasant.

### 9. Trigger-breadth tool

Standalone tool (callable by the rule creator and directly by users/agents): given a trigger expression, return count and sample of matching files in the current repo. Prevents writing rules blind.

### 10. Rule validation

A command that runs one or more rules against a defined file set and reports results. Parameters:
- Default file set: uncommitted files (staged + unstaged)
- Override: specific directory, list of directories, specific file, list of files
- Override: specific rule or rule set

Same underlying engine as commit-time review; this is the "preview" entry point.

### 11. Setup / onboarding

First-run experience that scaffolds the tool in a repo:
- Creates the rules directory
- Checks for reviewer dependencies (Ollama running, API key present)
- If missing, explains what to install, offers safe defaults
- Generates an example rule the user can read and adapt
- Installs the pre-commit hook (with user confirmation)

Available as a setup skill for agents and as a CLI `init` command.

---

## Execution surfaces

### 12. Pre-commit hook

A Git pre-commit hook that runs review against staged files. Installed optionally during setup.

Hook behavior is configurable (see Exit codes below).

### 13. CLI

Command-line tool that exposes all operations: init, review, validate, create-rule, check-breadth. Symmetric with API.

### 14. API

Programmatic interface. Same operations as CLI. Used by agent integrations, IDE extensions, CI integrations.

### 15. Agent pre-check

An agent (Claude Code, Cursor, Codex, Cline, etc.) can ask the tool: "given file path X with content Y, would this pass review?" — *before* writing the file. Returns predicted verdict. Lets agents avoid writing code they'll immediately have to rewrite.

This is different from reviewing an already-written file: the input is a hypothetical, the reviewer evaluates what the file would look like if written as described.

### 16. Automatic activation for new files

Untracked files that become staged are reviewed by default. No configuration required. New-file coverage is one of the reasons teams install this.

### 17. Gateway semantics

The tool positions itself as a gate: if rules match a file and reviewer rejects, the commit/operation is blocked (unless user soft-fails or suppresses — see below). Gate is informational by default, enforcing when configured.

---

## Review output modes

### 18. Quick mode

Pass/fail verdict only, no reasoning. Minimal prompt, minimal output, fastest. Intended for: agent pre-checks, high-frequency auto-review, CI quick-gate.

### 19. Thinking mode with configurable reasoning effort

Full review with reasoning. Reviewer explains why something failed, cites the rule, points to the relevant code. Reasoning effort configurable (low/medium/high) when the underlying model supports it. Slower, richer output. Intended for: manual validation runs, blocking review, debugging false positives.

Quick and Thinking are selectable per invocation. Default per-context is configurable (e.g., pre-commit defaults to quick, manual `validate` defaults to thinking).

### 20. Diff-only vs whole-file evaluation

Per-rule config:
- `evaluate: diff` — reviewer judges only the changed lines (still sees full file for context)
- `evaluate: full` — reviewer judges the entire file state after the change

Full file is always in the prompt. This flag controls what the reviewer is asked to judge, not what it sees.

---

## Providers

### 21. Ollama-first, small-models-first

Default reviewer is Ollama running locally with a small model (3B–7B range). Zero cost, offline, private.

Supported providers (all opt-in beyond Ollama):
- Ollama (default)
- Anthropic API
- OpenAI API
- Google API
- Any OpenAI-compatible endpoint (custom URL)

Provider selection is global in config, overridable per-rule if a rule genuinely needs a stronger reviewer.

### 22. Soft-fail on missing config or dependencies

If there is no config, no Ollama running, no API key, or any other dependency missing — the commit proceeds. A clear warning is printed. Nothing is blocked.

This is non-negotiable. Blocking a commit because the tool isn't set up correctly is how pre-commit tools get ripped out of projects. Fail soft, fail loud, never break the workflow the tool is supposed to help.

---

## Configuration

### 23. Repo config + personal config

Two config files:
- Repo config — committed, shared with team, defines shared rules and defaults (e.g., `.autoreview/config.yaml`)
- Personal config — gitignored, per-developer, overrides repo config (e.g., `.autoreview/config.personal.yaml`)

Personal config can tighten or loosen individual settings: enable intent triggers locally, switch provider, enable extra rules, disable specific ones, increase reasoning effort.

### 24. Rules from remote Git URL

Config can declare remote rule sources: a Git URL, a tag or branch, a path within the remote repo. Rules from that source are fetched at runtime (with caching) and treated as part of the local rule set.

Use case: an organization publishes shared rules in one repo, multiple product repos pull them in live.

---

## Agent and ecosystem integration

### 25. Claude Code skill plugin

First-class distribution as a Claude Code skill. The skill exposes the tool's operations to agents running in Claude Code: review-this-file, check-if-would-pass, create-rule, validate, setup.

Not exclusive to Claude Code — CLI and API remain primary — but shipping as a well-integrated skill is a primary adoption surface.

---

## Developer ergonomics

### 26. Reasoning logs and history

Every review run is logged locally with:
- File reviewed
- Rules that matched
- Model and provider used
- Verdict (pass/fail per rule)
- Reasoning (if Thinking mode)
- Timestamp

Stored in the repo's local state (e.g., `.autoreview/.history/`, gitignored). User can inspect why a past verdict came out the way it did. Essential for debugging false positives and building trust.

### 27. Inline suppress comments

Developers can suppress a rule for a span of code with a comment:

```
// @autoreview-ignore <rule-name> <reason>
```

- Reason is mandatory (free text)
- Scope is contextual: in a function → that function; at file top → whole file; above a block → that block
- Reviewer honors the suppression and reports it as suppressed with the reason in the log
- Agents must never write a suppression without explicit user confirmation

### 28. Exit codes

Three-state exit contract:
- `0` — all rules passed OR no applicable rules OR soft-fail (no config/deps)
- `1` — hard fail, at least one rule rejected and enforcement is on
- `2` — internal error (tool crashed, not a rule verdict)

Enforcement mode (`hard` vs `soft`) is configurable:
- Soft mode: rule rejections print warnings, exit 0 — commit proceeds
- Hard mode: rule rejections print errors, exit 1 — commit blocks

Defaults:
- Local pre-commit: soft
- CI / validate command: hard
- Both configurable.

---

## Guide skill (separate from review)

### 29. Free-text intent → guide navigation

A second skill, distinct from review. A user asks in natural language: "how do I write a command handler here?" The skill:
- Searches rules relevant to the intent
- Surfaces rule files, example code paths (if linked from rules), and related guides
- Returns navigational pointers, not code

This is knowledge retrieval, not review. Kept separate in UX and in the skill catalog so the two modes don't cross-contaminate.

---

## Non-goals (explicit)

Stated so the implementation agent doesn't drift:

- **Not a cross-file architectural reviewer.** Per-file only. If the rule requires cross-file context to evaluate, it's out of scope for this tool.
- **Not a cloud service.** No hosted backend, no user accounts, no rules marketplace v1.
- **Not a PR review bot.** The primary surface is local pre-commit. GitHub/GitLab PR integrations can come later but are not part of the initial scope.
- **Not a linter replacement.** Static analysis, syntax checking, style formatting — all still done by existing tools (ESLint, Ruff, Prettier, etc.). Auto Review is for semantic and convention rules that linters can't express.
- **Not a model trainer.** Uses off-the-shelf models through provider APIs. No fine-tuning, no embedding indexes, no custom training pipelines.

---

## Open questions for the implementation agent

Questions that the spec intentionally leaves to implementation judgment, to be resolved in the first design pass:

1. **Rule file format for metadata.** Frontmatter YAML? Separate config block? First-class Markdown sections? Implementation agent proposes.
2. **Trigger expression language concrete syntax.** The spec states the semantics (regex/glob, AND/OR/NOT, path and content matchers). Concrete grammar and parser are implementation choices.
3. **History storage format.** SQLite? JSON Lines? Plain directory tree? Implementation agent proposes.
4. **Claude Code skill packaging.** Mechanism for distribution — npm package, standalone binary, skill marketplace entry — implementation agent proposes.
5. **Caching strategy for remote rules.** TTL? Tag-pinning semantics? Offline fallback? Implementation agent proposes.
6. **Rule matching performance.** If a repo has 10,000 files and 50 rules, the Layer 1 matcher needs to be fast. Indexing strategy TBD.

---

## Success criteria

The tool succeeds if:

1. A developer can go from `npm install` (or equivalent) to "blocked my first commit on a rule I wrote" in under 120 seconds.
2. A developer can write a new rule via the rule-creator in under 3 minutes, with the trigger-breadth tool showing matches live.
3. A commit on a machine with no Ollama, no API key, no config — proceeds cleanly with one warning line. Never blocks.
4. The tool runs entirely offline with Ollama. No feature requires cloud.
5. An agent (Claude Code, Cursor) can invoke the pre-check operation and get a predicted verdict in under 5 seconds for a typical source file.
6. Suppress markers work and are honored; agents never write them without user confirmation.