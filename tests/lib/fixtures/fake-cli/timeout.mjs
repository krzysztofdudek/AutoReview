#!/usr/bin/env node
// Block for 10s — long enough that any reasonable timeoutMs in tests fires first.
setTimeout(() => process.exit(0), 10_000);
