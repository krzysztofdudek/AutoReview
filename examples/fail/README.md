# Example: Deliberate failure

This project has one AutoReview rule that `src/broken.ts` deliberately violates. Useful for seeing a `[reject]` verdict.

**Prerequisite:** Ollama running on localhost:11434 with `gemma4:e4b` pulled:
```
ollama serve &
ollama pull gemma4:e4b
```

**Run:**
```
bash run.sh
```

Expected: `[reject] src/broken.ts :: example/must-export-default` with a reason about the missing default export.

To use a cloud provider instead, edit `.autoreview/config.yaml` and update the `tiers.default.provider`, `tiers.default.model`, and endpoint configuration as needed.
