# Example: Passing repo

This project has one AutoReview rule. The committed code satisfies it.

```bash
cd examples/pass
git init
git add .
git commit -m "initial" --no-verify   # skip precommit to get into git
cp -r ../../scripts/lib .autoreview/runtime/lib
cp ../../scripts/bin/validate.mjs .autoreview/runtime/bin/
node .autoreview/runtime/bin/validate.mjs --scope all
```

Expected output: `[pass] src/handler.ts :: example/non-empty`.
