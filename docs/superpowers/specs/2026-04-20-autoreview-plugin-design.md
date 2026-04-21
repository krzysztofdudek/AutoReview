# AutoReview Plugin — Implementation Design

**Date:** 2026-04-20
**Status:** Approved
**Source spec:** `docs/specification.md`
**Reference project:** `../Yggdrasil` (TypeScript CLI for architecture enforcement — reused patterns for provider abstraction, prompt structure, JSON parsing, consensus voting)

---

## 1. Overview

AutoReview is a Claude Code plugin that performs per-file code review against Markdown rules using an LLM reviewer (local Ollama, cloud API providers, or CLI-subprocess agents). It ships as a single self-contained plugin — skills, slash commands, hooks, and executable scripts — with **zero npm dependencies** (Node.js standard library only).

The full 29-point functional specification is in scope. This document is the implementation design.

### Design principles

- **Plugin-first, self-contained.** No standalone CLI. No external binary. Distribution and update via the plugin unit.
- **Zero install beyond Node.** User must have Node.js available (already true for Claude Code users); nothing else required. No `npm install` in user repo.
- **Soft-fail in commit contexts.** A misconfigured, unreachable, or crashed tool never blocks a commit. In explicit review contexts (`validate`, CI) the user asked for verdict — hard enforcement exits non-zero. Warnings go to stderr; exit 0 in soft contexts, exit 1 in hard.
- **Agent never handles secrets.** API keys are placeholder-in-file only; user fills them out-of-band.
- **Agent-controlled review timing.** No `PreToolUse` interception; agent decides when to validate.
- **Reused patterns from Yggdrasil.** Provider abstraction, prompt XML structure, JSON response parsing, consensus voting — ported 1:1 where applicable.
- **Ollama-first default.** Offline, zero-cost, private reviewer is the path of least friction. Other providers are opt-in via setup wizard.

---

## 2. Architecture & Layout

### Plugin layout

```
autoreview-plugin/
  .claude-plugin/plugin.json
  skills/
    autoreview-setup/
    autoreview-create-rule/
    autoreview-review/
    autoreview-context/
    autoreview-guide/
  commands/
    init.md
    validate.md
    create-rule.md
    check-breadth.md
    context.md
    pull-remote.md
    guide.md
  hooks/
    hooks.json                       # Claude Code hook config (SessionStart binding)
    session-start.sh                 # thin shell wrapper that execs scripts/bin/session-start.mjs
  scripts/
    bin/                             # entry points wired to commands/hooks
      init.mjs
      validate.mjs
      create-rule.mjs
      check-breadth.mjs
      context.mjs
      pull-remote.mjs
      guide.mjs
      session-start.mjs
      reviewer-test.mjs              # standalone test harness
    lib/                             # reusable modules
      trigger-engine.mjs             # parser + path/content matcher
      provider-client.mjs            # API HTTP + CLI subprocess abstraction
      cli-base.mjs                   # shared subprocess plumbing
      reviewer.mjs                   # prompt build + consensus + JSON parse
      rule-loader.mjs                # YAML frontmatter + MD body loader
      yaml-min.mjs                   # minimal YAML subset parser
      config-loader.mjs              # merge repo + personal + secrets + env
      history.mjs                    # JSONL per-day append
      remote-rules-pull.mjs          # git subprocess + replace
      git-utils.mjs                  # staged files, diff, precommit install
      fs-utils.mjs
  templates/
    example-rule.md
    config-repo.yaml
    config-personal.yaml
    config-secrets.yaml
    precommit-hook.sh
    agent-rules.md                   # emitted by SessionStart, not copied to repo
```

### User repo layout after `/autoreview:init`

```
<repo>/
  .autoreview/
    rules/                           # local rules (MD with YAML frontmatter; subdirs allowed)
    remote_rules/<name>/<ref>/...    # on-demand pulled; replaced per pull
    config.yaml                      # committed
    config.personal.yaml             # gitignored
    config.secrets.yaml              # gitignored
    history/YYYY-MM-DD.jsonl         # optional, append-only
    runtime/                         # installed copies of lib/ and precommit bin
                                     # for git-hook reuse outside plugin runtime
  .git/hooks/pre-commit              # installed by autoreview-setup
  .gitignore                         # augmented with .autoreview/config.personal.yaml,
                                     # .autoreview/config.secrets.yaml,
                                     # .autoreview/history/
```

### Runtime placement rationale

Git pre-commit hook runs outside the Claude Code process. It needs a stable path to the executable review script. `autoreview-setup` copies the required scripts (`scripts/bin/validate.mjs` + `scripts/lib/*`) into `.autoreview/runtime/`. On plugin upgrade, `/autoreview:init --upgrade` refreshes this snapshot. Copies are gitignored.

---

## 3. Rule Format & Trigger Language

### File layout

Rules live under `.autoreview/rules/` (and `.autoreview/remote_rules/<name>/<ref>/`). Subdirectories are for organization only — no inheritance, no semantics.

Rule identifier:
- Local rule: relative path from `rules/` minus `.md`. `rules/api/auth.md` → `api/auth`.
- Remote rule: source name prefix + relative path from `remote_rules/<name>/<ref>/` minus `.md`. `remote_rules/company-shared/v1.2.0/observability/audit.md` → `company-shared/observability/audit`. The `<ref>` segment is dropped from the identifier — if two refs of the same source coexist, only the ref pinned in config is loaded.

Collision rule: if a local rule and a remote rule resolve to the same identifier, local wins and a warning is emitted at load time. Suppress markers (`@autoreview-ignore <rule-id>`) use the identifier as defined here.

Config validation forbids duplicate `name` values in `remote_rules[]` — one name, one ref pin. Config loader errors (soft-fail context) with a clear message if duplicates exist.

Note on rule directory nesting: spec §4 example places rules directly under `.autoreview/` (e.g. `.autoreview/api/auth.md`). This design nests under `.autoreview/rules/` to leave room for `remote_rules/`, `history/`, `runtime/`, and `config.*.yaml` siblings. The spec example is treated as illustrative rather than prescriptive.

### Rule file format

YAML frontmatter + Markdown body:

```md
---
name: "API Controllers Validate Input"
triggers: '(path:"src/api/**/*.ts" OR path:"src/handlers/**/*.ts") AND content:"@Controller"'
intent: "command handler that mutates state"    # optional Layer 2 NL intent
description: "Controllers must validate with zod before processing"  # optional, used by guide skill
---
Every controller must validate input with zod before processing.
Reject with HTTP 400 if validation fails.
Log rejection with correlation-id.
```

**Frontmatter keys:**
- `name` (required) — display name
- `triggers` (required) — Layer 1 expression (grammar below)
- `intent` (optional) — Layer 2 natural-language trigger; active only when `review.intent_triggers: true` globally
- `description` (optional) — one-sentence summary for guide skill ranking
- `provider` (optional) — per-rule override of `config.provider.active` when this rule genuinely needs a stronger reviewer (spec §21). Must match a configured provider key.
- `model` (optional) — per-rule override of that provider's `model`. Paired with `provider`, or overrides the active provider's model alone.
- `default` (optional) — `enabled` (default, assumed when omitted) or `disabled`. A rule with `default: disabled` is inert unless listed in `config.rules.enabled_extra`. Use this for opt-in rules shipped in a remote source that not every consumer wants.

Body = plain Markdown prose = the rule content the reviewer checks against source files. No schema for body.

### Trigger language grammar (Layer 1)

Recursive descent parser. Infix, case-insensitive operators, string-quoted atoms.

```
EXPR      = OR
OR        = AND ('OR' AND)*
AND       = UNARY ('AND' UNARY)*
UNARY     = 'NOT' UNARY | ATOM
ATOM      = '(' EXPR ')' | PREDICATE
PREDICATE = ('path' | 'content') ':' STRING
STRING    = '"' <chars; escapes: \" = ", \\ = \, \n = newline (0x0A)> '"'
```

**Semantics:**
- `path:"<glob>"` — minimatch-style glob (`**`, `*`, `?`, `[abc]`, `{a,b}`). Custom implementation in `trigger-engine.mjs` (~120 lines, no deps).
- `content:"<regex>"` — JS `RegExp` evaluated against the full file content. Multi-line control via inline `(?s)` / `(?m)` if needed.
- Reserved words (`AND`, `OR`, `NOT`, `path`, `content`) are recognized only **outside** quoted strings. Inside strings, any characters are legal (including `AND`, backslash-escape for `\"`, `\\`, `\n`).
- **Binary / oversized file guard:** before evaluating `content:` predicates, engine sniffs first 512 bytes for NUL bytes (binary heuristic) and checks file size. Files flagged binary or > 1 MiB are treated as non-match for every `content:` predicate (path predicates still evaluate). This avoids feeding binary garbage to regex and prevents OOM on large assets.
- **Walk bounds:** when Layer 1 needs to enumerate files for `check-breadth` or `autoreview-review --scope all`, the walker respects `.gitignore`, skips `node_modules/`, `.git/`, `dist/`, `build/`, `.autoreview/`, and imposes a total walk budget (default 10,000 files, configurable via `review.walk_file_cap`). Walk termination prints "reached walk cap (10000 files)" so users know results are truncated. Prevents multi-GB monorepo traversal from freezing the wizard.

**Examples:**
- `path:"src/**/*.ts"`
- `(path:"src/api/**" OR path:"src/handlers/**") AND content:"@Controller"`
- `path:"**/*.md" AND NOT content:"draft"`

### Layer 2 intent trigger (optional)

Per-rule free-text phrase. Active only when globally enabled (`config.review.intent_triggers: true`). Evaluated with a mini LLM call: "Does this file implement [intent]? Answer yes/no." Skips files where answer is no. Cost: 1 LLM call per (rule-with-intent, file passed Layer 1). Opt-in per rule AND globally.

**Cost circuit breaker:** `review.intent_trigger_budget` (default 50) caps intent calls per review run. When exceeded, remaining intent checks are skipped with warning "intent budget exhausted — remaining rules evaluated against Layer 1 only". Verdicts produced under budget are cached in-memory by `(rule_id, sha256(file_content))` for the duration of the run — re-running the same wizard step does not re-spend.

---

## 4. Configuration

Three files, merged in priority order (higher overrides lower):
1. `config.secrets.yaml` + env vars (highest — secrets never in committed config)
2. `config.personal.yaml`
3. `config.yaml` (lowest — team-shared baseline)

Deep merge: object values merged recursively; scalar and array values from higher priority replace lower-priority wholesale (no list concatenation). Explicitly, `remote_rules[]` is replaced wholesale when present in personal config — there is no per-entry merge. Env vars for API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_COMPAT_API_KEY`) and Ollama host (`OLLAMA_HOST`, overrides `provider.ollama.endpoint`) as fallback when the secrets file is absent. Precedence for `OLLAMA_HOST`: `config.secrets.yaml` > env var > `config.yaml`/`config.personal.yaml` — same as API keys, even though `OLLAMA_HOST` is not a secret. Keeps behavior uniform.

### `.autoreview/config.yaml` (committed)

```yaml
version: "0.1"

provider:
  active: ollama                          # Ollama-first default (spec §21)
  ollama:        { endpoint: "http://localhost:11434", model: "qwen2.5-coder:7b" }
  claude-code:   { model: haiku }
  codex:         { model: "gpt-5" }
  gemini-cli:    { model: "gemini-2.5-flash" }
  anthropic:     { model: "claude-haiku-4-5" }
  openai:        { model: "gpt-4o-mini" }
  google:        { model: "gemini-2.5-flash" }
  openai-compat: { endpoint: "<url>", model: "<id>" }

review:
  evaluate: diff                          # diff | full — what reviewer judges
  mode: quick                             # quick | thinking
  reasoning_effort: medium                # low | medium | high (where supported)
  consensus: 1                            # positive odd >= 1 (capped at 1 in precommit context)
  intent_triggers: false                  # Layer 2 global enable
  intent_trigger_budget: 50               # max intent LLM calls per run; skip remaining on overflow
  context_window_bytes: auto              # input context budget for chunker — auto | <int>; "auto" resolves
                                          # via model_info (Ollama) or per-provider defaults; hard fallback 4096×4
  output_reserve_bytes: 2000              # bytes reserved for model output in chunking math (thinking mode)

enforcement:
  precommit: soft                         # soft | hard
  validate: hard

context_overrides:                        # per-surface mode/consensus override
  precommit: { mode: quick, consensus: 1, scope: staged }
                                            # consensus forced to 1 in precommit — spawn budget; invariant
  validate:  { mode: thinking, scope: uncommitted }
                                            # default scope for manual /autoreview:validate without args

rules:                                    # spec §23 per-rule toggles in personal config
  enabled_extra: []                       # extra rule IDs to enable beyond defaults (personal-config use)
  disabled: []                            # rule IDs to skip entirely for this caller

remote_rules:
  - name: company-shared                  # names must be unique (validated at load)
    url: "https://github.com/org/rules.git"
    ref: "v1.2.0"                         # tag | branch | commit
    path: "rules/"                        # subdir inside remote repo

history:
  log_to_file: true                       # if false, no history JSONL written
```

**Note on the renamed budget key.** The context-chunker budget is now `review.context_window_bytes` (input window), separate from the per-mode `max_tokens` for the provider's reply (quick: 100, thinking: higher). `auto` resolves via provider introspection where possible, falling back to a conservative `4096 × 4 = 16384` byte input window. The earlier v1 design conflated the two — fixed here.

### `.autoreview/config.personal.yaml` (gitignored)

Same shape; only overridden keys are present. Common uses: switch `provider.active` to a cloud provider; flip `review.mode` to `thinking`; enable `review.intent_triggers` locally.

### `.autoreview/config.secrets.yaml` (gitignored)

```yaml
# Fill in your API key below. This file is gitignored.
# Alternative: set env vars (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY).
anthropic:
  api_key: "<PASTE_ANTHROPIC_API_KEY_HERE>"
# openai:
#   api_key: "<PASTE_OPENAI_API_KEY_HERE>"
# google:
#   api_key: "<PASTE_GOOGLE_API_KEY_HERE>"
```

`autoreview-setup` writes placeholders only. The agent never asks the user to paste keys in conversation and never reads `config.secrets.yaml` content (operating-manual rule).

### Minimal YAML parser (`lib/yaml-min.mjs`)

Supports the subset used across config/frontmatter/rule files:
- `key: value`
- `key: "quoted string"`
- Nested mappings (at least 3 levels required; deeper nesting supported if the implementation accepts it — no hard cap intended)
- List items (`- value` / `- key: value`)
- Inline `{k: v, k: v}` maps and `[a, b]` lists
- Comments (`#`)

No anchors/aliases, no tags, no multi-line strings beyond `|`. ~100 lines. Sufficient for all AutoReview files.

### Remote rules

Pull is **on-demand**: user invokes `/autoreview:pull-remote` (or the rule-authoring skill prompts during create-rule flow). Never auto-pulled, no TTL, no background refresh.

Per source in `remote_rules[]`:

1. `git clone --depth 1 --branch <ref> <url> <tmp-dir>` with hardened env and flags:
   - `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` — ignore system/user git config
   - `-c core.hooksPath=/dev/null` — disable any hooks shipped in the cloned repo
   - Clone target is a throwaway `<tmp-dir>` under OS tempdir; cleaned up in step 4
2. Copy `<path>` subtree from `<tmp-dir>` to `.autoreview/remote_rules/<name>/<ref>/`
3. Before copy, verify the target dir is AutoReview-managed by checking for a `.autoreview-managed` sentinel file (written on first pull). If missing AND dir exists with user content → error, refuse wipe (protects against accidental wipe of a path a user manually populated). Otherwise wipe prior `.autoreview/remote_rules/<name>/<ref>/` and write the sentinel.
4. Remove `<tmp-dir>`.

Fetch failure for one source is warning + continue. Does not block other sources.

---

## 5. Surfaces — Skills, Commands, Hooks

### Skills (auto-triggered by `description`)

| Skill | Model-facing description (abridged) |
|---|---|
| `autoreview-setup` | Initialize AutoReview in a project, configure provider, install git pre-commit hook. Triggered by "setup autoreview", "init autoreview", missing `.autoreview/`. |
| `autoreview-create-rule` | Author a new code convention rule via 7-step guided wizard. Triggered by "add a rule", "enforce X", "create a convention". |
| `autoreview-review` | Validate files against AutoReview rules (real LLM review). Triggered before commit, when wrapping up feature work. |
| `autoreview-context` | Use when the agent has a concrete file path (about to edit `src/api/users.ts`) and needs to discover which rules apply to THAT path. Returns `read:` pointers. Free (no LLM call). |
| `autoreview-guide` | Use when the agent has a free-text question about a convention but no file path yet ("how do I write a command handler here"). Returns `read:` pointers to relevant rules. Knowledge retrieval, not review. Free. |

### Slash commands (explicit, user-invokable)

| Command | Purpose |
|---|---|
| `/autoreview:init [--upgrade]` | Bootstrap `.autoreview/` (wraps `autoreview-setup`) |
| `/autoreview:validate [--rule <id>] [--files <paths>] [--dir <path>] [--scope staged\|uncommitted\|all] [--sha <commit-sha>]` | Review existing files |
| `/autoreview:create-rule` | Start wizard |
| `/autoreview:check-breadth --expr '<expr>'` or `/autoreview:check-breadth --rule <id>` | Trigger test only — match count + sample paths (no LLM). `--expr` tests a raw expression (wizard iteration); `--rule` tests an already-saved rule. |
| `/autoreview:context <path>` | Rules matching a path |
| `/autoreview:pull-remote [<name>]` | Fetch remote rule source(s) |
| `/autoreview:guide <intent>` | Free-text rule navigation |

### Hooks

**`SessionStart`** — configured in `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\""
      }
    ]
  }
}
```

The shell wrapper `hooks/session-start.sh` execs `node "${CLAUDE_PLUGIN_ROOT}/scripts/bin/session-start.mjs"`. `CLAUDE_PLUGIN_ROOT` is provided by Claude Code to hook execution environments — the wrapper uses it because the hook runs with `cwd` set to the user repo, not the plugin install dir. The node script then:

- If cwd has no `.autoreview/config.yaml` → stderr one-liner "AutoReview not initialized in this repo", exit 0, emit no context.
- Otherwise:
  - Check provider reachability with 1s timeout (best-effort) → 1-line status on stderr
  - Check remote rules presence → 1-line summary on stderr
  - **Emit agent operating manual** (`templates/agent-rules.md`) on stdout — Claude Code injects stdout as a system-reminder into the session (verified mechanism, used by `caveman` and other plugins). This replaces any `CLAUDE.md` modification. The plugin stays self-contained; uninstall removes the rules automatically.
- Never blocks. Never modifies user files.

The operating manual is specified in `templates/agent-rules.md` with a **target budget: ≤ 800 tokens** (≈ 3200 bytes) covering: context-before-write rule, never-write-secrets rule, never-suppress-without-confirmation rule, create-rule wizard entry, validate vs. precommit distinction, post-factum review via `--sha <commit>` (so agent can offer "I can check that commit" when user asks), hypothetical-review redirect to `validate --files`, concise skill index. The injected text is part of the context for every turn until compaction; staying small keeps per-turn tax low.

Budget fallback: if content genuinely needs more, drop the skill index first — each skill has its own `description` already loaded by Claude Code, so the index is the most redundant element. Hard ceiling: 1200 tokens. Anything above is rejected during implementation.

**Fallback if stdout injection is unavailable in a future Claude Code version:** setup wizard offers to append a fenced `<!-- autoreview:begin --> ... <!-- autoreview:end -->` block to `CLAUDE.md` (or write `AUTOREVIEW.md` with include instruction). Not the default path; documented as an escape hatch in §10.

### Git pre-commit hook

Installed optionally by `autoreview-setup`. Lives at `.git/hooks/pre-commit`:

```sh
#!/usr/bin/env sh
exec node "$(git rev-parse --show-toplevel)/.autoreview/runtime/bin/validate.mjs" \
  --scope staged \
  --context precommit "$@"
```

`--context precommit` applies `context_overrides.precommit` from config (default quick mode, soft enforcement).

---

## 6. Reviewer Pipeline

### Provider abstraction (`lib/provider-client.mjs`)

Uniform interface:

```
interface Provider {
  isAvailable(): Promise<boolean>
  verify(prompt: string): Promise<{
    satisfied: boolean,
    reason?: string,
    providerError?: boolean
  }>
}
```

Two implementation families:

#### HTTP providers

Shared code path with per-provider adapters (request body + response extract):
- `ollama` — POST `/api/generate`
- `anthropic` — POST `/v1/messages`
- `openai` — POST `/v1/chat/completions`
- `google` — POST `/v1beta/models/.../generateContent`
- `openai-compat` — OpenAI shape with user-supplied endpoint

Common: retry with exponential backoff, timeout around 120s, auth header from config or env. Exact retry count, backoff constants, and timeout are deferred to implementation (see §10) — design specifies reasonable defaults but leaves tuning open.

#### CLI subprocess providers (ported 1:1 from Yggdrasil `cli-base.ts`)

Pattern:
- `spawn(binary, args, {stdio:['pipe','pipe','pipe']})` with 120s timeout
- `isAvailable()` preflight via `which <binary>` (5s timeout)
- `stdinMode: true` → args omit prompt; prompt written to `child.stdin`
- `stdinMode: false` → prompt as arg (`-p <prompt>`); detect `E2BIG` on spawn error
- Timeout → SIGTERM + fallback response
- Non-zero exit → `{satisfied: false, reason: 'Reviewer unavailable', providerError: true}`

Exact configurations:

| Provider | binary | stdinMode | args |
|---|---|---|---|
| claude-code | `claude` | true | `['--model', <m>, '--print']` |
| codex | `codex` | true | `['exec', '-', '--json', '-m', <m>, '--output-schema', <schema>]` |
| gemini-cli | `gemini` | false | `['-p', <prompt>, '-o', 'json', '-m', <m>]` |

Codex `--output-schema` is set to `{type:"object",properties:{satisfied:{type:"boolean"},reason:{type:"string"}},required:["satisfied","reason"]}` to get structured JSON replies.

#### Response parser (`lib/cli-base.mjs` + shared HTTP path)

Four-tier fallback (ported from Yggdrasil `parseAspectResponse`):

1. Direct `JSON.parse(trimmed)`
2. Markdown fence extraction — `/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/`
3. First balanced-brace JSON object — scan from the first `{`, track brace depth, stop at matching `}`. Prefer this over greedy `/\{[\s\S]*\}/` which can span multiple objects in noisy replies.
4. Natural-language keyword fallback — scan for `satisfied` / `not satisfied`; `reason` = first 200 chars

### Reviewer loop (`lib/reviewer.mjs`)

Per (file, rule):

**Rule-set filter (applied at rule-load, before anything below runs):**

Rules declared in `config.rules.disabled` (rule IDs) are removed from the effective rule set at load time — before Layer 1 eval, before breadth-check, before `context`, before `guide`. Filter applies uniformly so history, breadth, context, and guide all see the same rule set. `config.rules.enabled_extra` enables rules that carry `default: disabled` in their frontmatter (new optional frontmatter key — defaults to enabled if omitted). This is the concrete pairing that makes `enabled_extra` meaningful (otherwise there is nothing to "enable extra").

1. **Layer 1 match** — `trigger-engine` evaluates `rule.triggers` against `(path, content)`. No match → skip (treated as pass for this rule×file, no LLM call).

2. **Layer 2 intent check** (when `rule.intent != null` AND `config.review.intent_triggers: true`): mini provider call "does this file implement [intent]? yes/no". No → skip. Respects `review.intent_trigger_budget` per-run; when exhausted, remaining intent checks auto-skip with warning. Verdicts cached in-run by `(rule_id, sha256(file_content))` to avoid re-spend on wizard iteration.

**Effective provider/model resolution (before prompt build):**

Each (file, rule) call resolves its effective provider as `rule.provider ?? config.provider.active`, and effective model as `rule.model ?? provider.<effective>.model`. Consensus voting, chunking budget (`context_window_bytes: auto` resolves against the effective provider, not the active one), and all cache keys (`intent_trigger_budget` cache, wizard test-drive cache) use the effective provider/model as part of the key. Enables spec §21 "overridable per-rule if a rule genuinely needs a stronger reviewer."

3. **Build prompt** (XML-structured, inspired by Yggdrasil `aspect-verifier.ts`):

```
<task>
You verify whether a source file satisfies a rule.
Check every statement in the rule against the code.

Evaluate: {diff | full}
  - diff: judge the changed lines only; full file is context.
  - full: judge the entire file state.

Mode: {quick | thinking}
  - quick: output exactly {"satisfied": true|false}
  - thinking: output exactly {"satisfied": true|false, "reason": "explanation with file:line refs"}

Honor `@autoreview-ignore <rule-id> <reason>` comments in the code — treat suppressed
code as satisfied. The comment applies contextually (function / class / block / file-top).

Respond with EXACTLY this JSON, nothing else.
</task>

<rule id="..." name="...">
{body of rule markdown}
</rule>

<file path="...">
{full file content}
</file>

<diff>
{unified diff if present}
</diff>
```

Both file and diff always present in context when diff exists. `evaluate` only changes what the reviewer is asked to judge.

4. **Consensus voting** (when `config.review.consensus > 1`) — run N provider calls, majority vote on `satisfied`. Reason taken from one of the majority votes.

5. **Response parse** — four-tier JSON extraction. Final fail → treat as provider error, apply soft-fail rules.

6. **Log** (when `config.history.log_to_file: true`) — append to `.autoreview/history/YYYY-MM-DD.jsonl`.

### Chunking fallback

Token budget math (ported from Yggdrasil `chunkSourceFiles`, with AutoReview-specific overhead). The budget variable is the **input** context window, not the reply cap:

```
PROMPT_BOILERPLATE_BYTES   = 1500   # <task>, <rule>, <file>, <diff> tags + instructions
rule_body_bytes            = sizeof(rule.body)
diff_bytes                 = sizeof(unified_diff)          # 0 if no diff
output_reserve_bytes       = config.review.output_reserve_bytes    # default 2000
context_window_bytes       = resolve(config.review.context_window_bytes)   # auto → per-provider default or 16384

available_for_file_bytes   = context_window_bytes
                             - PROMPT_BOILERPLATE_BYTES
                             - rule_body_bytes
                             - diff_bytes
                             - output_reserve_bytes
```

Behavior:
- `sizeof(file_content) ≤ available_for_file_bytes` → fits as-is.
- `available_for_file_bytes ≤ 0` (rule body itself + diff + reserve overflows budget) → warning + skip this (file, rule) pair.
- `sizeof(file_content) > available_for_file_bytes` → truncate file content to fit, append `[... truncated]` marker.
- `sizeof(file_content) > 3 × available_for_file_bytes` (file more than 3× available window) → warning + skip review for that file (soft-fail path).

`context_window_bytes: auto` resolves via provider introspection where possible (Ollama `model_info`) and per-provider defaults elsewhere (conservative 4096 tokens × 4 bytes = 16384 bytes for unknown providers). `PROMPT_BOILERPLATE_BYTES` calibrated from the prompt template above; refine with measurement during implementation. 4-bytes-per-token heuristic matches Yggdrasil's chunker and is intentionally conservative.

### Modes

- **quick** — `{"satisfied": bool}` only; `max_tokens=100`; low temperature; no reasoning in request where provider supports.
- **thinking** — full `{"satisfied": bool, "reason": "..."}`; `reasoning_effort` from config (low/medium/high where supported).

---

## 7. UX Flows

### `autoreview-setup`

1. Check `.autoreview/` existence. If present and `--upgrade` not passed → "already initialized, use `/autoreview:init --upgrade`".
2. Create directory structure (`rules/`, `history/`, `runtime/`).
3. **Probe and recommend provider.** Ping `http://localhost:11434/api/tags` (Ollama default endpoint). If reachable → recommend Ollama first (rationale line: offline, free, private). If not → recommend installing Ollama OR offer next option. List all providers with one-line descriptions; Ollama at the top.
4. Provider-specific branch:
   - **ollama** (recommended) — list `/api/tags`; user selects model; validate with a single small generate call.
   - **claude-code / codex / gemini-cli** — `which <binary>` preflight; if missing, show install hint but still write config.
   - **anthropic / openai / google / openai-compat** — write `config.secrets.yaml` with placeholder. Instruct user to fill it out-of-band. **Do not ask for key in conversation.** Do not ping with key.
5. Write `config.yaml` + empty `config.personal.yaml` + placeholder `config.secrets.yaml` (when applicable).
6. Ask: add remote rule sources? (yes/no). If yes — iterate (name, url, ref, path); append to config; run first pull.
7. Ask: install git pre-commit hook? (default yes, explicit confirm). Copy `templates/precommit-hook.sh` to `.git/hooks/pre-commit` and `chmod +x`. If existing hook present → show diff, ask overwrite / skip / append.
8. Ask: install example rule? (default yes). Copy `templates/example-rule.md` → `.autoreview/rules/example.md`.
9. Append `.autoreview/config.personal.yaml`, `.autoreview/config.secrets.yaml`, `.autoreview/history/`, `.autoreview/runtime/` to `.gitignore`. Idempotent: setup skips entries already present (line-level match) to avoid duplicate lines on re-run or `--upgrade`.
10. Copy `scripts/bin/validate.mjs` + `scripts/lib/*` snapshot → `.autoreview/runtime/`.
11. Final message: "Setup done. Try `/autoreview:validate` or `/autoreview:create-rule`."

### `autoreview-create-rule` (7-step guided wizard)

Step-level LLM boundary key: 🅰 = agent reasoning only (no reviewer call), 🅱 = reviewer LLM call.

1. 🅰 **What to enforce?** Free-text from user. Continue dialog until convention is concrete.
2. 🅰 **Propose name + trigger.** Agent greps the repo first, then proposes a name and a YAML trigger expression. Wizard asks "is this a directory convention (every file under `<dir>/` must satisfy X)?" — if yes, agent proposes `path:"<dir>/**"` directly, per spec §7 first-class directory treatment. User confirms or edits.
3. 🅰 **Breadth check.** Invoke `check-breadth --expr '<tr>'`. Show match count + 10 sample paths. Iterate until user is happy with the match set. Zero LLM cost — trigger parser only.
4. 🅰 **Pass/fail examples.** Agent reads 2–3 matched files with its own Read tool (no reviewer LLM call), reasons out loud "this one would pass because X / this one would fail because Y" based on the draft rule body. User confirms the rule separates pass/fail as intended.
5. 🅱 **Intent trigger?** (only if `config.review.intent_triggers: true`) — agent asks if a Layer 2 NL intent should be added. If yes, breadth-checks intent on sample (mini LLM calls; cached by `(intent_text, file_sha256)` within the session).
6. 🅱 **Test-drive.** `validate --rule <id> --files <2-3 sample paths>` with real reviewer LLM. Show verdicts. User sanity-checks. If wrong → back to step 1/2 to refine body. Test-drive verdicts cached in-session by `(sha256(rule_body), sha256(file_content), mode)` — re-running step 6 after editing body only re-invokes for changed inputs.
7. 🅰 **Save.** Agent writes `.md` file with frontmatter + body to `.autoreview/rules/<path>/<name>.md`. Terminal message: `Rule saved at .autoreview/rules/<path>/<name>.md. Run 'git add .autoreview/rules/<path>/<name>.md && git commit' when ready.` Agent does NOT run git commit — commit stays with the user (auth/intent separation).

### `autoreview-review`

1. **Resolve scope.** Four scope modes (mutually exclusive; exactly one wins per invocation):

   | Scope | How files + diff are resolved | Default for |
   |---|---|---|
   | `--scope staged` | Path set: non-space index status in `git status --porcelain=v1` (`A`, `M`, `R`, `C`). File content read from working tree. Diff: staged changes (`git diff --cached -- <path>`). | Pre-commit hook |
   | `--scope uncommitted` | Path set: `staged` ∪ any path with non-space worktree status (unstaged modifications, renames). File content from working tree. Diff: full uncommitted change (`git diff HEAD -- <path>`). | `/autoreview:validate` with no scope flag |
   | `--scope all` | Path set: walk under `.gitignore` with walk cap. File content from working tree. No diff (`evaluate: diff` falls back to `full` when no diff exists). | Explicit full-repo sweep |
   | `--sha <commit-sha>` | Path set: files changed in that commit (`git show --name-only --pretty=""`). File content: `git show <sha>:<path>`. Diff: `git diff <sha>^ <sha> -- <path>` (or `git show <sha>`). Supports `HEAD`, `HEAD~1`, tags, branch names, full SHAs. Post-factum review of a specific commit. | Post-factum audit ("did this commit pass?") |

   `--scope` and `--sha` are mutually exclusive. `--files` and `--dir` remain explicit overrides that bypass scope resolution. Untracked files (`??`) in `staged`/`uncommitted` scopes are NOT included until `git add` flips them to `A` — this preserves spec §16 "automatic activation for new files" on the first commit after staging.

   **Walk cap** (§3) applies only to `--scope all` and `check-breadth`. The other three scopes are bounded by git and do not walk.

2. Build (file × rule) matrix where Layer 1 matches.
3. Run reviewer pipeline (Section 6) per cell.
4. Aggregate per-file report, grouped by rule. Quick = verdicts only; thinking = verdicts + reasons + file:line refs.
5. Exit code per `enforcement` (soft → 0 always; hard → 1 on any reject).
6. Append to history: per (file, rule) verdict records, plus a single per-file summary record `{"type":"file-summary","file":"...","matched_rules":[...],"verdicts":{...}}` — so "file X was reviewed, no rules matched" is recoverable even when no per-cell records exist. For `--sha` scope, summary records include `"sha":"<resolved-sha>"` so history is correctly attributed.

### `autoreview-context`

1. Input: path (or multiple).
2. Evaluate Layer 1 triggers against `(path, content)` for each rule in local + remote rules.
3. Output: Markdown listing matching rules with `read: <abs-path>` pointers and one-line descriptions.
4. Agent reads those files with its Read tool and internalizes before writing code. Zero LLM call.

### `autoreview-guide`

1. Input: free-text intent.
2. For each rule, compute overlap score: keyword hits across `name` (×3), `description` (×2), first 200 chars of body (×1); divided by query token count.
3. Top N (default 5) with score above threshold → output with `read:` paths + one-line "why relevant".
4. Zero matches → "no relevant rules found, consider creating one via `/autoreview:create-rule`".
5. Zero LLM call in MVP. Optional future flag `--smart` for LLM rerank.

### `/autoreview:pull-remote`

1. Parse args: none → all sources; name → single source.
2. Per source: clone → copy subtree → wipe-and-replace `.autoreview/remote_rules/<name>/<ref>/`.
3. Progress line per source. Failed source → warning, continue.
4. End summary: "pulled N sources, M rule files".

**Sentinel-file semantics (migration-safe):**
- First pull to `<name>/<ref>/` — target dir missing, create, copy, write `.autoreview-managed` sentinel.
- Subsequent pull — if target dir exists AND `.autoreview-managed` present → safe to wipe-and-replace.
- Target dir exists, `.autoreview-managed` missing, contents are "AutoReview-shaped" — recursively all `.md` files and directories (directories may contain further `.md` or subdirs, no non-md leaf) → migrate silently (write sentinel on first successful pull; do not refuse on the assumption this is a pre-sentinel install from an older plugin version).
- Target dir exists, `.autoreview-managed` missing, contents include any non-md leaf (binary, `.yaml`, `.json`, etc.) → refuse wipe, print error: "path contains unexpected content, move it aside or delete it manually if you want to re-pull."

These three branches are mutually exclusive and exhaustive over "target dir exists without sentinel."

---

## 8. History, Suppress, Soft-Fail, Testing

### History format

`.autoreview/history/YYYY-MM-DD.jsonl`, append-only. Two record shapes, type-discriminated by the `type` field (required on both — `verdict` for per-cell records, `file-summary` for per-file summaries):

```json
{"type":"verdict","ts":"2026-04-20T14:32:01Z","file":"src/api/users.ts","rule":"api/validate-input","mode":"quick","provider":"claude-code","model":"haiku","verdict":"pass","duration_ms":1820}
{"type":"verdict","ts":"2026-04-20T14:32:03Z","file":"src/api/orders.ts","rule":"api/validate-input","mode":"thinking","provider":"anthropic","model":"claude-opus-4-7","verdict":"fail","reason":"...","duration_ms":3402,"reason_sidecar":".autoreview/history/2026-04-20/a3f1…reason.txt"}
{"type":"verdict","ts":"2026-04-20T14:32:05Z","file":"src/legacy.ts","rule":"shared/no-todo","mode":"quick","provider":"ollama","model":"qwen2.5-coder:7b","verdict":"suppressed","suppressed":[{"line":42,"reason":"refactor planned Q3"}]}
{"type":"file-summary","ts":"2026-04-20T14:32:10Z","file":"src/util/math.ts","matched_rules":[],"verdicts":{},"duration_ms":34}
{"type":"file-summary","ts":"2026-04-20T14:32:12Z","file":"src/api/users.ts","matched_rules":["api/validate-input"],"verdicts":{"api/validate-input":"pass"},"duration_ms":1830}
```

Example line 2 demonstrates a rule that overrode the active provider (`rule.provider: anthropic`) and references a `reason_sidecar` pointer because the full reasoning exceeded the in-record budget.

No retention policy. User manages manually. Written only when `config.history.log_to_file: true`.

**Long-reason sidecar:** when a thinking-mode `reason` would exceed the in-record 3500-byte budget (e.g. 10 violations each with file:line refs), the writer stores the full reason to `.autoreview/history/YYYY-MM-DD/<sha256>.txt` and records a `reason_sidecar` field in the JSONL line with the path, while `reason` in the JSONL is still the truncated head (first 500 chars + `[… see reason_sidecar]`). Avoids lossy truncation without inflating JSONL lines past atomicity bound.

**Concurrent-write safety:** history writer opens the file with `O_APPEND` and writes one record per `write()` syscall. POSIX guarantees atomicity of small appends only to pipes (up to `PIPE_BUF`, typically 4096 bytes). For regular files, Linux and macOS in practice guarantee atomicity of `O_APPEND` writes under ~4 KiB via per-inode locking, though this is a de-facto OS behavior, not a POSIX guarantee. AutoReview relies on it and sizes records accordingly:
- Per-record size cap: **3500 bytes total** (leaves headroom under 4 KiB for the envelope). `reason` truncated to whatever fits after `ts + file + rule + metadata` are serialized; truncation marker `[... reason truncated]` appended. If the combination of `file` (long path) + other metadata alone exceeds 3500 bytes, `file` is truncated from the left with `…/` prefix as last resort.
- Windows: behavior is less predictable; the design does not target Windows explicitly, and a concurrent-safety caveat is logged.

### Inline suppress (spec §27)

Supported comment styles:
```
// @autoreview-ignore <rule-id> <reason>
# @autoreview-ignore <rule-id> <reason>
<!-- @autoreview-ignore <rule-id> <reason> -->
```

Behavior encoded in the reviewer prompt (not enforced deterministically in engine — reviewer decides scope contextually):
- File-top marker → whole file
- In-function marker → that function
- Above-block marker → that block
- Reason mandatory, free-text, not validated

Operating-manual rule: **agent must never write a suppress without explicit user confirmation.** Agent may propose one; user provides / approves the reason. History records `suppressed[]` with line + reason when marker is honored.

### Exit codes

Two states (intentional departure from spec §28 three-state contract — see §9 "Departures from source spec"):
- `0` — pass OR soft-fail (warning on stderr, commit/review proceeds)
- `1` — hard fail (at least one rule rejected in hard enforcement, or internal error in hard mode)

Soft-fail matrix:

| Condition | Soft context | Hard context |
|---|---|---|
| `.autoreview/` missing | warn + exit 0 | warn + exit 0 |
| `config.yaml` missing | warn + exit 0 | warn + exit 0 |
| No API key / provider unreachable | warn + skip review + exit 0 | error per rule + exit 1 |
| `providerError` from subprocess | warn + continue other rules | error for affected rule + exit 1 if rejects |
| Malformed rule YAML | warn + skip rule + continue others | warn + skip rule + continue others |
| File too large | warn + skip file + continue | warn + skip file + continue |
| Internal tool crash | stderr traceback + exit 0 | stderr traceback + exit 1 |

Defaults: `enforcement.precommit: soft`, `enforcement.validate: hard`. Both configurable.

Distinction between "rule rejected" and "internal error" in hard-context exit 1 is carried on stderr (category prefix: `[reject]` vs `[error]`), not in the exit code. Tools consuming the exit code see a single failure bit; the stderr text carries detail. CI retry logic that needs to distinguish "tool crashed, retry" from "rule rejected, do not retry" MUST parse the stderr category prefix.

**Gateway semantics (spec §17)** are the combination of: `enforcement.<context>` controls exit code; verdicts + reasons stream to stderr with category prefixes; history records all verdicts. The gate is informational in `soft` mode (warnings, exit 0) and enforcing in `hard` mode (stderr errors, exit 1). No separate "gateway mode" toggle — `enforcement` is the toggle.

### Testing strategy

- **Unit tests** — `trigger-engine` (parser + matcher), `yaml-min`, `rule-loader`, `config-loader`. Pure functions, mocked fs where needed.
- **Integration tests** — reviewer pipeline with a stub provider that returns deterministic responses. Prompts captured and snapshotted.
- **E2E examples** — one example project in `examples/` (pattern from Yggdrasil), two rules (one pass, one deliberate fail), manual walkthrough of all skills.
- **Reviewer test harness** — `scripts/bin/reviewer-test.mjs` (port of Yggdrasil `reviewer-test.ts`). CLI interface: `--rule <id>` (required), `--file <path>` (required), `--provider <name>` (optional, overrides active provider), `--model <id>` (optional), `--mode quick|thinking`. Prints: raw prompt sent, raw response received, parsed verdict + reason, duration. Used for debugging model × rule × code combinations.
- **No CI on MVP.** Local manual validation. CI wiring deferred.

**`yaml-min.mjs` required test cases** (non-exhaustive; blockers for implementation):

- Top-level scalars: `key: value`, `key: "quoted"`, `key: 'single'`, `key: 42`, `key: true`, `key: null`
- Nested mapping 2-level: `review:\n  evaluate: diff\n  mode: quick`
- Nested mapping 3-level: `provider:\n  anthropic:\n    model: haiku`
- Inline mapping: `claude-code: { model: haiku }`
- Inline mapping nested inside block: `context_overrides:\n  precommit: { mode: quick, consensus: 1 }`
- List of scalars: `items:\n  - a\n  - b`
- Inline list: `items: [a, b, c]`
- List of mappings (block): `remote_rules:\n  - name: foo\n    url: "x"\n    ref: v1`
- Mixed-quote strings with internal quotes: `triggers: '(path:"src/**" OR content:"@X") AND NOT path:"test/**"'`
- Comments on line ends: `key: value  # comment`
- Blank lines and leading whitespace
- Block scalars with `|` (minimally — for rule body if referenced as YAML; the rule body itself is post-frontmatter raw markdown, so this is mostly for config use)

Explicitly NOT supported (parser errors gracefully): anchors (`&foo` / `*foo`), tags (`!!int`), folded scalars (`>`), multi-document streams (`---`).

---

## 9. Non-goals and departures from source spec

### Non-goals (from `docs/specification.md`)

- Cross-file architectural review — per-file only.
- Hosted backend / user accounts / cloud marketplace — none.
- PR review bot (GitHub/GitLab) — not in MVP.
- Linter replacement — AST static analysis remains out of scope.
- Model trainer / fine-tuning / embedding indices — off-the-shelf models only.

### Departures from source spec (intentional)

Three documented deviations. Each was a conscious trade-off during design; listed here so the implementation plan does not treat them as missing work.

**D1. Spec §15 "Agent pre-check" dropped (no hypothetical-content LLM verdict).**
The spec describes an operation where the agent asks "given path X with hypothetical content Y, would this pass?" before writing the file. This design replaces that LLM-based predict with `autoreview-context` (free, deterministic Layer 1 lookup) that returns matching rules and `read:` pointers. The agent (which is itself an LLM) reads the rules and self-guides before writing — no second LLM call.
*Rationale:* a full hypothetical review doubles LLM cost on every write while rarely changing the written code more than rule-reading would. Precheck value is in giving the agent the rules, not in having a second LLM re-judge a first LLM's draft. `validate --files <path>` remains available for a one-shot review of actual written content.
*Consequence:* spec success criterion 5 ("predicted verdict in under 5 seconds") is not achievable in its literal form. The design instead targets a substitute metric: **`autoreview-context` returns matching rules and read-pointers in under 1 second** for typical repos (< 5000 source files walked under `.gitignore`, O(10²) rules). This is the new measurable pre-write latency gate.

**D2. Spec §28 three-state exit contract reduced to two.**
Spec requires `0` / `1` / `2` (pass / reject / internal error). This design uses `0` / `1` only. The reject vs. error distinction is carried on stderr (`[reject]` / `[error]` prefixes).
*Rationale:* consumers of the pre-commit exit code only care about "proceed or block". Shell scripts checking `$?` for `== 2` are rare; the distinction is more useful as a stderr category than as an exit code bit.
*Consequence:* callers who need to distinguish reject vs. error machine-readably must parse stderr categories rather than branch on exit code. Explicitly: **CI retry logic must parse stderr** to avoid retrying hard rule rejections; retrying is only safe on `[error]`-prefixed lines.

**D3. Spec §13 standalone CLI and §14 separate API surface folded into plugin.**
Spec describes CLI + API + skill as symmetric surfaces. This design makes the plugin the only distribution unit. `scripts/bin/*.mjs` are node entry points invoked by slash commands, hooks, and the git pre-commit hook — they are effectively the "CLI" and "API" but not published as a standalone binary or an installable library. This also reframes the product positioning: AutoReview is a Claude Code plugin first, not a language-agnostic CLI tool that happens to ship a Claude skill.
*Rationale:* keeps distribution simple (`/plugin install <name>`), avoids npm-package maintenance, and honors the user's intent expressed early in design ("samowystarczalna jednostka").
*Consequence:* external callers (IDE extensions, CI) that want to invoke AutoReview outside Claude Code must either install the plugin and call `.autoreview/runtime/bin/validate.mjs` directly, or wait for a future standalone distribution. CI via the pre-commit hook works as-is.
*Public-interface contract:* `.autoreview/runtime/bin/validate.mjs` is treated as a **semi-public interface** — its CLI flags (`--scope`, `--context`, `--rule`, `--files`, `--dir`, `--mode`) and exit-code contract are stable within the same plugin major version. Breaking flag changes require a plugin major bump. Non-flag behaviors (prompt text, provider list) are internal.

---

## 10. Decisions deferred to implementation

- Exact retry/backoff constants for HTTP providers (attempts, initial delay, factor, jitter).
- Per-provider `context_window_bytes: auto` resolution table. Proposal (non-binding):
  - `ollama` — query `model_info` at load; fallback 32768 bytes (~8K tokens).
  - `anthropic` — 200K tokens × 4 = 800000 bytes (Claude 4.x context).
  - `openai` — 128K tokens × 4 = 512000 bytes.
  - `google` — 1M tokens × 4 = 4000000 bytes (Gemini long context).
  - `openai-compat` — conservative 16384 bytes fallback; configurable per endpoint.
  - `claude-code` / `codex` / `gemini-cli` — inherit from their binaries where reported, else the corresponding API provider default.
- Git worktree / subtree strategy for remote-rules pull edge cases (sparse-checkout vs full clone + copy). MVP goes full clone + copy.
- Guide skill keyword tokenization details (stop words, stemming, mixed-language handling).
- CLAUDE.md append fallback format — used only if SessionStart stdout injection proves unstable in some Claude Code version. Verified working as of 2026-04; fallback not active by default.
- Calibration of `PROMPT_BOILERPLATE_BYTES` chunking constant — measure against the actual prompt template during implementation.
- Actual token-cost measurement for SessionStart-injected operating manual; stay under 800-token target, hard reject above 1200.
- Walk cap default (`review.walk_file_cap: 10000`) may need to be lifted or auto-scaled for large monorepos — revisit after first real-repo test.
