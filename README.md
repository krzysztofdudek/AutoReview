# AutoReview

**A rule file is a suggestion. This turns it into a verdict on every commit.**

An LLM reviewer that reads one file at a time and checks it against Markdown rules you wrote in plain English.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green.svg)](https://nodejs.org)
[![Zero deps](https://img.shields.io/badge/npm%20deps-0-blue.svg)](./package.json)

---

I built this after getting annoyed at my agent skipping audit logging on a payment mutation for the third time. CLAUDE.md said to emit audit events. Agent read it. Agent skipped it. Tests passed. I only caught it because I happened to diff that specific file.

A rules file is a suggestion. There are no consequences for ignoring it. This is the reviewer that turns it into a rule.

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

Commit. Hook runs. Done.

## Pre-check before the agent writes

The agent can ask "would this pass?" before writing the file to disk. Pass a draft in, get a verdict back, no disk write.

```bash
autoreview validate \
  --content-file /tmp/draft.ts \
  --target-path src/api/users.ts
```

Skill `autoreview-precheck` wraps this for Claude Code. Agent uses it to avoid writing code it would have to immediately rewrite after the reviewer rejects.

## On-demand review

```
/autoreview:validate              uncommitted files, thinking mode
/autoreview:validate --scope all  full repo sweep
/autoreview:validate --sha HEAD~1 did that commit pass?
```

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

**Quick** is pass/fail only. ~100 tokens out. Default for pre-commit.

**Thinking** returns `{satisfied, reason, suppressed[]}` with file:line references and configurable reasoning effort. Default for manual validate.

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

## For teams

Rules live in your repo. Personal config lives on your machine. API keys live in a gitignored file.

- Commit `config.yaml` and the `rules/` directory with the rest of your code. Everyone on the team gets the same baseline.
- Pull remote rules from a shared git repo. One team manages standards, many product repos use them.
- Override per-developer in `config.personal.yaml` without touching the team config. Swap reviewer, raise reasoning effort, enable extra rules locally.
- History log records provider, model, rule, verdict, and reason per review. Audit trail for every run.

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
