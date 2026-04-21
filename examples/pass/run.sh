#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Ensure a git repo with at least one commit exists
if [ ! -d .git ]; then
  git init -q
  git config user.email example@example.com
  git config user.name example
  git commit --allow-empty -q -m "init"
fi

# Copy plugin runtime into .autoreview/runtime/
mkdir -p .autoreview/runtime/bin .autoreview/runtime/lib
cp -r ../../scripts/lib/* .autoreview/runtime/lib/
cp ../../scripts/bin/validate.mjs .autoreview/runtime/bin/

echo "=== Running validate on passing example ==="
node .autoreview/runtime/bin/validate.mjs --scope all
