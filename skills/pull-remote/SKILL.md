---
name: pull-remote
description: Use when the user wants to fetch or refresh remote rules — "pull rules from upstream", "update remote rules", "fetch latest rule version", "sync remote rules" — or right after editing `remote_rules` in `.autoreview/config.yaml`. Also use when a review fails because a referenced remote rule isn't yet on disk. Skip when no `remote_rules` are declared in config (the tool will warn and exit cleanly anyway).
---

# AutoReview Pull-Remote

> **Cross-platform.** Snippets below use bash-style env-var syntax (`${CLAUDE_PLUGIN_ROOT}`). Claude Code's Bash tool runs Git Bash on Windows so these work as-is; on native PowerShell substitute `$env:CLAUDE_PLUGIN_ROOT`, on cmd use `%CLAUDE_PLUGIN_ROOT%`. Plugin requires Node ≥22 and `git` on PATH — those are the assumed binaries.

Fetch every `remote_rules` source declared in `.autoreview/config.yaml`. Each source is cloned into `.autoreview/remote_rules/<name>/<ref>/` and gets a `.autoreview-managed` sentinel file.

## Default — pull everything

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/pull-remote.mjs
```

## Pull one source by name

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/pull-remote.mjs <source-name>
```

Use this when the user wants to refresh just one (`--name shared` in config → invoke with `shared`).

## Refresh semantics

Re-running pull-remote is idempotent and the right way to update:

- With `ref: "v1.2.0"` (a tag) — nothing changes unless the tag has been moved upstream. Bump `ref` in config and re-pull to switch versions.
- With `ref: "main"` (a branch) — re-running picks up new commits from that branch.

## After fetching — overlay validation

After a successful pull, warn if any `remote_rules[<name>].overrides` entry references a rule id that is not present in the freshly fetched ref:

```
[warn] override for 'corp-standards/legacy-rule' but rule absent in fetched ref v1.3.0
```

This means the upstream maintainer removed or renamed a rule you had overridden. The override config is kept (you may re-add the rule upstream or clean up the stale override), but the warning surfaces the drift. Use `autoreview:override-rule` to inspect and clean up stale overrides.

## Safety mechanisms

- **Sentinel-protected wipe.** The tool refuses to wipe a target dir containing non-markdown files unless a `.autoreview-managed` sentinel is present — protects against accidentally nuking a hand-edited local copy.
- **Hardened git invocation.** `git clone` runs with `GIT_CONFIG_NOSYSTEM=1` and `core.hooksPath=/dev/null` to prevent a hostile rule repo from running hooks on the user's machine.
- **URL/ref validation.** URLs must use `https://`, `http://`, `git://`, `ssh://`, `file://`, a POSIX absolute path, or a Windows drive-letter absolute path. URLs starting with `-` are rejected (prevents `--upload-pack=evil`). Refs cannot contain `..`, leading `/`, or leading `-`.

## Reporting

Report `pulled <name>@<ref> -> .autoreview/remote_rules/<name>/<ref>/` per source, or the warning if no sources are declared. If a pull fails, surface the git error verbatim — usually it's an auth issue (wrong ref, private repo without credentials) that the user has to resolve outside the tool.
