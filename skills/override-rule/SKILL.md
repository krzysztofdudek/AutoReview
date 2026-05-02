---
name: override-rule
description: Use when user wants to adapt a remote rule's tier / triggers / severity / type WITHOUT forking the rule. Wizard for editing config.yaml's `remote_rules[].overrides` block. Triggers include "this corp rule is too noisy in my repo", "downgrade this rule to warning", "narrow this rule to only src/", "make this rule manual-only". Skip when the rule is local — local rules are owned by the user; edit the file directly. Skip when user wants to change rule body — that's a fork, not an overlay.
---

# AutoReview Override-Rule Wizard

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 — only assumed binary.

Seven steps. Overlays let a repo tune remote (corp-shipped) rules without forking. Changes live in `remote_rules[<name>].overrides[<rule-id>]` in `.autoreview/config.yaml` (or `config.personal.yaml` for personal-scope changes).

Only frontmatter is overridable (`name`, `triggers`, `tier`, `severity`, `type`, `description`). If the user wants to change the rule **body**, that requires forking the rule into a local copy — explain this and stop.

## The 7 steps

1. **Pick remote rule.** List rules grouped by source. Show rule ids, names, and current effective tier/severity. Ask user to pick one by id.

   Example listing:
   ```
   corp-standards:
     corp/audit-log-on-handlers   tier: critical   severity: error
     corp/no-todo-without-ticket  tier: standard   severity: error   [manual]
   vendor-pack:
     vendor/naming-conventions    tier: trivial    severity: warning
   ```

2. **Show effective frontmatter.** Read the upstream frontmatter from `.autoreview/remote_rules/<name>/<ref>/<path>/<rule>.md` and merge any existing override from config. Display both the raw upstream values and the currently applied overrides side by side:

   ```
   Field         Upstream        Current override   Effective
   ---           ---             ---                ---
   tier          critical        trivial            trivial  ←override
   severity      error           (none)             error
   type          auto            manual             manual   ←override
   triggers      dir:"src"       (none)             dir:"src"
   ```

3. **Decide what to change.** Ask which field(s) to adjust. Overridable: `tier`, `triggers`, `severity`, `type`, `description`, `name`. Not overridable: body (explain why and stop if that's what they want).

4. **If `triggers` changed — breadth check.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/check-breadth.mjs --expr '<new-expr>'` against the new trigger expression. Zero LLM cost. Iterate until the match set looks right. A trigger that matches 0 files is dead code; a trigger that matches too many files will inflate review cost.

5. **If `tier` changed — test-drive.** Read `.autoreview/config.yaml` and explain the cost/time tradeoff at the new tier:

   | Tier | Typical use | Relative cost |
   |---|---|---|
   | `trivial` | Style, naming, simple patterns | Cheapest / fastest |
   | `default` | General conventions | Baseline |
   | `standard` | Cross-cutting concerns, API contracts | Moderate |
   | `heavy` | Architectural rules, security invariants | Slow / expensive |
   | `critical` | Compliance, audit, zero-tolerance violations | Most thorough |

   If the target tier is not defined in the repo's `tiers:` config, walk the user through adding it (same as step 5 of `autoreview:create-rule`). Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/reviewer-test.mjs --rule <id> --file <path>` against 2–3 sample files at the new tier so the user can see how the new model behaves before committing.

6. **Write overlay.** Run the save command, choosing scope:
   - `--scope repo` → writes to `.autoreview/config.yaml` (committed, shared with team).
   - `--scope personal` → writes to `.autoreview/config.personal.yaml` (gitignored, local only).

   Ask the user which scope to use if not obvious from context. Get **explicit user consent** before writing.

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/override-rule.mjs save \
     --remote <source-name> \
     --rule <rule-id> \
     --field tier=trivial \
     --field severity=warning \
     [--scope personal]
   ```

   Multiple `--field` flags are accepted. Field format is `<name>=<value>`. To explicitly unset an override field (revert to upstream value), pass `<name>=null`.

7. **Confirm + advise.** Print the saved overlay block. Suggest next steps:
   - Run `autoreview:review` to verify the overlay applied as expected.
   - If triggers changed, run `autoreview:context <some-path>` to confirm which files now match.
   - Commit `config.yaml` if scope was `repo`.

## What an overlay looks like in config.yaml

```yaml
remote_rules:
  - name: corp-standards
    url: https://github.com/acme/autoreview-rules
    ref: v1.2.0
    path: rules
    overrides:
      audit-log-on-handlers:
        tier: trivial          # downgraded from corp's critical
        severity: warning      # non-blocking in this repo
      no-todo-without-ticket:
        type: manual           # opt-in only; don't run on every commit
```

## Red flags — STOP

| Situation | Action |
|---|---|
| User wants to change the rule body | Explain that body is not overridable. Offer to fork: copy the upstream `.md` file into `.autoreview/rules/` under a local id, then edit freely. |
| Rule is local (id has no `<source>/` prefix) | Local rules are owned by the user — edit the file directly. |
| User wants to override a field not in the allowed list | Tell them the allowed fields: `name`, `triggers`, `tier`, `severity`, `type`, `description`. |
| Tier not defined in config | Walk through adding it (step 5) before saving. Don't save an overlay referencing an undefined tier. |
