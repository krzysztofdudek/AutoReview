---
description: Fetch rules from remote Git sources declared in config
argument-hint: "[<source-name>]"
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/pull-remote.mjs $ARGUMENTS`

Without arguments, pulls all sources. Each source is wiped and re-cloned from the pinned ref. On conflict with user-modified files, the tool refuses to wipe — resolve manually.
