---
name: "No shell interpolation in spawn"
triggers: 'path:"scripts/**/*.mjs" AND content:"spawn"'
description: "spawn/spawnSync must use arg arrays, not template literals or string concat into -c args."
---
Every `spawn(...)` or `spawnSync(...)` call must use an args array literal. No shell string interpolation.

Pass:
- `spawn('git', ['clone', '--depth', '1', url, tmp])` — args array with constant strings + variable values as separate elements
- `spawn('sh', ['-c', 'command -v "$1"', '_', name])` — static command text with variables as positional `$1`/`$2`

Fail:
- `spawn('sh', ['-c', \`command -v ${name}\`])` — template literal splices user data into shell = injection
- `spawn(\`git clone ${url}\`)` — full shell string with interpolation
- `spawnSync('bash', ['-c', userInput])` — unsanitized user input in `-c`
- String concatenation into any `-c` argument
- Use of `shell: true` with any non-literal command

The invariant: no user-controlled data ever becomes a shell-interpreted token. Positional shell args (`$1`) are OK because the shell treats them as plain data.

