# AutoReview

**A rule file is a suggestion. This turns it into a verdict on every commit.**

Per-file architecture gates for your coding agent. Write rules in plain English Markdown; a reviewer verifies each file against the rules that match it, on every commit. Matching runs locally; the reviewer runs on a local Ollama or any API model.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522-green.svg)](https://nodejs.org)
[![Zero deps](https://img.shields.io/badge/npm%20deps-0-blue.svg)](./package.json)

---

I built this after getting annoyed at my agent skipping audit logging on a payment mutation for the third time. CLAUDE.md said to emit audit events. Agent read it. Agent skipped it. Tests passed. I only caught it because I happened to diff that specific file.

A rules file is a suggestion. There are no consequences for ignoring it. This is the reviewer that turns it into a rule.

## Quickstart

Three steps, in order:

1. **Install Ollama** (or skip to step 2 if you're using a paid API). Grab it from https://ollama.ai, then `ollama serve &` in a terminal.
2. **Install the plugin in Claude Code:** `/plugin install autoreview`. Nothing happens to your repo yet — plugin install alone is inert.
3. **Scaffold AutoReview in your repo:** `/autoreview:setup` (or just ask the agent to "set up autoreview with ollama and install the pre-commit hook"). The skill probes for Ollama, asks which model to use, and runs `init.mjs` to create `.autoreview/`, install the git pre-commit hook, and ship one example rule.

Three things to know before your first commit:

- **`severity: error` rules block.** A `[reject]` or `[error]` (including provider unreachable) on a `severity: error` rule causes exit 1. Rules default to `severity: error`. Mark rules `severity: warning` to warn without blocking.
- **Nothing runs until step 3.** Only the setup skill drops the hook and scaffolds config. If you see no verdicts on commit, setup hasn't run.
- **What leaves your machine.** Ollama keeps everything local. Paid providers (Anthropic/OpenAI/Google/openai-compat) receive the full file content plus the matching rule body on each call. Trigger matching runs locally — files that match no rule never leave the box.

To add your first rule, just tell the agent: `"add a rule that forbids console.log in production code"` — it'll walk you through the 7-step wizard and save the rule at `.autoreview/rules/`.

After setup, the agent reads [templates/agent-rules.md](templates/agent-rules.md) (copied into your repo at install time) and uses that as its operating manual for AutoReview skills. You don't need to memorize anything; just talk to the agent.

## The problem

You wrote rules in CLAUDE.md. Your agent applies maybe 70% of them. The rest it "optimizes away" because it decided they're noise. You tell it again, it does better for a while. Next session, same thing.

Tests pass. Lint passes. But the handler skipped audit logging, called a service it shouldn't, used `Date.now()` in a deterministic module. You find out in a PR with 50 changed files. Or you don't.

## How AutoReview is different from a regular Claude Code skill

A normal skill is static text injected into the agent's context. "Here's how this library works, use it when relevant." Passive. Informational. The agent can read it and ignore it, same as CLAUDE.md.

AutoReview is not that. It runs an actual reviewer LLM against the code after it's written. The verdict is concrete. Pass or fail per rule. If a rule rejects, the commit blocks.

The skill surface just wires it in. The enforcement happens in the reviewer loop.

| Regular skill | AutoReview |
|---|---|
| Text in the agent's context | LLM reviewer against the file |
| Agent decides if it matters | Verdict per rule |
| No verification | Verified on every commit |
| "Hint" | Gate |

## How AutoReview is different from Yggdrasil

AutoReview and [Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil) share the same reviewer loop. AutoReview stays per-file with a trigger-matched Markdown rule. Yggdrasil adds a graph of components, flows, and cross-file aspects on top.

| | Yggdrasil | AutoReview |
|---|---|---|
| Scope | Cross-file, graph-aware | Per-file only |
| Setup | Map your codebase | Write a Markdown rule |
| CI | Hash-based incremental verify | Pre-commit hook or `validate` |
| Distribution | npm package with CLI | Claude Code plugin with CLI |
| Deps | Node + a bunch | Node, zero npm deps |

Use AutoReview when you want one rule on one file. Reach for Yggdrasil when rules need to reason across files.

## What a rule looks like

```md
---
name: "API Controllers Validate Input"
triggers: '(path:"src/api/**/*.ts") AND content:"@Controller"'
tier: standard
severity: error
type: auto
---
Every controller must validate input with zod before processing.
Reject with HTTP 400 if validation fails.
Log rejection with correlation-id.
```

Trigger picks the files. Body is the rule in plain English. `tier` picks the cost/quality tier (defaults to `default`). `severity: error` blocks the commit on reject or provider error; `severity: warning` prints a warning and lets the commit proceed. `type: auto` means the hook runs it automatically; `type: manual` means it only runs when explicitly invoked via `--rule <id>`. All three frontmatter fields are optional — defaults are `tier: default`, `severity: error`, `type: auto`.

## Trigger DSL cheatsheet

All triggers are evaluated locally (zero LLM cost) before the reviewer runs. Supported predicates and operators:

| Syntax | Meaning | Example |
|---|---|---|
| `path:"<glob>"` | match repo-relative path | `path:"src/api/**/*.ts"` |
| `dir:"<path>"` | shorthand for `path:"<path>/**"` | `dir:"src/api"` |
| `content:"<regex>"` | JavaScript regex against file contents | `content:"@Controller"` |
| `AND` / `OR` / `NOT` | boolean operators (case-insensitive) | `path:"**/*.ts" AND content:"fetch\\("` |
| `( ... )` | grouping | `(dir:"src" OR dir:"lib") AND NOT path:"**/*.test.ts"` |
| `{a,b,c}` | brace expansion inside globs | `path:"src/{api,handlers}/**/*.ts"` |
| `**` | match zero or more path segments | `path:"src/**/*.ts"` (any depth) |

The `autoreview:create-rule` wizard runs a breadth check on your draft trigger as step 3 — match count plus the first 10 sample paths, zero LLM cost. REDoS-prone regexes (`(a+)+`) are rejected at compile time; oversized binary files are auto-skipped for `content:` predicates.

## What happens on commit

```
git commit
  ↓
pre-commit hook
  ↓
for each staged file, find auto rules that match the trigger
  ↓
send file + matched rule to reviewer (tier's provider/model)
  ↓
[pass] src/api/users.ts :: api/validate-input
[reject] src/api/orders.ts :: api/validate-input
    reason: charge() mutates state without zod validation (line 42)
  ↓
severity: error rules → exit 1 (commit blocked)
severity: warning rules → exit 0 ([warn] printed, commit proceeds)
```

Triggers are deterministic. No LLM call for trigger matching. Only files with matching rules go to the reviewer. No matches, zero cost.

## Getting started

```
/plugin install autoreview
/autoreview:setup
```

First command installs the plugin in Claude Code. Second invokes the setup skill — it probes for Ollama, asks the user which model and provider to use, and runs `init.mjs` to scaffold `.autoreview/` and install the git pre-commit hook (with explicit confirmation).

For paid providers, just tell the skill — e.g. "set up autoreview with anthropic". Then paste your key into `.autoreview/config.secrets.yaml`. That file is gitignored.

Write your first rule:

```
You:    "All command handlers must emit audit events before returning."
Agent:  Runs the 7-step wizard. Proposes a trigger, shows which files
        match, test-drives the rule on a sample file, then writes it.
```

The 7 steps the agent walks through:
1. **Convention** — clarify exactly what you want enforced.
2. **Name + trigger** — grep the repo layout, propose a `path:`/`dir:`/`content:` trigger.
3. **Breadth check** — run the trigger locally, show match count + first 10 files. Iterate until the set is right.
4. **Pass/fail samples** — read 2–3 matched files, reason about whether they'd pass the draft body.
5. **Tier selection** — pick the cost/quality tier (`default`, `trivial`, `standard`, `heavy`, `critical`). Reads your actual `tiers:` config and explains cost/time per tier.
6. **Test-drive** — run the actual reviewer against sample files using the selected tier. Adjust body if verdicts are wrong.
7. **Save** — write `.autoreview/rules/<id>.md`.

Commit. Hook runs. Done.

## Escape hatches

When a rule blocks something that shouldn't be blocked, three options in order of preference:

1. **Suppress one site.** Add `// @autoreview-ignore <rule-id> <why>` above the offending block (or function, or file top). Reason is mandatory. The reviewer honors scope from where the marker sits — see the [Inline suppressions](#inline-suppressions) section below.
2. **Downgrade to warning.** Set `severity: warning` in the rule's frontmatter (local) or via `/autoreview:override-rule` (remote rule). You'll still see `[warn]` lines but commits won't block.
3. **Last resort.** `git commit --no-verify` bypasses the hook entirely for one commit. Leaves no audit trail in history. Use for true emergencies.

When a rule is plain wrong, edit it — rules are markdown. `.autoreview/rules/<id>.md` opens in any editor; delete the file to remove the rule; change the body to fix the check; change the `triggers:` line to narrow scope. `/autoreview:create-rule` runs the quality-guarded wizard for new rules, but editing existing ones is a plain file edit.

## review vs. pre-commit context

Same engine, same severity exit policy:

| | pre-commit hook | `/autoreview:review` |
|---|---|---|
| scope default | staged files only | uncommitted (staged + modified + untracked) |
| `type: manual` rules | skipped | skipped (unless `--rule <id>` supplied) |
| consensus | per-tier `consensus:` setting | per-tier `consensus:` setting |

Both contexts block on `severity: error` rules' `[reject]` and `[error]` verdicts (exit 1). Both let `severity: warning` verdicts through (exit 0).

Override scope via `--scope all`; change mode or reasoning effort by editing the tier in `.autoreview/config.yaml`.

## Pre-check before the agent writes

The agent can ask "would this pass?" before writing the file to disk. Pass a draft in, get a verdict back, no disk write.

In Claude Code, the `autoreview:precheck` skill wraps this — invoke it with the draft content and target path. The agent uses it to avoid writing code it would have to immediately rewrite after the reviewer rejects.

Or from any shell (after setup has scaffolded `.autoreview/runtime/`):
```bash
node .autoreview/runtime/bin/reviewer-test.mjs \
  --rule <rule-id> \
  --file src/api/users.ts \
  --content-file <tmpdir>/draft.ts
```

Use `node -e "console.log(require('os').tmpdir())"` to get a writable tmp dir on any platform. Mode and reasoning effort are set in the tier config, not as flags.

## On-demand review

```
/autoreview:review              uncommitted files, thinking mode
/autoreview:review --scope all  full repo sweep
/autoreview:review --sha HEAD~1 re-run the reviewer against a past commit
/autoreview:history --sha HEAD~1  look up a past commit in the log (free — no LLM call)
```

`review --sha` re-runs the reviewer against the commit's tree. `history --sha` queries `.autoreview/.history/*.jsonl` for what the reviewer already decided when that commit was actually reviewed. Prefer history when you just want to know "did my last commit pass?" — no tokens spent.

## Editing rules

Rules are plain Markdown files at `.autoreview/rules/<id>.md`. Open one in your editor to change the body or the `triggers:` line; delete the file to remove the rule. `/autoreview:create-rule` runs the quality-guarded wizard for *new* rules only.

- **Change what's enforced** → edit the body in `.autoreview/rules/<id>.md`.
- **Change which files it applies to** → edit the `triggers:` line in the frontmatter.
- **Turn one rule off temporarily** → set `type: manual` in the rule frontmatter (local) or via `/autoreview:override-rule` (remote). Manual rules only run when explicitly invoked via `--rule <id>`.
- **Remove entirely** → delete the file.

No re-init, no rebuild. The next commit picks up the change.

## Skills (agent-first surface)

The plugin exposes 9 skills — every skill has a rich `description: Use when…` trigger so the agent picks the right one based on user intent. Users typically don't invoke skills directly; they ask the agent in plain language ("set up autoreview", "what rules apply here?", "did my last commit pass?") and the agent picks the matching skill.

- `autoreview:setup` — scaffold `.autoreview/` in a repo, probe Ollama / models, install pre-commit hook. Explains tier model and overlay model during setup.
- `autoreview:create-rule` — 7-step guided rule wizard (convention → trigger → breadth check → samples → tier selection → test-drive → save).
- `autoreview:context` — list rules matching a path, showing effective frontmatter post-overlay; marks `[manual]` and `[invalid]` rules (pre-write, free).
- `autoreview:guide` — find rules by free-text intent (free).
- `autoreview:precheck` — verdict on a draft not yet on disk (1 LLM call per rule).
- `autoreview:review` — run the reviewer on existing files; debug a blocked commit. Pass `--rule <id>` for manual rules.
- `autoreview:history` — query the review log (verdict counts, recent records, `--tier`/`--severity` filters, free).
- `autoreview:pull-remote` — fetch / refresh remote rule sources.
- `autoreview:override-rule` — wizard for remote-rule overlays (change tier, severity, type, triggers without forking upstream).

Each skill body documents its CLI invocation (always `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/<X>.mjs`) and platform notes. The pre-commit hook calls `validate.mjs` directly — independent of the skill surface.

## Providers

**Local:** Ollama. Default. Offline, free, private.

**API:** Anthropic, OpenAI, Google, any OpenAI-compatible endpoint.

**Agent CLI:** Claude Code, Codex, Gemini CLI. Uses whichever agent binary is on your `$PATH` as the reviewer.

Provider is declared per-tier, not globally. Rules declare a `tier:` (logical cost band); tiers map to a concrete provider+model. Changing vendors is a config edit, not a rule rewrite.

### Tiers

Each tier is a self-contained config block. Example:

```yaml
tiers:
  default:
    provider: ollama
    model: qwen2.5-coder:7b
    endpoint: http://localhost:11434
    parallel: 1
    mode: quick
  standard:
    provider: anthropic
    model: claude-haiku-4-5
    parallel: 10
  critical:
    provider: anthropic
    model: claude-sonnet-4-5
    mode: thinking
    reasoning_effort: high
```

Five allowed tier names: `default` (mandatory), `trivial`, `standard`, `heavy`, `critical`. Rules without an explicit `tier:` use `default`. Defining a tier is opt-in — repos only add the tiers their rules reference.

The `parallel` field (positive integer) caps concurrent in-flight calls for that tier. Defaults: `ollama: 1`, `openai-compat: 5`, `anthropic`/`openai`/`google: 10`, `claude-code`/`codex`/`gemini-cli: 3`.

`mode` is `quick` (pass/fail JSON) or `thinking` (chain-of-thought + file:line references). `reasoning_effort` (`low`|`medium`|`high`) activates native reasoning APIs where supported (Anthropic, OpenAI reasoning models); silently ignored by Ollama, openai-compat, CLI providers.

When a paid provider returns `429` (rate limited) or `408` (request timeout), the call retries with exponential backoff up to 4 attempts, honouring any `Retry-After` header (capped at 30s). Each retry emits one `[warn]` line on stderr.

## Modes

**Quick** is pass/fail only. `{"satisfied": true|false}` and nothing else.

**Thinking** returns `{satisfied, reason, suppressed[]}` with file:line references.

Mode is set per-tier in `config.yaml` (`mode: quick` or `mode: thinking`). There are no `--mode` or `--reasoning-effort` CLI flags — change the tier config instead. `output_max_tokens` (default `0` = no cap) is also a per-tier field.

## Inline suppressions

When a rule genuinely doesn't apply here:

```ts
// @autoreview-ignore api/validate-input payload is already schema-validated upstream
export function passthroughRoute() { /* ... */ }
```

Reason is mandatory. The reviewer decides scope from where the marker sits. File top is the whole file, above a function is that function, above a block is that block. History logs it as `verdict: 'suppressed'` with the reason.

Agent is instructed to never write a suppression without your okay.

## Configuration

Three files:

- `.autoreview/config.yaml` is committed. Team-shared baseline.
- `.autoreview/config.personal.yaml` is gitignored. Per-developer overrides.
- `.autoreview/config.secrets.yaml` is gitignored. API keys only (keyed by provider type: `anthropic`, `openai`, `google`, `openai-compat`).

Personal config deep-merges over repo config. Common pattern: team defines `tiers.heavy: claude-sonnet`; a developer's personal config sets `tiers.heavy.model: claude-opus-4-7` to upgrade locally.

Two per-tier knobs worth knowing about:

- `context_window_bytes` — defaults to `auto` (each adapter returns its best guess). `openai-compat` hard-codes 16 kB, way too small for modern long-context models. Override with the real byte budget: `160000` for Qwen3.6-35B, whatever your model actually supports. Too low and the chunker truncates or skips big files.
- `output_max_tokens` — defaults to `0` = no cap. Local servers finish naturally, paid APIs use the provider's default. Raise it only to force a ceiling on Anthropic/OpenAI output-token spend.

## Remote rules

One team maintains shared rules in a single repo. Every product repo pins a tag and pulls them in. Update the tag to roll out changes.

```yaml
remote_rules:
  - name: company-shared
    url: "https://github.com/acme/review-rules.git"
    ref: "v1.2.0"
    path: "rules/"
    overrides:
      audit-log-on-handlers:
        tier: standard       # downstream from corp's heavy
        severity: warning    # warn-only for this repo
      legacy-perf-rule:
        type: manual         # dormant — requires explicit --rule to invoke
```

`/autoreview:pull-remote` clones the pinned ref into `.autoreview/remote_rules/`. Remote rules are pulled explicitly — no auto-pull setting.

**Overlays** (`remote_rules[].overrides`) let you adapt upstream frontmatter (`tier`, `severity`, `type`, `triggers`, `name`, `description`) without forking the rule source. The `/autoreview:override-rule` wizard walks you through adding an overlay with a breadth check and test-drive. Overrides in `config.personal.yaml` stack on top of repo overrides; the reviewer always sees the fully-merged effective frontmatter.

## CI integration

Drop [templates/ci-github-actions.yml](templates/ci-github-actions.yml) into `.github/workflows/autoreview.yml`. It installs Ollama + Qwen, runs `validate.mjs --scope uncommitted` against PR diffs, and exits 1 on any `severity: error` reject or error. Swap the Ollama steps for an API-key secret to use Anthropic/OpenAI/Google. Set `mode: thinking` in the relevant tier config to get file:line reasoning in CI logs.

## For teams

Rules live in your repo. Personal config lives on your machine. API keys live in a gitignored file.

- Commit `config.yaml` and the `rules/` directory with the rest of your code. Everyone on the team gets the same baseline.
- Pull remote rules from a shared git repo. One team manages standards, many product repos use them.
- Override per-developer in `config.personal.yaml` without touching the team config. Swap reviewer, raise reasoning effort, enable extra rules locally.
- History log records provider, model, rule, verdict, and reason per review. Audit trail for every run.

**Onboarding a new dev.** After `git clone`, each developer asks the agent to run `autoreview:setup --upgrade --install-precommit` (or types `/autoreview:setup --upgrade --install-precommit`). The `--upgrade` is safe on an already-set-up clone; without it, the underlying init bails out assuming setup is already done. If the repo already uses Husky or another pre-commit manager, pass `--precommit-append` so AutoReview's hook runs alongside the existing one instead of replacing it.

**Centralized audit trail.** The history log (`.autoreview/.history/*.jsonl`) is gitignored by default — it's per-machine. For a team-wide view, upload the jsonl from CI as an artifact or ship it to a log aggregator. Records carry `actor` (git email), `host`, `ci_run_id`, `commit_sha`, and token `usage` so you can aggregate spend and attribute verdicts across machines.

## Exit codes

- `0` all pass/warn, or no matching rules
- `1` at least one `severity: error` rule produced `[reject]` or `[error]` (including provider unreachable)
- `2` internal tool error, not a rule verdict

Rules default to `severity: error`. Mark a rule `severity: warning` to make it non-blocking.

CI that needs to distinguish crashed-tool from rule-rejected parses stderr. `[reject]` and `[warn]` are rule verdicts. `[error]` is either a rule verdict (provider/tier failure for a `severity: error` rule) or a tool error — the text identifies which.

## The tool never blocks a broken setup

No Ollama running, no API key, no config. If config is missing or fails to parse, the hook warns on stderr and exits 0. A `severity: error` rule whose tier's provider is unreachable produces an `[error]` verdict and exits 1 — this is intentional signal that the review couldn't run.

## FAQ

**How is this different from CLAUDE.md or .cursorrules?**
Those are text dumps. Agent reads them and ignores 30%. AutoReview runs a reviewer LLM against the code and emits a concrete verdict per rule. The gate is verified, not suggested.

**How is this different from a linter?**
Linters check syntax and AST patterns. "Must emit audit event before returning" isn't an AST thing. "No direct DB access from this layer" isn't either. AutoReview's rule language is whatever you can describe in English.

**How is this different from a PR review?**
PR review catches violations after the agent moved on. AutoReview catches them on commit, same session. Faster feedback, less context loss.

**What's the cost?**
With Ollama, zero. With paid APIs, proportional to matched files times matched rules. Most files match 2 to 3 rules.

**Can I scope rules to a directory?**
Yes. `dir:"src/api"` is shorthand for `path:"src/api/**"`.

**What if I want to stop?**
Delete `.autoreview/` and the pre-commit hook. No runtime dependencies, no build hooks, nothing left behind.

**Is this just another AI code review bot?**
No. AI code review bots scan diffs post-hoc. AutoReview runs a reviewer against specific rules you wrote, on every commit, per file. No rules match — nothing runs, nothing costs. The rules are yours; AutoReview is the gate that makes them actually enforceable.

## Docs

- [SECURITY.md](SECURITY.md) — data flow, sandboxing, fail-open invariants, prompt-injection surface.
- [Functional spec](docs/specification.md), the 29-point contract.
- [Implementation design](docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md).

## Testing

```
npm test              # unit (lib + bin + plugin + api), fast, no LLM
npm run test:e2e      # e2e against an OpenAI-compat server (your local LLM)
npm run test:ollama   # one round-trip against a real local Ollama daemon
npm run test:all      # unit + e2e in one command
npm run coverage      # 90% lines/branches/functions gate
```

`test:e2e` and `coverage` load `.env` (Node 22 `--env-file-if-exists`). Copy `.env.example` to `.env` and point `AUTOREVIEW_E2E_ENDPOINT` / `AUTOREVIEW_E2E_MODEL` at your local server (defaults target `127.0.0.1:8089`). Each e2e test guards itself with `serverAvailable()` and skips cleanly when the endpoint is unreachable.

`test:ollama` exercises the Ollama connector (`tests/e2e/real-ollama.test.mjs`). It needs the daemon up and a model pulled; a tiny one is enough:

```
ollama pull qwen2.5-coder:0.5b
AUTOREVIEW_REAL_MODEL=qwen2.5-coder:0.5b npm run test:ollama
```

Optional overrides: `OLLAMA_HOST` (default `http://localhost:11434`), `AUTOREVIEW_REAL_MODEL` (default `qwen2.5-coder:7b`).

## License

MIT

---

<div align="center">
  <img src="yggdrasil.svg" alt="AutoReview" width="120" />
  <br/><br/>
  <sub>Part of the <a href="https://github.com/krzysztofdudek/Yggdrasil">Yggdrasil</a> family. Questions? Open an issue.</sub>
</div>
