import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../scripts/bin/override-rule.mjs';

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
  const dir = await mkdtemp(join(tmpdir(), 'ar-or-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  await mkdir(join(dir, '.autoreview'), { recursive: true });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('save appends override to existing remote_rules entry', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'version: "0.1"',
      'tiers:',
      '  default:',
      '    provider: ollama',
      '    model: qwen2.5-coder:7b',
      '    endpoint: http://localhost:11434',
      'remote_rules:',
      '  - name: corp-standards',
      '    url: https://github.com/acme/rules',
      '    ref: v1.0.0',
      '    path: rules',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);

    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp-standards',
      '--rule', 'audit-log-on-handlers',
      '--field', 'tier=trivial',
      '--field', 'severity=warning',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /overrides:/);
    assert.match(saved, /audit-log-on-handlers:/);
    assert.match(saved, /tier: trivial/);
    assert.match(saved, /severity: warning/);
  } finally { await cleanup(); }
});

test('save writes to config.personal.yaml when --scope personal', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp-standards',
      '--rule', 'no-todo-without-ticket',
      '--field', 'type=manual',
      '--scope', 'personal',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const personal = await readFile(join(dir, '.autoreview/config.personal.yaml'), 'utf8');
    assert.match(personal, /no-todo-without-ticket:/);
    assert.match(personal, /type: manual/);
  } finally { await cleanup(); }
});

test('save null value writes null to override field', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'remote_rules:',
      '  - name: corp',
      '    url: https://github.com/acme/rules',
      '    ref: v1.0.0',
      '    overrides:',
      '      some-rule:',
      '        tier: trivial',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);

    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'some-rule',
      '--field', 'tier=null',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /tier: null/);
  } finally { await cleanup(); }
});

test('save rejects unknown override field name', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'some-rule',
      '--field', 'body=some content',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 1);
    assert.match(c.err(), /unknown override field: body/);
  } finally { await cleanup(); }
});

test('errors when no subcommand given', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /usage: override-rule save/);
  } finally { await cleanup(); }
});

test('errors on unknown subcommand', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['delete', '--remote', 'corp', '--rule', 'r', '--field', 'tier=trivial'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /unknown subcommand: delete/);
  } finally { await cleanup(); }
});

test('errors when --remote missing', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['save', '--rule', 'r', '--field', 'tier=trivial'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /save requires --remote/);
  } finally { await cleanup(); }
});

test('errors when --rule missing', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['save', '--remote', 'corp', '--field', 'tier=trivial'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /save requires --rule/);
  } finally { await cleanup(); }
});

test('errors when --field missing', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['save', '--remote', 'corp', '--rule', 'r'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /save requires at least one --field/);
  } finally { await cleanup(); }
});

test('errors when --scope is invalid value', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['save', '--remote', 'corp', '--rule', 'r', '--field', 'tier=trivial', '--scope', 'global'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--scope must be repo or personal/);
  } finally { await cleanup(); }
});

test('errors when --field value has no equals sign', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run(['save', '--remote', 'corp', '--rule', 'r', '--field', 'tiertrivial'],
      { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--field must be in name=value format/);
  } finally { await cleanup(); }
});

test('save appends new remote_rules section when none exists', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = 'version: "0.1"\n';
    await writeFile(join(dir, '.autoreview/config.yaml'), config);
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'new-remote',
      '--rule', 'my-rule',
      '--field', 'severity=warning',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /remote_rules:/);
    assert.match(saved, /name: new-remote/);
    assert.match(saved, /my-rule:/);
    assert.match(saved, /severity: warning/);
  } finally { await cleanup(); }
});

test('save appends list item under existing remote_rules section when name not found', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'version: "0.1"',
      'remote_rules:',
      '  - name: existing-remote',
      '    url: https://github.com/acme/rules',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'another-remote',
      '--rule', 'some-rule',
      '--field', 'tier=heavy',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /another-remote/);
    assert.match(saved, /some-rule:/);
    assert.match(saved, /tier: heavy/);
  } finally { await cleanup(); }
});

test('save adds rule override when overrides block exists but rule not in it', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'remote_rules:',
      '  - name: corp',
      '    url: https://github.com/acme/rules',
      '    overrides:',
      '      existing-rule:',
      '        tier: trivial',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'new-rule',
      '--field', 'severity=warning',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /new-rule:/);
    assert.match(saved, /severity: warning/);
  } finally { await cleanup(); }
});

test('save adds new field to existing rule override block when field not present', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'remote_rules:',
      '  - name: corp',
      '    url: https://github.com/acme/rules',
      '    overrides:',
      '      my-rule:',
      '        tier: trivial',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'my-rule',
      '--field', 'severity=warning',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /severity: warning/);
    assert.match(saved, /tier: trivial/);
  } finally { await cleanup(); }
});

test('save handles multi-line list item format (name on separate line)', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const config = [
      'remote_rules:',
      '  - ',
      '    name: corp-standards',
      '    url: https://github.com/acme/rules',
    ].join('\n');
    await writeFile(join(dir, '.autoreview/config.yaml'), config);
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp-standards',
      '--rule', 'audit-rule',
      '--field', 'tier=standard',
    ], { cwd: dir, env: process.env, ...c });

    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /audit-rule:/);
    assert.match(saved, /tier: standard/);
  } finally { await cleanup(); }
});

test('run() catches thrown errors and returns 2', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const errMsgs = [];
    // stdout.write throws after success path; run() outer catch writes to stderr.
    const broken = {
      stdout: { write: () => { throw new Error('intentional boom'); } },
      stderr: { write: (s) => errMsgs.push(s) },
    };
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'r',
      '--field', 'tier=trivial',
    ], { cwd: dir, env: process.env, ...broken });
    assert.equal(code, 2);
    assert.match(errMsgs.join(''), /internal.*intentional boom/);
  } finally { await cleanup(); }
});

test('save rejects --remote with space in name', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save', '--remote', 'foo bar', '--rule', 'r', '--field', 'tier=trivial',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--remote must match \[A-Za-z0-9\._-\]\+/);
  } finally { await cleanup(); }
});

test('save rejects --remote with newline injection', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save', '--remote', 'corp\ninjected', '--rule', 'r', '--field', 'tier=trivial',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--remote must match/);
  } finally { await cleanup(); }
});

test('save rejects --rule with space in id', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save', '--remote', 'corp', '--rule', 'id with space', '--field', 'tier=trivial',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--rule must match/);
  } finally { await cleanup(); }
});

test('save rejects --field with newline in value', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save', '--remote', 'corp', '--rule', 'r', '--field', 'tier=foo\nbar',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 1);
    assert.match(c.err(), /--field must not contain newlines/);
  } finally { await cleanup(); }
});

test('save field value with equals sign in value preserves full value', async () => {
  const { dir, cleanup } = await mkRepo();
  try {
    const c = capture();
    const code = await run([
      'save',
      '--remote', 'corp',
      '--rule', 'r',
      '--field', 'description=some=value=with=equals',
    ], { cwd: dir, env: process.env, ...c });
    assert.equal(code, 0, c.err());
    const saved = await readFile(join(dir, '.autoreview/config.yaml'), 'utf8');
    assert.match(saved, /description: some=value=with=equals/);
  } finally { await cleanup(); }
});
