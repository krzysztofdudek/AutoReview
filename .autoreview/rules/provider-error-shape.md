---
name: "Provider verify() error shape"
triggers: 'dir:"scripts/lib/providers" AND content:"verify"'
description: "Use when editing a provider module; verify() errors must return {providerError:true, raw:<string>} canonical shape and never throw."
---
Every code path inside a provider's `verify()` method that represents a provider-side failure (missing API key, HTTP non-2xx, subprocess non-zero exit, timeout, thrown exception caught) MUST return the exact shape `{ satisfied: false, providerError: true, raw: <string> }`. `raw` must be a string (use `String(err)` or `r.stderr` or `r.body`). Never throw from `verify()` — the reviewer treats a throw as an internal crash. Never omit `providerError: true`; the validate loop depends on this flag to avoid promoting transient provider failures to exit-code 1 (spec §22). `raw: 'timeout'` and `raw: 'no api key'` are canonical short strings.

