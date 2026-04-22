---
description: Fetch rules from remote Git sources declared in config
argument-hint: "[<source-name>]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/pull-remote.mjs $ARGUMENTS`

Pulls every `remote_rules` source declared in `.autoreview/config.yaml`. Each source clones into `.autoreview/remote_rules/<name>/<ref>/` and writes a `.autoreview-managed` sentinel. Filter to one with `/autoreview:pull-remote <name>`.

**Re-run to refresh.** With `ref: "v1.2.0"` (tag), nothing changes unless the tag moves — bump `ref` and re-pull. With `ref: "main"` (branch), re-running picks up new commits. Set `review.remote_rules_auto_pull: true` in config to refresh on every `validate` run.

**Safety.** The tool refuses to wipe a target dir containing non-markdown files without a sentinel — protects against accidentally nuking a hand-edited local copy. Git clone runs with `GIT_CONFIG_NOSYSTEM=1` + `core.hooksPath=/dev/null` to prevent hostile rule repos from running hooks on your box.

**URL/ref validation.** URLs must be https/http/git/ssh/file (`-` prefix rejected — prevents `--upload-pack=evil`); refs cannot contain `..`, leading `/`, or leading `-`.
