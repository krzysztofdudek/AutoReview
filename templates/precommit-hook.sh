#!/usr/bin/env sh
# Installed by autoreview-setup. Runs staged-files review.
exec node "$(git rev-parse --show-toplevel)/.autoreview/runtime/bin/validate.mjs" \
  --scope staged \
  --context precommit \
  "$@"
