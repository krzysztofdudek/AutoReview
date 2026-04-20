import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/create-rule.mjs';
import { renderRule } from '../../scripts/lib/rule-authoring.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function mkRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-cr-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('renderRule produces YAML frontmatter + body', () => {
  const content = renderRule({
    name: 'Test Rule', triggers: 'path:"**/*.ts"', body: 'Rule body.',
  });
  assert.match(content, /name: "Test Rule"/);
  assert.match(content, /triggers: 'path:"\*\*\/\*\.ts"'/);
  assert.match(content, /Rule body\./);
});

test('save writes rule with frontmatter and body', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    const bodyPath = join(dir, 'tmp-body.md');
    await writeFile(bodyPath, 'Rule body here.');
    const c = capture();
    const code = await run([
      'save',
      '--name', 'Example',
      '--triggers', 'path:"**/*.ts"',
      '--body-file', bodyPath,
      '--to', 'api/example.md',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 0);
    const saved = await readFile(join(dir, '.autoreview/rules/api/example.md'), 'utf8');
    assert.match(saved, /name: "Example"/);
    assert.match(saved, /triggers: 'path:"\*\*\/\*\.ts"'/);
    assert.match(saved, /Rule body here\./);
  } finally { await cleanup(); }
});

test('breadth returns JSON with matches + sample', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    await writeFile(join(dir, 'a.ts'), 'x');
    await writeFile(join(dir, 'b.ts'), 'y');
    await writeFile(join(dir, 'c.md'), 'z');
    const c = capture();
    const code = await run(['breadth', '--expr', 'path:"**/*.ts"'], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 0);
    const out = JSON.parse(c.out());
    assert.equal(out.matches, 2);
    assert.ok(out.sample.includes('a.ts') || out.sample.includes('b.ts'));
  } finally { await cleanup(); }
});

test('errors on unknown subcommand', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['bogus'], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /unknown subcommand/);
  } finally { await cleanup(); }
});
