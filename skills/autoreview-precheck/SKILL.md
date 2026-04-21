---
name: autoreview-precheck
description: Predict whether a hypothetical file (proposed content, not yet written to disk) would pass AutoReview rules. Use BEFORE writing a file to avoid writing code that will fail review. Takes target path + proposed content. Triggered by "would this pass review?", "check before I write", or when drafting content for a new/edited file.
---

# AutoReview Pre-check

When you're drafting file content and want to know whether it would pass review BEFORE committing the write:

1. Save the proposed content to a scratch file: `/tmp/draft-<random>.ts` (or any writable temp path).
2. Pick a rule that you suspect is the strictest/most relevant for the target path (use `autoreview-context` first to find applicable rules).
3. Run:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/bin/reviewer-test.mjs \
  --rule <rule-id> --file <target-path> --content-file /tmp/draft-<random>.ts \
  --mode thinking
```
   Where `<target-path>` is the logical destination (e.g. `src/api/users.ts`) and `--content-file` is where the draft actually lives.

4. Parse the `=== RESULT ===` JSON. If `satisfied: false`, revise the draft and re-run. If `satisfied: true`, commit the write to `<target-path>`.

For multiple rules, run once per rule. Each call is ~1 LLM invocation; keep it cheap.
