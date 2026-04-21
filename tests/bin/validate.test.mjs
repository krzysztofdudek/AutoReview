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

test('internal crash in validate context exits 2 (3-state spec §28)', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  validate: hard\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    // Mutually-exclusive scope args trigger a throw from scope-resolver inside _run
    const code = await run(['--scope', 'staged', '--sha', 'HEAD'], {
      cwd: dir, env: process.env, ...streams,
    });
    assert.equal(code, 2);
    assert.match(streams.err(), /\[error\] internal/);
  } finally { await cleanup(); }
});

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

test('stub error in validate (hard) context exits 1 with [error]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  validate: hard\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'error' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[error\]/);
  } finally { await cleanup(); }
});

test('stub error in precommit (soft) context exits 0 with [error]', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'enforcement:\n  precommit: soft\n');
    await writeFile(join(dir, '.autoreview/rules/r.md'), `---\nname: R\ntriggers: 'path:"**/*.ts"'\n---\nbody`);
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged', '--context', 'precommit'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'error' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[error\]/);
  } finally { await cleanup(); }
});

test('validate warns when declared remote source is not cached', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'),
      'remote_rules:\n  - name: missing\n    url: "http://nowhere"\n    ref: v1\n    path: .\n');
    await writeFile(join(dir, 'a.ts'), 'x');
    git('add', 'a.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /remote source 'missing@v1' has no cache/);
  } finally { await cleanup(); }
});
