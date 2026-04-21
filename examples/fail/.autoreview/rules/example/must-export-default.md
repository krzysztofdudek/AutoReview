---
name: "Module must have default export"
triggers: 'path:"src/**/*.ts"'
---
Every TypeScript module under `src/` must have exactly one `export default` statement at the top level.
Files that only use named exports fail this rule.
