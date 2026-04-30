#!/bin/bash
set -e

echo "=== Setting up AutoReview development environment ==="

chmod +x hooks/*.sh 2>/dev/null || true
chmod +x scripts/bin/*.mjs 2>/dev/null || true

echo "=== Installing Claude Code CLI globally (no autologin) ==="
npm install -g @anthropic-ai/claude-code

echo "=== Registering local plugin marketplace + installing autoreview ==="
claude plugin marketplace add "$PWD" --scope user
claude plugin install autoreview@autoreview-marketplace --scope user

echo "=== Setup complete ==="
echo "Local LLM expected at: http://host.docker.internal:8089/v1 (configured in .autoreview/config.yaml)"
echo "Run on host: llama-server -m <gguf> --jinja --host 0.0.0.0 --port 8089 -c 128000"
