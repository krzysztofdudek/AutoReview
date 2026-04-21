# Example: Deliberate failure

This project has one AutoReview rule that `src/broken.ts` deliberately violates. Useful for seeing a `[reject]` verdict.

**Prerequisite:** Ollama running on localhost:11434 with `qwen2.5-coder:7b` pulled:
```
ollama serve &
ollama pull qwen2.5-coder:7b
```

**Run:**
```
bash run.sh
```

Expected: `[reject] src/broken.ts :: example/must-export-default` with a reason about the missing default export.

To use a cloud provider instead, edit `.autoreview/config.yaml` and set `provider.active` + add a key.
