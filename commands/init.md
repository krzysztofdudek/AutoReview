---
description: Bootstrap AutoReview in the current repo
argument-hint: "[--upgrade] [--provider <name>] [--install-precommit]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/init.mjs $ARGUMENTS`

If no `--provider` flag is passed, first probe for Ollama. Recommend `ollama` if reachable. Otherwise list the provider options and ask the user to choose one before re-running with `--provider`.
