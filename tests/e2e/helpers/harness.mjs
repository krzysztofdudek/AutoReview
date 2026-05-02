// tests/e2e/helpers/harness.mjs — per-test scratch repo in tests/.e2e-scratch/

import { mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from '../../../scripts/lib/http-client.mjs';

const __here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__here, '../../..');
export const SCRATCH_ROOT = join(REPO_ROOT, 'tests/.e2e-scratch');
export const CLI = join(REPO_ROOT, 'scripts/bin/autoreview.mjs');

export const SERVER_ENDPOINT = process.env.AUTOREVIEW_E2E_ENDPOINT ?? 'http://127.0.0.1:8080/v1';
export const SERVER_MODEL = process.env.AUTOREVIEW_E2E_MODEL ?? 'unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit';

export const E2E_ENABLED = process.env.AUTOREVIEW_E2E === '1';

let seq = 0;
function nextId(tag) { return `${tag}-${process.pid}-${++seq}-${Date.now().toString(36)}`; }

export async function createEnv(tag, { noGit = false } = {}) {
  // Git-less scratches must live outside REPO_ROOT — otherwise `git rev-parse --show-toplevel`
  // walks up and "discovers" AutoReview's own repo root. Use OS tmpdir instead.
  const base = noGit ? tmpdir() : SCRATCH_ROOT;
  const dir = join(base, nextId(tag));
  await mkdir(dir, { recursive: true });
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (!noGit) {
    git('init', '-q');
    git('config', 'user.email', 'e2e@test');
    git('config', 'user.name', 'e2e');
    git('commit', '--allow-empty', '-q', '-m', 'init');
  }

  return {
    dir,
    git,
    // Same as `git` but accepts extra env vars (for invoking hooks during `git commit`).
    gitEnv(extraEnv, ...args) {
      return spawnSync('git', args, {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, ...extraEnv },
      });
    },

    async write(rel, body) {
      const p = join(dir, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
      return p;
    },

    async writeRule(relName, { name, triggers, ...extra }, body) {
      const fmLines = [`name: ${JSON.stringify(name)}`, `triggers: ${JSON.stringify(triggers)}`];
      for (const [k, v] of Object.entries(extra)) fmLines.push(`${k}: ${JSON.stringify(v)}`);
      const content = `---\n${fmLines.join('\n')}\n---\n${body ?? ''}\n`;
      return this.write(`.autoreview/rules/${relName}`, content);
    },

    async writeConfig(overrides = {}) {
      const cfg = {
        version: '0.1',
        tiers: {
          default: {
            provider: 'openai-compat',
            model: SERVER_MODEL,
            endpoint: SERVER_ENDPOINT,
            parallel: 1,
            mode: 'quick',
            consensus: 1,
          },
        },
        remote_rules: [],
        history: { log_to_file: true },
        ...overrides,
      };
      const y = toYaml(cfg);
      await this.write('.autoreview/config.yaml', y);
      await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
      await mkdir(join(dir, '.autoreview/.history'), { recursive: true });
      return y;
    },

    async run(sub, args = [], { env: extraEnv = {}, stub = null } = {}) {
      // Single shared import; CLI dispatchers are stateless. Avoids defeating V8
      // coverage tracking (each fresh import was creating a new module instance
      // where coverage data did not aggregate).
      const mod = await import(CLI);
      const out = [], err = [];
      const baseEnv = {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: REPO_ROOT,
        AUTOREVIEW_PLUGIN_ROOT: REPO_ROOT,
        ...extraEnv,
      };
      if (stub) baseEnv.AUTOREVIEW_STUB_PROVIDER = stub;
      const code = await mod.run([sub, ...args], {
        cwd: dir,
        env: baseEnv,
        stdout: { write: (s) => { out.push(s); return true; } },
        stderr: { write: (s) => { err.push(s); return true; } },
      });
      return { code: code ?? 0, stdout: out.join(''), stderr: err.join('') };
    },

    async runHook(hookPath, { env: extraEnv = {}, args = [] } = {}) {
      // Run pre-commit hook as a shell script (bash), cwd = repo.
      // `args` appended — must flow through the hook's `"$@"` to the CLI.
      const res = spawnSync('bash', [hookPath, ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT, AUTOREVIEW_PLUGIN_ROOT: REPO_ROOT, ...extraEnv },
      });
      return { code: res.status ?? 2, stdout: res.stdout, stderr: res.stderr };
    },

    async makeExecutable(relPath) {
      await chmod(join(dir, relPath), 0o755);
    },

    async read(rel) {
      return readFile(join(dir, rel), 'utf8');
    },

    exists(rel) {
      return existsSync(join(dir, rel));
    },

    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// Minimal yaml emitter for our controlled config tree (objects/strings/numbers/bools/arrays)
function toYaml(v, indent = 0) {
  const pad = '  '.repeat(indent);
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '\n' + v.map(item => `${pad}- ${toYamlInline(item, indent + 1)}`).join('\n');
  }
  if (typeof v === 'object') {
    const lines = [];
    for (const [k, val] of Object.entries(v)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        lines.push(`${pad}${k}:\n${toYaml(val, indent + 1)}`);
      } else if (Array.isArray(val)) {
        if (val.length === 0) lines.push(`${pad}${k}: []`);
        else lines.push(`${pad}${k}:${toYaml(val, indent + 1)}`);
      } else {
        lines.push(`${pad}${k}: ${toYaml(val, indent)}`);
      }
    }
    return lines.join('\n');
  }
  return String(v);
}
function toYamlInline(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// Best-effort server probe; returns true if reachable.
export async function serverAvailable(timeoutMs = 1500) {
  try {
    const url = SERVER_ENDPOINT.replace(/\/$/, '') + '/models';
    const r = await request({ url, method: 'GET', timeoutMs });
    return r.status === 200;
  } catch { return false; }
}

// Helper: skip test when E2E disabled.
export function skipUnlessE2E(t) {
  if (!E2E_ENABLED) t.skip('set AUTOREVIEW_E2E=1 to enable');
}

// Helper: skip test when LLM server is unreachable (after E2E enabled).
export async function skipUnlessServer(t) {
  if (!await serverAvailable()) t.skip(`server ${SERVER_ENDPOINT} unreachable`);
}
