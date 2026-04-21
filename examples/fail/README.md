# Example: Deliberate failure

This project has one AutoReview rule that `src/broken.ts` deliberately violates. Useful for seeing a `[reject]` verdict.

```bash
cd examples/fail
# (setup as in pass/, then:)
node .autoreview/runtime/bin/validate.mjs --scope all --mode thinking
```

Expected: `[reject] src/broken.ts :: example/must-export-default` with a reason about the missing default export.
