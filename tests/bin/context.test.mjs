import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/context.mjs';

function capture() {
  const out = [], err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

async function mkRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-ctx-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('context lists rules matching a path', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/api.md'),
      `---\nname: "API"\ntriggers: 'path:"src/api/**"'\ndescription: "api rules"\n---\nbody`);
    await writeFile(join(dir, '.autoreview/rules/style.md'),
      `---\nname: "Style"\ntriggers: 'path:"**/*.ts"'\ndescription: "ts style"\n---\nbody`);
    await mkdir(join(dir, 'src/api'), { recursive: true });
    await writeFile(join(dir, 'src/api/users.ts'), 'x');
    const c = capture();
    const code = await run(['src/api/users.ts'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /api: api rules/);
    assert.match(c.out(), /style: ts style/);
  } finally { await cleanup(); }
});

test('context with no args lists all rules', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/a.md'),
      `---\nname: "A"\ntriggers: 'path:"**"'\ndescription: "rule a"\n---\nbody`);
    await writeFile(join(dir, '.autoreview/rules/b.md'),
      `---\nname: "B"\ntriggers: 'path:"**"'\ndescription: "rule b"\n---\nbody`);
    const c = capture();
    const code = await run([], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /All rules \(2\)/);
    assert.match(c.out(), /a: rule a/);
    assert.match(c.out(), /b: rule b/);
  } finally { await cleanup(); }
});

test('context returns "no rules match" cleanly', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/a.md'),
      `---\nname: "A"\ntriggers: 'path:"nothing/**"'\n---\nbody`);
    const c = capture();
    const code = await run(['other.ts'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /No rules match/);
  } finally { await cleanup(); }
});

test('context shows tier and severity in effective frontmatter', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/api.md'),
      `---\nname: "API"\ntriggers: 'path:"src/**"'\ntier: critical\nseverity: warning\ndescription: "api rules"\n---\nbody`);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/foo.ts'), 'x');
    const c = capture();
    const code = await run(['src/foo.ts'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /tier: critical/);
    assert.match(c.out(), /severity: warning/);
  } finally { await cleanup(); }
});

test('context shows [manual] marker for type:manual rules', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/manual.md'),
      `---\nname: "Manual"\ntriggers: 'path:"src/**"'\ntype: manual\ndescription: "manual rule"\n---\nbody`);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/foo.ts'), 'x');
    const c = capture();
    const code = await run(['src/foo.ts'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /\[manual\]/);
  } finally { await cleanup(); }
});

test('context shows [invalid:] marker for rules with bad frontmatter values', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/bad.md'),
      `---\nname: "Bad"\ntriggers: 'path:"src/**"'\ntier: bogus\ndescription: "bad tier"\n---\nbody`);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/foo.ts'), 'x');
    const c = capture();
    const code = await run(['src/foo.ts'], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /\[invalid:/);
    assert.match(c.out(), /bogus/);
  } finally { await cleanup(); }
});
