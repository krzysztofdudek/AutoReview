import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run as validate } from '../../scripts/bin/validate.mjs';
import { request } from '../../scripts/lib/http-client.mjs';

const ENABLED = process.env.AUTOREVIEW_REAL_OLLAMA === '1';
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

async function ollamaAvailable(timeoutMs = 1500) {
  try {
    const r = await request({ url: OLLAMA_HOST.replace(/\/$/, '') + '/api/tags', method: 'GET', timeoutMs });
    return r.status === 200;
  } catch { return false; }
}

async function makeValidateRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-real-'));
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  run('commit', '--allow-empty', '-q', '-m', 'init');
  return { dir, run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('real Ollama round-trip: pass verdict on trivial passing rule', async (t) => {
  if (!ENABLED) return t.skip('set AUTOREVIEW_REAL_OLLAMA=1 to run');
  if (!await ollamaAvailable()) return t.skip(`Ollama daemon ${OLLAMA_HOST} unreachable`);
  const { dir, cleanup } = await makeValidateRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    const endpoint = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
    const model = process.env.AUTOREVIEW_REAL_MODEL ?? 'qwen2.5-coder:7b';
    await writeFile(join(dir, '.autoreview/config.yaml'),
      `version: "0.1"\ntiers:\n  default:\n    provider: ollama\n    model: "${model}"\n    endpoint: "${endpoint}"\nremote_rules: []\nhistory:\n  log_to_file: false\n`);
    // Rule that any non-empty file trivially satisfies — stress-test the round-trip, not the model.
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: "File exists"\ntriggers: 'path:"**/*.ts"'\nseverity: error\ntype: auto\n---\nFile must be non-empty. Any content satisfies this.`);
    await writeFile(join(dir, 'a.ts'), 'export const x = 1;\n');
    spawnSync('git', ['add', 'a.ts'], { cwd: dir });

    const err = [];
    const code = await validate(['--scope', 'staged'], {
      cwd: dir,
      env: process.env,
      stdout: { write: () => {} },
      stderr: { write: s => err.push(s) },
    });
    assert.equal(code, 0, `expected pass, got exit=${code}; stderr=${err.join('')}`);
    assert.match(err.join(''), /\[pass\]/);
  } finally { await cleanup(); }
});
