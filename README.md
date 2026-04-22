# AutoReview

**A rule file is a suggestion. This turns it into a verdict on every commit.**

An LLM reviewer that reads one file at a time and checks it against Markdown rules you wrote in plain English.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green.svg)](https://nodejs.org)
[![Zero deps](https://img.shields.io/badge/npm%20deps-0-blue.svg)](./package.json)

---

I built this after getting annoyed at my agent skipping audit logging on a payment mutation for the third time. CLAUDE.md said to emit audit events. Agent read it. Agent skipped it. Tests passed. I only caught it because I happened to diff that specific file.

A rules file is a suggestion. There are no consequences for ignoring it. This is the reviewer that turns it into a rule.

## Quickstart

Three steps, in order:

1. **Install Ollama** (or skip to step 2 if you're using a paid API). Grab it from https://ollama.ai, then `ollama serve &` in a terminal.
2. **Install the plugin in Claude Code:** `/plugin install autoreview`. Nothing happens to your repo yet — plugin install alone is inert.
3. **Scaffold AutoReview in your repo:** `/autoreview:init --provider ollama --install-precommit`. This creates `.autoreview/`, installs the git pre-commit hook, and ships one example rule.

Three things to know before your first commit:

- **Soft by default.** Pre-commit warns on `[reject]` but still lets the commit through. Flip to blocking by setting `enforcement.precommit: hard` in `.autoreview/config.yaml`.
- **Nothing runs until step 3.** Only `init` drops the hook and scaffolds config. If you see no verdicts on commit, `init` hasn't run.
- **What leaves your machine.** Ollama keeps everything local. Paid providers (Anthropic/OpenAI/Google/openai-compat) receive the full file content plus the matching rule body on each call. Trigger matching runs locally — files that match no rule never leave the box.

To add your first rule, just tell the agent: `"add a rule that forbids console.log in production code"` — it'll walk you through the 7-step wizard and save the rule at `.autoreview/rules/`.

After init, the agent reads [templates/agent-rules.md](templates/agent-rules.md) (copied into your repo at install time) and uses that as its operating manual for AutoReview commands. You don't need to memorize anything; just talk to the agent.

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
---
Every controller must validate input with zod before processing.
Reject with HTTP 400 if validation fails.
Log rejection with correlation-id.
```

Trigger picks the files. Body is the rule in plain English. That's the whole format.

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

Use `/autoreview:check-breadth --expr '<your-trigger>'` to see how many files it hits before you save the rule. REDoS-prone regexes (`(a+)+`) are rejected at compile time; oversized binary files are auto-skipped for `content:` predicates.

## What happens on commit

```
git commit
  ↓
pre-commit hook
  ↓
for each staged file, find rules that match the trigger
  ↓
send file + matched rule to reviewer (Ollama by default)
  ↓
[pass] src/api/users.ts :: api/validate-input
[reject] src/api/orders.ts :: api/validate-input
    reason: charge() mutates state without zod validation (line 42)
  ↓
commit warns but proceeds by default (soft mode).
Set `enforcement.precommit: hard` in config.yaml to actually block.
```

Triggers are deterministic. No LLM call for trigger matching. Only files with matching rules go to the reviewer. No matches, zero cost.

## Getting started

```
/plugin install autoreview
/autoreview:init --provider ollama --install-precommit
```

First command installs the plugin in Claude Code. Second scaffolds `.autoreview/` in your repo and installs the git pre-commit hook. You have to pass `--install-precommit` explicitly. Nothing runs interactively.

For paid providers:

```
/autoreview:init --provider anthropic --install-precommit
```

Then paste your key into `.autoreview/config.secrets.yaml`. That file is gitignored.

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
5. **Intent trigger?** — offer a Layer-2 NL gate (only when `intent_triggers: true` in config).
6. **Test-drive** — run the actual reviewer against sample files. Adjust body if verdicts are wrong.
7. **Save** — write `.autoreview/rules/<id>.md`.

Commit. Hook runs. Done.

## Escape hatches

When a rule blocks something that shouldn't be blocked, three options in order of preference:

1. **Suppress one site.** Add `// @autoreview-ignore <rule-id> <why>` above the offending block (or function, or file top). Reason is mandatory. The reviewer honors scope from where the marker sits — see the [Inline suppressions](#inline-suppressions) section below.
2. **Soft mode for the session.** Flip `enforcement.precommit: soft` in `config.personal.yaml` (gitignored). You'll still see `[reject]` lines but commits won't block. Team stays on `hard` via `config.yaml`.
3. **Last resort.** `git commit --no-verify` bypasses the hook entirely for one commit. Leaves no audit trail in history. Use for true emergencies.

When a rule is plain wrong, edit it — rules are markdown. `.autoreview/rules/<id>.md` opens in any editor; delete the file to remove the rule; change the body to fix the check; change the `triggers:` line to narrow scope. `/autoreview:create-rule` runs the quality-guarded wizard for new rules, but editing existing ones is a plain file edit.

## validate vs. pre-commit context

Same engine, different defaults:

| | pre-commit hook | `/autoreview:validate` |
|---|---|---|
| enforcement default | **soft** (warn, commit proceeds) | **hard** (reject exits 1) |
| scope default | staged files only | uncommitted (staged + modified + untracked) |
| mode default | quick (pass/fail only) | thinking (reason with file:line) |
| consensus cap | always 1 (budget guard) | whatever config says |

Override any default via flags (`--scope all`, `--mode thinking`, `--context validate`).

## Pre-check before the agent writes

The agent can ask "would this pass?" before writing the file to disk. Pass a draft in, get a verdict back, no disk write.

In Claude Code:
```
/autoreview:validate --content-file /tmp/draft.ts --target-path src/api/users.ts
```

Or from any shell (after `init` has scaffolded `.autoreview/runtime/`):
```bash
node .autoreview/runtime/bin/validate.mjs \
  --content-file /tmp/draft.ts \
  --target-path src/api/users.ts
```

Skill `autoreview-precheck` wraps this for Claude Code. Agent uses it to avoid writing code it would have to immediately rewrite after the reviewer rejects.

## On-demand review

```
/autoreview:validate              uncommitted files, thinking mode
/autoreview:validate --scope all  full repo sweep
/autoreview:validate --sha HEAD~1 re-run the reviewer against a past commit
/autoreview:history --sha HEAD~1  look up a past commit in the log (free — no LLM call)
```

`validate --sha` re-runs the reviewer against the commit's tree. `history --sha` queries `.autoreview/.history/*.jsonl` for what the reviewer already decided when that commit was actually reviewed. Prefer history when you just want to know "did my last commit pass?" — no tokens spent.

## Editing rules

Rules are plain Markdown files at `.autoreview/rules/<id>.md`. Open one in your editor to change the body or the `triggers:` line; delete the file to remove the rule. `/autoreview:create-rule` runs the quality-guarded wizard for *new* rules only.

- **Change what's enforced** → edit the body in `.autoreview/rules/<id>.md`.
- **Change which files it applies to** → edit the `triggers:` line in the frontmatter.
- **Turn one rule off temporarily** → add the id under `rules.disabled:` in `config.yaml` (team) or `config.personal.yaml` (just you).
- **Remove entirely** → delete the file.

No re-init, no rebuild. The next commit picks up the change.

## Other commands

- `/autoreview:init` — scaffold `.autoreview/` in a repo.
- `/autoreview:create-rule` — 7-step guided rule wizard.
- `/autoreview:context <path>` — list rules matching a path (pre-write).
- `/autoreview:check-breadth --expr '<expr>'` — test a trigger without the reviewer.
- `/autoreview:guide <query>` — find rules by free-text intent.
- `/autoreview:pull-remote [<name>]` — fetch remote rule sources.
- `/autoreview:history` — query review log (verdict counts, recent records).

## Providers

**Local:** Ollama. Default. Offline, free, private.

**API:** Anthropic, OpenAI, Google, any OpenAI-compatible endpoint.

**Agent CLI:** Claude Code, Codex, Gemini CLI. Uses whichever agent binary is on your `$PATH` as the reviewer.

Per-rule override. Cheap model for trivial rules, stronger model for the one that matters.

## Modes

**Quick** is pass/fail only. `{"satisfied": true|false}` and nothing else. Default for pre-commit.

**Thinking** returns `{satisfied, reason, suppressed[]}` with file:line references and configurable reasoning effort. Default for manual validate.

Both modes share one output cap: `review.output_max_tokens`. Default `0` = no cap (models finish naturally). Raise only if you want to bound spend on a paid API.

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
- `.autoreview/config.secrets.yaml` is gitignored. API keys only.

Personal config overrides repo config for any key. Switch provider on your machine, enable intent triggers locally, whatever.

Two knobs worth knowing about under `review:`:

- `context_window_bytes` — defaults to `auto` (each adapter returns its best guess). `openai-compat` hard-codes 16 kB, way too small for modern long-context models. Override with the real byte budget: `160000` for Qwen3.6-35B, whatever your model actually supports. Too low and the chunker truncates or skips big files.
- `output_max_tokens` — defaults to `0` = no cap, in both quick and thinking mode. Local servers finish naturally, paid APIs use the provider's default. Raise it only to force a ceiling on Anthropic/OpenAI output-token spend.

## Remote rules

One team maintains shared rules in a single repo. Every product repo pins a tag and pulls them in. Update the tag to roll out changes.

```yaml
remote_rules:
  - name: company-shared
    url: "https://github.com/acme/review-rules.git"
    ref: "v1.2.0"
    path: "rules/"
```

`/autoreview:pull-remote` clones the pinned ref into `.autoreview/remote_rules/`. Set `review.remote_rules_auto_pull: true` to refresh on every review run.

## CI integration

Drop [templates/ci-github-actions.yml](templates/ci-github-actions.yml) into `.github/workflows/autoreview.yml`. It installs Ollama + Qwen, runs `validate.mjs --scope uncommitted --mode thinking` against PR diffs, fails the job on reject under hard enforcement. Swap the Ollama steps for an API-key secret to use Anthropic/OpenAI/Google.

## For teams

Rules live in your repo. Personal config lives on your machine. API keys live in a gitignored file.

- Commit `config.yaml` and the `rules/` directory with the rest of your code. Everyone on the team gets the same baseline.
- Pull remote rules from a shared git repo. One team manages standards, many product repos use them.
- Override per-developer in `config.personal.yaml` without touching the team config. Swap reviewer, raise reasoning effort, enable extra rules locally.
- History log records provider, model, rule, verdict, and reason per review. Audit trail for every run.

**Onboarding a new dev.** After `git clone`, each developer runs `/autoreview:init --upgrade --install-precommit` once. The `--upgrade` is safe on an already-init'd clone; without it, init bails out assuming setup is already done. If the repo already uses Husky or another pre-commit manager, pass `--precommit-append` so AutoReview's hook runs alongside the existing one instead of replacing it.

**Centralized audit trail.** The history log (`.autoreview/.history/*.jsonl`) is gitignored by default — it's per-machine. For a team-wide view, upload the jsonl from CI as an artifact or ship it to a log aggregator. Records carry `actor` (git email), `host`, `ci_run_id`, `commit_sha`, and token `usage` so you can aggregate spend and attribute verdicts across machines.

## Exit codes

- `0` pass, soft-fail, or no matching rules
- `1` at least one rule rejected under hard enforcement
- `2` internal tool error, not a rule verdict

CI that needs to distinguish crashed-tool from rule-rejected parses stderr. `[reject]` is rule. `[error]` is tool.

## The tool never blocks a broken setup

No Ollama running, no API key, no config. Commit still goes through. Warning on stderr, exit 0. This is not configurable. The tool is not allowed to break your workflow because it isn't set up right.

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

## Docs

- [SECURITY.md](SECURITY.md) — data flow, sandboxing, fail-open invariants, prompt-injection surface.
- [Functional spec](docs/specification.md), the 29-point contract.
- [Implementation design](docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md).

## Testing

```
npm test                                     # unit + integration (stubs only)
AUTOREVIEW_REAL_OLLAMA=1 npm test           # +real Ollama round-trip (requires daemon)
```

The real-Ollama test (`tests/e2e/real-ollama.test.mjs`) is skipped by default. Set `AUTOREVIEW_REAL_OLLAMA=1` to run it. Optionally set `OLLAMA_HOST` (default `http://localhost:11434`) and `AUTOREVIEW_REAL_MODEL` (default `qwen2.5-coder:7b`).

## License

MIT

---

<div align="center">
  <img src="yggdrasil.svg" alt="AutoReview" width="120" />
  <br/><br/>
  <sub>Part of the Yggdrasil family. Questions? Open an issue.</sub>
</div>
