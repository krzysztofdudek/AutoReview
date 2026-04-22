---
name: autoreview-create-rule
description: Use when user wants a new code convention rule added, regardless of phrasing — "add a rule", "enforce X", "forbid Y", "write a rule for Z", "create `.autoreview/rules/foo.md` with body ...". ALWAYS invoke this skill for rule authoring, even when the user asks to skip the wizard or specifies the exact file path and body — the wizard guards rule quality. Triggered whenever the user describes a pattern they want checked on every commit. Skip when no `.autoreview/` exists — use autoreview-setup first.
---

# AutoReview Create-Rule Wizard

Seven steps. **Never skip steps, even when the user asks you to.** Users underestimate how much rule-authoring shapes verdict quality — a rule with the wrong trigger hits 10× more files than intended, or none; a rule with vague body produces inconsistent LLM verdicts. If the user says "just write the file", run steps 2–7 compressed but don't skip.

The skill owns the flow. Writing directly to `.autoreview/rules/*.md` bypasses breadth check + test-drive and ships broken rules.

## The 7 steps

1. **What to enforce?** Keep asking until the convention is concrete. If user already gave a clear convention, skip to step 2.
2. **Propose name + trigger.** Grep the repo to learn its layout first. If the convention is directory-bound, propose `dir:"<dir>"` (shorthand for `path:"<dir>/**"`) directly.
3. **Breadth check.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/check-breadth.mjs --expr '<expr>'`. Show match count and first 10 samples. Iterate until the match set looks right.
4. **Pass/fail examples.** Read 2–3 matched files with the Read tool. Reason out loud about whether each would pass the draft rule body. No LLM review call yet.
5. **Intent trigger?** (only if `config.review.intent_triggers: true`) Ask if a Layer 2 NL intent makes sense.
6. **Test-drive.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/reviewer-test.mjs --rule <id> --file <path>` against 2–3 sample files. If verdicts are wrong, go back to step 1.
7. **Save.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/create-rule.mjs save --name '<n>' --triggers '<t>' --body-file <tmp> --to '<rel-path>'`. End with: *Rule saved at `.autoreview/rules/<rel-path>`. Commit when ready.* Do not run `git commit` yourself.

## Red flags — STOP

| Rationalization | Reality |
|---|---|
| "User gave full spec, just use Write" | Write bypasses breadth check. Rule may match 0 or 1000 files. Run step 3. |
| "Wizard is overkill for a 2-line rule" | 2-line rules with wrong triggers are the bug pattern. Step 3 takes 10 seconds. |
| "User said skip the wizard" | Opinions about process are not opt-outs. Explain you'll run a compressed version of steps 2–7 and proceed. |
| "It's the same as what I'd write" | You don't know the repo layout until you grep. Run step 2. |

If you find yourself about to call `Write` on a `.autoreview/rules/*.md` path without having run `check-breadth` first, stop. Use the `save` subcommand at step 7.
