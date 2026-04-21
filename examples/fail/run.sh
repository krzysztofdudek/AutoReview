#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .git ]; then
  git init -q
  git config user.email example@example.com
  git config user.name example
  git commit --allow-empty -q -m "init"
fi

mkdir -p .autoreview/runtime/bin .autoreview/runtime/lib
cp -r ../../scripts/lib/* .autoreview/runtime/lib/
cp ../../scripts/bin/validate.mjs .autoreview/runtime/bin/

echo "=== Running validate on failing example (expect [reject]) ==="
node .autoreview/runtime/bin/validate.mjs --scope all --mode thinking || true
