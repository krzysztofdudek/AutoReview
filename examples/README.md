# Examples

Two minimal projects that demonstrate AutoReview in action.

| Directory | What it shows |
|-----------|---------------|
| `pass/`   | A project whose committed code satisfies the single rule. Expected verdict: `[pass]`. |
| `fail/`   | A project whose committed code deliberately violates the single rule. Expected verdict: `[reject]`. |

Each subdirectory contains a `run.sh` that sets up the runtime and runs the validator.
See each subdirectory's `README.md` for prerequisites and expected output.
