---
description: Bootstrap AutoReview in the current repo
argument-hint: "[--upgrade] [--provider <name>] [--install-precommit]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/init.mjs $ARGUMENTS`

Before running, interview the user:

1. **Provider choice.** If `--provider` not passed, probe Ollama (`curl -sf --max-time 2 http://localhost:11434/api/tags`). List provider options (ollama, claude-code, codex, gemini-cli, anthropic, openai, google, openai-compat). If Ollama reachable, recommend it as default. Ask user which provider to use.

2. **Model choice (ollama only).** If user picks ollama, list installed models via `curl -sf http://localhost:11434/api/tags` and ask which model to use. Do NOT assume the default `qwen2.5-coder:7b` is pulled. After init, patch `.autoreview/config.yaml` `provider.ollama.model` to the chosen model (or tell user to `ollama pull <model>` if they want a different one).

3. Re-run init with `--provider <chosen>` once confirmed.
