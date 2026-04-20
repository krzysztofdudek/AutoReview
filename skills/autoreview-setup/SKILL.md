---
name: autoreview-setup
description: Initialize AutoReview in a project, configure provider, install git pre-commit hook. Triggered by "setup autoreview", "init autoreview", or when `.autoreview/` is missing and the user wants code review.
---

# AutoReview Setup

Run when the repo has no `.autoreview/` directory and the user wants to enable rule-based LLM review.

## Steps

1. Probe for Ollama: if `http://localhost:11434/api/tags` responds, recommend `ollama` first. Otherwise, list all providers and ask which to use. Do NOT ask the user to paste an API key in conversation — the secrets file is placeholder-only.

2. Run the init script:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/init.mjs --provider <chosen-provider>
```

3. Mention that the git pre-commit hook was installed and the first example rule lives at `.autoreview/rules/example.md`.

4. Point the user at `/autoreview:create-rule` to author their first rule.

Never read `.autoreview/config.secrets.yaml` — it may contain keys.
