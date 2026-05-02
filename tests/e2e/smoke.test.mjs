import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run as validate } from '../../scripts/bin/validate.mjs';

async function makeValidateRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-smoke-'));
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 't@t');
  run('config', 'user.name', 't');
  run('commit', '--allow-empty', '-q', '-m', 'init');
  return { dir, run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('smoke: validate --scope staged with stub pass exits 0 with [pass]', async () => {
  const { dir, cleanup } = await makeValidateRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(
      join(dir, '.autoreview/config.yaml'),
      `version: "0.1"\ntiers:\n  default:\n    provider: ollama\n    model: qwen2.5-coder:7b\n    endpoint: http://localhost:11434\nremote_rules: []\nhistory:\n  log_to_file: false\n`,
    );
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\nseverity: error\ntype: auto\n---\nRule body.\n`,
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    spawnSync('git', ['add', 'a.ts'], { cwd: dir });

    const out = [], err = [];
    const code = await validate(['--scope', 'staged'], {
      cwd: dir,
      env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' },
      stdout: { write: s => out.push(s) },
      stderr: { write: s => err.push(s) },
    });
    assert.equal(code, 0);
    assert.match(err.join(''), /\[pass\]/);
  } finally { await cleanup(); }
});

test('smoke: severity:error + stub fail -> exit 1 with [reject]', async () => {
  const { dir, cleanup } = await makeValidateRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(
      join(dir, '.autoreview/config.yaml'),
      `version: "0.1"\ntiers:\n  default:\n    provider: ollama\n    model: qwen2.5-coder:7b\n    endpoint: http://localhost:11434\nremote_rules: []\nhistory:\n  log_to_file: false\n`,
    );
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\nseverity: error\ntype: auto\n---\nbody`,
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    spawnSync('git', ['add', 'a.ts'], { cwd: dir });

    const out = [], err = [];
    const code = await validate(['--scope', 'staged'], {
      cwd: dir,
      env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' },
      stdout: { write: s => out.push(s) },
      stderr: { write: s => err.push(s) },
    });
    assert.equal(code, 1);
    assert.match(err.join(''), /\[reject\]/);
  } finally { await cleanup(); }
});

test('smoke: severity:warning + stub fail -> exit 0 with [warn]', async () => {
  const { dir, cleanup } = await makeValidateRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(
      join(dir, '.autoreview/config.yaml'),
      `version: "0.1"\ntiers:\n  default:\n    provider: ollama\n    model: qwen2.5-coder:7b\n    endpoint: http://localhost:11434\nremote_rules: []\nhistory:\n  log_to_file: false\n`,
    );
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\nseverity: warning\ntype: auto\n---\nbody`,
    );
    await writeFile(join(dir, 'a.ts'), 'x');
    spawnSync('git', ['add', 'a.ts'], { cwd: dir });

    const err = [];
    const code = await validate(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir,
      env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' },
      stdout: { write: () => {} },
      stderr: { write: s => err.push(s) },
    });
    assert.equal(code, 0);
    assert.match(err.join(''), /\[warn\]/);
  } finally { await cleanup(); }
});
