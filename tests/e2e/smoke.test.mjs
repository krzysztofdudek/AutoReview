import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run as validate } from '../../scripts/bin/validate.mjs';

test('smoke: validate --scope staged with stub pass exits 0 with [pass]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-smoke-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });

    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(
      join(dir, '.autoreview/config.yaml'),
      `provider:\n  active: ollama\nenforcement:\n  validate: hard\n`,
    );
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\n---\nRule body.\n`,
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
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('smoke: hard enforcement + stub fail -> exit 1 with [reject]', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-smoke-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });

    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `enforcement:\n  validate: hard\n`);
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\n---\nbody`,
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
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('smoke: soft precommit + stub fail -> exit 0 with warning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-smoke-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), `enforcement:\n  precommit: soft\n`);
    await writeFile(
      join(dir, '.autoreview/rules/r.md'),
      `---\nname: "R"\ntriggers: 'path:"**/*.ts"'\n---\nbody`,
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
    assert.match(err.join(''), /\[reject\]/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
