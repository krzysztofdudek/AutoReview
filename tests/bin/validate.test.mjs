import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../scripts/bin/validate.mjs';
import { makeRepo } from '../lib/git-helpers.mjs';

function captureStreams() {
  const out = [], err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

test('exits 0 with warning when .autoreview missing', async () => {
  const { dir, cleanup } = await makeRepo();
  try {
    const streams = captureStreams();
    const code = await run([], { cwd: dir, env: process.env, ...streams });
    assert.equal(code, 0);
    assert.match(streams.err(), /not initialized/i);
  } finally { await cleanup(); }
});

test('hard context: failed rule -> exit 1', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  validate: hard\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[reject\]/);
  } finally { await cleanup(); }
});

test('soft precommit: failed rule -> exit 0 with [reject]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  precommit: soft\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[reject\]/);
  } finally { await cleanup(); }
});

test('precommit forces consensus=1', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'review:\n  consensus: 3\nenforcement:\n  precommit: soft\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
  } finally { await cleanup(); }
});

test('stub pass: exit 0 with [pass]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  validate: hard\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[pass\]/);
  } finally { await cleanup(); }
});
