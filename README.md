# AutoReview

**A rule file is a suggestion. This is the reviewer that turns it into a verdict on every commit.**

An LLM reviewer that reads one file at a time and checks it against Markdown rules you wrote in plain English. Runs offline with Ollama by default. Ships as a Claude Code plugin — install, write a rule, commit, done.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-green.svg)](https://nodejs.org)
[![Zero deps](https://img.shields.io/badge/npm%20deps-0-blue.svg)](./package.json)

---

This is the little sibling of [Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil). Yggdrasil maps your whole codebase into a graph of rules, components, and flows. AutoReview drops everything except the part that made the first version useful: one file, one set of rules, one verdict — every time your agent writes code.

If you want the architecture graph and cross-file reasoning, use Yggdrasil. If you want "just check this file against these rules, on commit, and shut up when it passes" — AutoReview.

## The problem

Your agent writes a payment handler. Your CLAUDE.md says "every mutation must emit an audit event." The agent skipped it. Tests pass. Lint passes. You find out in a PR a week later when someone notices no logs.

Rule files are suggestions. There is no enforcement loop. Linters don't know what an audit event is, or which layer should never call the database directly, or why this handler needs zod validation.

## What AutoReview does

You write rules in plain Markdown under `.autoreview/rules/`. Each rule declares a trigger (glob + content regex) and prose describing what must be true.

```md
---
name: "API Controllers Validate Input"
triggers: '(path:"src/api/**/*.ts") AND content:"@Controller"'
---
Every controller must validate input with zod before processing.
Reject with HTTP 400 if validation fails.
Log rejection with correlation-id.
```

On every commit, the pre-commit hook sends each staged file + the rules that match it to a reviewer LLM. Verdict per rule: pass, reject, or error. Rejects block the commit (unless you configured soft mode, which prints warnings and moves on).

```
agent writes code
  → git commit
  → pre-commit hook runs
  → matched rules sent to reviewer (Ollama, by default)
  → [pass] src/api/users.ts :: api/validate-input
  → [reject] src/api/orders.ts :: api/validate-input
      reason: charge() mutates state without zod validation (line 42)
  → commit blocked
  → agent fixes, re-commits, passes
```

Triggers are deterministic — no LLM call. Only matched rules get sent to the reviewer. A file with no matching rules is free.

## How it differs from Yggdrasil

| | Yggdrasil | AutoReview |
|---|---|---|
| Scope | Cross-file: graph of components + flows | Per-file only |
| Setup | Map your codebase | Write a Markdown rule |
| CI | Hash-based incremental verify | Pre-commit hook + explicit `validate` |
| Distribution | npm package + CLI | Claude Code plugin + optional CLI |
| Dependencies | Node + yarn + a bunch of deps | Node, zero npm deps |
| Cost | One model call per file×rule pair | Same, but smaller prompts |

AutoReview is the wedge. Start here, graduate to Yggdrasil when you need architecture-wide reasoning.

## Getting started

**1. Install the plugin.**

```
/plugin install autoreview
```

In Claude Code. Requires Node.js 20+ (for the zero-dep stdlib).

**2. Initialize in your repo.**

```
/autoreview:init --provider ollama --install-precommit
```

Scaffolds `.autoreview/` with a config, an example rule, and a git pre-commit hook. For paid providers:

```
/autoreview:init --provider anthropic --install-precommit
# then paste your key into .autoreview/config.secrets.yaml (gitignored)
```

**3. Tell the agent what matters.**

```
You:    "All API handlers must validate input with zod."
Agent:  Runs the 7-step create-rule wizard — proposes the trigger,
        shows breadth (how many files it matches), test-drives on a
        sample, then writes the rule file.
```

Or write the rule file directly. It's just Markdown with YAML frontmatter.

**4. Commit.**

```
$ git commit -m "add user endpoint"
[warn] provider ollama: reachable
[pass] src/api/users.ts :: api/validate-input
[pass] src/api/users.ts :: logging/correlation-id
```

If a rule rejects in hard mode, commit blocks. In soft mode (default for pre-commit), it warns but lets you through.

**5. Validate on demand.**

```
/autoreview:validate              # uncommitted files, thinking mode
/autoreview:validate --scope all  # full repo sweep
/autoreview:validate --sha HEAD~1 # post-factum: did that commit pass?
```

## Agent pre-check

Before the agent writes a file, it can ask: "would this content pass review?"

```bash
autoreview validate \
  --content-file /tmp/draft.ts \
  --target-path src/api/users.ts
```

The agent gets a verdict without touching disk. Skill `autoreview-precheck` wraps this for Claude Code.

## Modes

- **Quick** — pass/fail only. ~100 tokens out. Default for pre-commit. Used when you want fast gate behavior.
- **Thinking** — `{satisfied, reason, suppressed[]}` with file:line references and configurable reasoning effort (low/medium/high). Default for manual `/autoreview:validate`.

Per-rule override: a rule can opt into a stronger model or different mode if the convention genuinely needs it.

## Supported providers

**Local (default):** Ollama — offline, free, private. Any 3B–7B coder model works.

**API:** Anthropic, OpenAI, Google, any OpenAI-compatible endpoint.

**Agent CLI:** Claude Code, Codex, Gemini CLI — uses an already-authenticated agent binary on your `$PATH` as the reviewer.

Switching providers is a single config line. Per-rule overrides let you use Haiku for cheap rules and Opus for the one rule that really matters.

## Inline suppressions

When a rule genuinely shouldn't apply to a specific function or block:

```ts
// @autoreview-ignore api/validate-input payload is already schema-validated upstream
export function passthroughRoute() { /* ... */ }
```

Reason is mandatory. The reviewer LLM decides scope based on marker position (file-top → whole file, above a function/block → that span). History logs it as `verdict: 'suppressed'` with the reason so you can audit later.

The agent is instructed to never write a suppression without your explicit okay.

## Configuration

Three files, merged in priority order:

- `.autoreview/config.yaml` — committed, team-shared baseline.
- `.autoreview/config.personal.yaml` — gitignored, per-developer overrides.
- `.autoreview/config.secrets.yaml` — gitignored, API keys only (env vars also work).

Common knobs: provider, model, mode, enforcement (soft vs hard) per context, consensus voting, reasoning effort, history toggle, rule enable/disable lists.

## Remote rule sources

Shared rules across repos? Declare a Git URL in config:

```yaml
remote_rules:
  - name: company-shared
    url: "https://github.com/acme/review-rules.git"
    ref: "v1.2.0"
    path: "rules/"
```

`/autoreview:pull-remote` clones the tagged ref into `.autoreview/remote_rules/` on demand. Set `review.remote_rules_auto_pull: true` to refresh on every review run.

## Exit codes

Three-state contract:

- `0` — pass, soft-fail, or no matching rules.
- `1` — hard fail (at least one rule rejected, enforcement is hard).
- `2` — internal tool error (crashed, not a rule verdict).

CI retry logic that needs to distinguish "tool crashed" from "rule rejected" parses stderr: `[reject]` (rule) vs `[error]` (tool).

## FAQ

**How is this different from CLAUDE.md?**
CLAUDE.md is a text dump sent verbatim into every prompt. Agents ignore 30% of it. AutoReview runs a reviewer LLM against each file and emits a concrete verdict per rule. The gate is verified, not suggested.

**How is this different from a linter?**
Linters check syntax and AST patterns. "Must emit an audit event before returning" isn't a lint rule. "No direct DB access from this layer" isn't in any AST. AutoReview uses an LLM reviewer against plain-English rules, so the rule language is whatever you can describe.

**How is this different from a PR review?**
PR review catches violations after the agent moved on. AutoReview catches them on commit — the same session the code was written in. Faster feedback, less context loss.

**Does it block my commit if Ollama isn't running?**
No. Soft-fail on any missing dep (no config, no Ollama, no API key) — warn and exit 0. The commit proceeds. This is non-negotiable; the tool isn't allowed to break your workflow.

**What's the cost?**
With Ollama: zero. With paid APIs: proportional to `(matched-files × matched-rules)`. Quick mode keeps prompts small. Most files match 2–3 rules.

**Can I scope rules to a directory?**
Yes. `dir:"src/api"` is shorthand for `path:"src/api/**"`. First-class in the trigger grammar.

**What if I want to stop?**
Delete `.autoreview/` and the pre-commit hook. No build hooks, no runtime deps, nothing left behind.

## Docs

- [Functional spec](docs/specification.md) — the 29-point contract.
- [Implementation design](docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md) — architecture, trade-offs, departures from spec.

## License

MIT

---

<div align="center">
  <img src="yggdrasil.svg" alt="AutoReview" width="120" />
  <br/><br/>
  <sub>Part of the Yggdrasil family. Questions? Open an issue.</sub>
</div>
