---
name: "Files must be non-empty"
triggers: 'path:"src/**/*.ts"'
---
Every TypeScript file must contain at least one export statement.
An empty file or one with only imports fails this rule.
