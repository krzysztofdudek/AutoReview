# Example: Passing repo

This project has one AutoReview rule. The committed code satisfies it.

**Prerequisite:** Ollama running on localhost:11434 with `gemma4:e4b` pulled:
```
ollama serve &
ollama pull gemma4:e4b
```

**Run:**
```
bash run.sh
```

Expected: `[pass] src/handler.ts :: example/non-empty`.

To use a cloud provider instead, edit `.autoreview/config.yaml` and update the `tiers.default.provider`, `tiers.default.model`, and endpoint configuration as needed.
