#!/usr/bin/env bash
# Thin wrapper: SessionStart hooks run in the user repo cwd. The node script needs
# CLAUDE_PLUGIN_ROOT to find its templates.
set -e
exec node "${CLAUDE_PLUGIN_ROOT}/scripts/bin/session-start.mjs"
