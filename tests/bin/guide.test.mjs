import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/guide.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function mkRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-guide-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('guide surfaces matching rule by query', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/handlers.md'),
      `---\nname: "Command Handler Pattern"\ntriggers: 'path:"**"'\ndescription: "command handler mutates state"\n---\nuse zod`);
    await writeFile(join(dir, '.autoreview/rules/irrelevant.md'),
      `---\nname: "Z"\ntriggers: 'path:"**"'\ndescription: "unrelated topic"\n---\nbody`);
    const c = capture();
    const code = await run(['how', 'do', 'I', 'write', 'a', 'command', 'handler?'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /handlers: command handler/i);
  } finally { await cleanup(); }
});

test('guide extracts linked paths from rule body (§29)', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/handlers.md'),
      `---\nname: "Command Handler Pattern"\ntriggers: 'path:"**"'\ndescription: "command handler mutates state"\n---\nSee [example](src/handlers/example.ts) or \`src/api/users.ts\` for reference.`);
    const c = capture();
    const code = await run(['command', 'handler'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /example code paths/);
    assert.match(c.out(), /src\/handlers\/example\.ts/);
    assert.match(c.out(), /src\/api\/users\.ts/);
  } finally { await cleanup(); }
});

test('guide returns no matches cleanly', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/a.md'),
      `---\nname: "Z"\ntriggers: 'path:"**"'\n---\nbody`);
    const c = capture();
    const code = await run(['banana', 'spaceship'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /No relevant rules found/);
  } finally { await cleanup(); }
});
