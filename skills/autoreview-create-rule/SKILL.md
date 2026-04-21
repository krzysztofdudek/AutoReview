---
name: autoreview-create-rule
description: Author a new code convention rule via 7-step guided wizard. Triggered by "add a rule", "enforce X convention", "create an autoreview rule", or when the user describes a pattern they want checked on every commit.
---

# AutoReview Create-Rule Wizard

Seven steps. Never skip steps — users underestimate how much rule-authoring shapes verdict quality.

1. **What to enforce?** Keep asking until the convention is concrete.
2. **Propose name + trigger.** Grep the repo to learn its layout first. If the convention is directory-bound, propose `dir:"<dir>"` (shorthand for `path:"<dir>/**"`) directly.
3. **Breadth check.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/check-breadth.mjs --expr '<expr>'`. Show match count and first 10 samples. Iterate until the match set looks right.
4. **Pass/fail examples.** Read 2–3 matched files with the Read tool. Reason out loud about whether each would pass the draft rule body. No LLM review call yet.
5. **Intent trigger?** (only if `config.review.intent_triggers: true`) Ask if a Layer 2 NL intent makes sense.
6. **Test-drive.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/reviewer-test.mjs --rule <id> --file <path>` against 2–3 sample files. If verdicts are wrong, go back to step 1.
7. **Save.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/create-rule.mjs save --name '<n>' --triggers '<t>' --body-file <tmp> --to '<rel-path>'`. End with: *Rule saved at `.autoreview/rules/<rel-path>`. Commit when ready.* Do not run `git commit` yourself.
