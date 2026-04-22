---
name: "No default exports"
triggers: 'path:"scripts/**/*.mjs" OR path:"tests/**/*.mjs"'
description: "Use when adding exports to any .mjs; every symbol must be a named export, `export default` is forbidden."
---
The codebase uses zero `export default` declarations. Every public symbol is a named export (`export function`, `export const`, `export class`, `export async function`). Re-exports use `import * as ns from './mod.mjs'` (see provider-client.mjs) rather than default passthrough.
This keeps call sites greppable (`getProvider(` is unambiguous) and avoids rename drift between file and default binding.
Pass if: file has zero occurrences of `export default`.
Fail if: any `export default <expr>` or `export { x as default }` appears.

