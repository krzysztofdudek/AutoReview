# Contributing to AutoReview

## Setup

```bash
git clone https://github.com/krzysztofdudek/AutoReview.git
cd AutoReview
npm test    # should see 225 passing
```

Requires Node.js 20+. Zero npm dependencies — no `npm install` needed.

## Running tests

```bash
npm test                              # stubs + loopback HTTP
AUTOREVIEW_REAL_OLLAMA=1 npm test     # +real Ollama round-trip (requires daemon)
```

## Before opening a PR

1. `npm test` passes.
2. Any new behavior has a failing test written first.
3. Commit messages follow conventional-commits style: `feat(lib): …`, `fix(bin): …`, `test(…): …`, `docs: …`.
4. One concern per commit.

## Code standards

- Zero external npm deps. Node stdlib only.
- Each `scripts/lib/*.mjs` is one clear responsibility, <300 lines.
- Each `scripts/bin/*.mjs` exports `run(argv, { cwd, env, stdout, stderr }) -> number` for programmatic use.
- No shell string interpolation in subprocess calls. Use arg arrays.
- All file writes use `writeAtomic` where crash safety matters.

## Spec and design

- Functional spec: [docs/specification.md](docs/specification.md) — 29 points, the hard contract.
- Implementation design: [docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md](docs/superpowers/specs/2026-04-20-autoreview-plugin-design.md).

If you're proposing a feature that changes spec semantics, update the spec alongside the code.

## License

MIT. By contributing you agree the contribution is licensed under MIT.
