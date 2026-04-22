---
name: "Test HTTP server: ephemeral port + close in finally"
triggers: 'path:"tests/**/*.test.mjs" AND content:"createServer"'
description: "Use when a test spins an HTTP server; must listen on port 0 (ephemeral) and close in finally."
---
All tests that create an HTTP server follow the same idiom: `s.listen(0, () => resolve({ port: s.address().port, close: () => new Promise(r => s.close(r)) }))`. Port 0 asks the OS for an ephemeral free port, preventing EADDRINUSE when tests run in parallel (`node --test` fans out). The returned `close` is awaited in `finally` to prevent the process from hanging on open sockets.
Never hard-code `listen(11434)`, `listen(8080)`, or any fixed port — it will flake on contributor machines and in CI, and two parallel tests in the same provider family will collide.

