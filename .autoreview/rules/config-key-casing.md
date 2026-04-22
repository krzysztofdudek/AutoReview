---
name: "Config key casing: snake_case YAML, camelCase JS locals"
triggers: 'path:"templates/config-*.yaml" OR path:".autoreview/config*.yaml" OR path:"scripts/lib/config-loader.mjs"'
description: "Use when adding a config key; YAML keys stay snake_case, JS reads them as-is without translation."
---
AutoReview config keys are snake_case in YAML (`context_window_bytes`, `reasoning_effort`, `walk_file_cap`, `remote_rules_auto_pull`, `intent_trigger_budget`, `log_to_file`) and are read as-is in JS via dot/bracket access on the parsed config object (`cfg.review.context_window_bytes`, `cfg.history.log_to_file`). There is no normalization step that converts to camelCase.
Local JS-only variables and function parameters remain camelCase (`contextWindowBytes`, `reasoningEffort`) — the boundary is crossed when reading the config object: `const contextWindowBytes = cfg.review.context_window_bytes;`.
Pass if: new YAML key is snake_case AND every JS read site uses the same snake_case property on the cfg tree.
Fail if: YAML key is camelCase, or JS reads `cfg.review.contextWindowBytes` when the YAML has `context_window_bytes`, or a translation helper mutates keys.

