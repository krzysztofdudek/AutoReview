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

test('real Ollama round-trip: pass verdict on trivial passing rule', async (t) => {
  if (!ENABLED) return t.skip('set AUTOREVIEW_REAL_OLLAMA=1 to run');
  if (!await ollamaAvailable()) return t.skip(`Ollama daemon ${OLLAMA_HOST} unreachable`);
  const dir = await mkdtemp(join(tmpdir(), 'ar-real-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });

    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      `provider:\n  active: ollama\n  ollama:\n    endpoint: "${process.env.OLLAMA_HOST ?? 'http://localhost:11434'}"\n    model: "${process.env.AUTOREVIEW_REAL_MODEL ?? 'qwen2.5-coder:7b'}"\nenforcement:\n  validate: hard\n`);
    // Rule that any non-empty file trivially satisfies — stress-test the round-trip, not the model.
    await writeFile(join(dir, '.autoreview/rules/r.md'),
      `---\nname: "File exists"\ntriggers: 'path:"**/*.ts"'\n---\nFile must be non-empty. Any content satisfies this.`);
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
  } finally { await rm(dir, { recursive: true, force: true }); }
});
