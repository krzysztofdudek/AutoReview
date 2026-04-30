# Contributing to AutoReview

## Setup

```bash
git clone https://github.com/krzysztofdudek/AutoReview.git
cd AutoReview
npm test    # should see ~440 passing (unit only)
```

Requires Node.js 22+. Zero npm dependencies — no `npm install` needed.

## Running tests

```bash
npm test              # unit (lib + bin + plugin + api), fast, no LLM, no skips
npm run test:e2e      # e2e against an OpenAI-compat server (your local LLM)
npm run test:ollama   # one round-trip against a real local Ollama daemon
npm run test:all      # unit + e2e, single command (CI-equivalent)
npm run coverage      # 90% lines/branches/functions gate
```

`test:e2e` and `coverage` load `.env` (Node 22 `--env-file-if-exists`) for per-developer overrides:

```bash
cp .env.example .env
# edit .env to point at your local llama-server / Ollama / mlx
```

`.env` is gitignored. Defaults from `.env.example` target `127.0.0.1:8089` (host-side llama-server with the GGUF Q4_K_M weights). Each e2e test guards itself with `serverAvailable()`, so without a server the suite still runs — failing tests are real failures, not missing infrastructure.

`test:ollama` exercises the Ollama connector specifically. It needs the daemon up and a model pulled. The default is `qwen2.5-coder:7b` (~4 GB); a tiny model is enough for the round-trip:

```bash
ollama pull qwen2.5-coder:0.5b
AUTOREVIEW_REAL_MODEL=qwen2.5-coder:0.5b npm run test:ollama
```

Without the daemon (`localhost:11434` unreachable) or the model the test skips with a clear reason — never fails because of missing infrastructure.

## Before opening a PR

1. `npm run test:all` passes.
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
