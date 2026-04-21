# Example: Passing repo

This project has one AutoReview rule. The committed code satisfies it.

**Prerequisite:** Ollama running on localhost:11434 with `qwen2.5-coder:7b` pulled:
```
ollama serve &
ollama pull qwen2.5-coder:7b
```

**Run:**
```
bash run.sh
```

Expected: `[pass] src/handler.ts :: example/non-empty`.

To use a cloud provider instead, edit `.autoreview/config.yaml` and set `provider.active` + add a key.
