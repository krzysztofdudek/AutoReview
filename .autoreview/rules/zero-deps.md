---
name: "Zero npm dependencies"
triggers: 'path:"{scripts,tests}/**/*.mjs"'
description: "All imports must be node: built-ins or relative paths. No bare-specifier imports from npm packages."
---
Every import statement in this file must use either:
- A `node:` prefix (e.g. `node:fs/promises`, `node:child_process`), OR
- A relative path starting with `./` or `../`.

Bare-specifier imports (e.g. `import x from 'some-package'`) are forbidden because this project has zero npm dependencies.

Re-exports via `export { x } from '...'` follow the same rule.

Pass if all imports in the file are either `node:*` or relative.
Fail if any import uses a bare package name.

