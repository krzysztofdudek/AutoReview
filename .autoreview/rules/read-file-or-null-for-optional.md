---
name: "readFileOrNull for optional files"
triggers: 'path:"scripts/**/*.mjs" AND content:"readFile"'
description: "Use when reading a file whose absence is valid; use readFileOrNull or inline .catch(()=>null), never plain readFile."
---
When reading a file whose absence is a normal, non-error state (optional config, .gitignore, sidecar, user-supplied scan target), do not let ENOENT propagate.
- Prefer `readFileOrNull(path)` from `scripts/lib/fs-utils.mjs` for well-known repo-config paths the codebase reads repeatedly (config.yaml, .gitignore, templates).
- For ad-hoc / user-supplied paths inside a single function, inline `.catch(() => null)` on the `readFile` promise is acceptable.
- Plain `await readFile(path)` without a catch is only correct when the file is known to exist (just listed via readdir, or just written in the same function).
Never swallow non-ENOENT errors silently — helpers rethrow non-ENOENT and inline catches should too when surrounding logic assumes it.

