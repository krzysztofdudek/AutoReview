---
name: autoreview-setup
description: Use when the user asks to set up AutoReview in the repo ("setup autoreview", "init autoreview", "add autoreview here") or when `.autoreview/` is missing and the user wants code review. Also triggers when the agent notices no config but rules are being discussed. Skip when `.autoreview/` already exists and the user is not asking for a reset (use autoreview-create-rule instead to add rules).
---

# AutoReview Setup

Run when the repo has no `.autoreview/` directory and the user wants to enable rule-based LLM review.

## Steps

1. Probe for Ollama: if `http://localhost:11434/api/tags` responds, recommend `ollama` first. Otherwise, list all providers and ask which to use. Do NOT ask the user to paste an API key in conversation — the secrets file is placeholder-only.

2. Ask the user "install git pre-commit hook?" first. If yes, add `--install-precommit`. Never install without explicit user okay.

   Run the init script:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/init.mjs --provider <chosen-provider> --install-precommit
```
   (omit `--install-precommit` if the user declines)

3. Mention that the git pre-commit hook was installed (if requested) and the first example rule lives at `.autoreview/rules/example.md`.

4. Point the user at `/autoreview:create-rule` to author their first rule.

Never read `.autoreview/config.secrets.yaml` — it may contain keys.
