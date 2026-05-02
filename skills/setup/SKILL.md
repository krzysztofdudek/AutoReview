---
name: setup
description: Use when the user asks to set up AutoReview in the repo ("setup autoreview", "init autoreview", "initialize autoreview", "bootstrap autoreview", "add autoreview here", "install autoreview") or when `.autoreview/` is missing and the user wants code review. Also triggers when the agent notices no config but rules are being discussed. Skip when `.autoreview/` already exists and the user is not asking for a reset (use autoreview:create-rule instead to add rules).
---

# AutoReview Setup

Run when the repo has no `.autoreview/` directory and the user wants to enable rule-based LLM review.

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so it works there too. On native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`; on cmd use `%CLAUDE_PLUGIN_ROOT%`. The plugin requires Node ≥22 — that's the only assumed binary. Run `node -e "console.log(process.platform)"` to detect OS (`'win32'` / `'linux'` / `'darwin'`) when it matters.

## Steps

1. **Probe for Ollama.** Use Node so it works on every platform without `curl`:
   ```
   node -e "fetch('http://localhost:11434/api/tags',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
   ```
   Exit 0 → reachable, recommend `ollama` as the default provider. Exit 1 → unreachable; list provider options (ollama, claude-code, codex, gemini-cli, anthropic, openai, google, openai-compat) and ask which one to use. Do NOT ask the user to paste an API key in conversation — the secrets file is a placeholder only.

2. **Model choice (ollama only).** If the user picks ollama, list installed models:
   ```
   node -e "fetch('http://localhost:11434/api/tags').then(r=>r.json()).then(j=>console.log(j.models.map(m=>m.name).join('\n')))"
   ```
   Ask which one to use. Do NOT assume the default `qwen2.5-coder:7b` is pulled. After init, patch `.autoreview/config.yaml`'s `tiers.default.model` to the chosen model (or tell user to run `ollama pull <model>` if they want a different one).

3. **Pre-commit hook?** Ask "install git pre-commit hook?" before init. If yes, add `--install-precommit`. Never install without explicit user okay.

4. **Run init.**
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/init.mjs --provider <chosen-provider> --install-precommit
   ```
   Supported flags: `--upgrade` (refresh existing config), `--provider <name>`, `--install-precommit`. Omit `--install-precommit` if the user declined in step 3.

5. **Wrap-up.** Mention that the git pre-commit hook was installed (if requested) and the first example rule lives at `.autoreview/rules/example.md`. Briefly explain two key concepts the generated `config.yaml` comments cover in detail:

   - **Tier model** — rules declare which tier they need (`tier: trivial`, `tier: standard`, etc.). Each tier maps to a provider+model in `config.yaml`. Changing providers is a config edit, not a rule rewrite. Commented tier examples are already in the generated config.
   - **Overlay model** — if the repo pulls remote rule packs, individual rules can be tuned per-repo via `remote_rules[].overrides` without forking upstream. Useful for downgrading a noisy corp rule to `severity: warning`, or narrowing its triggers.

   Point the user at the `autoreview:create-rule` skill to author their first rule. For remote rule overlays, use `autoreview:override-rule`.

Never read `.autoreview/config.secrets.yaml` — it may contain keys.
