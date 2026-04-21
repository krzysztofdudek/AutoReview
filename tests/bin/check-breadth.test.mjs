import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/check-breadth.mjs';

function capture() {
  const out = [], err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

async function fixtureRepo(paths) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cb-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  for (const p of paths) {
    const full = join(dir, p);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, 'x');
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('check-breadth reports matches and sample paths', async () => {
  const { dir, cleanup } = await fixtureRepo([
    'src/api/a.ts', 'src/api/b.ts', 'src/other/c.ts', 'README.md',
  ]);
  try {
    const c = capture();
    const code = await run(['--expr', 'path:"src/api/**"'], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /2 matches/);
    assert.match(c.out(), /src\/api\/a\.ts/);
  } finally { await cleanup(); }
});

test('check-breadth errors on missing args', async () => {
  const { dir, cleanup } = await fixtureRepo([]);
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--expr or --rule required/);
  } finally { await cleanup(); }
});
