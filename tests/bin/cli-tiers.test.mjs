import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
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

const TIER_CONFIG = `version: "0.1"
tiers:
  default:
    provider: anthropic
    model: stub
remote_rules: []
history:
  log_to_file: false
`;

test('auto rule pass + manual rule skipped without --rule', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), TIER_CONFIG);
    await writeFile(join(dir, '.autoreview/rules/auto-rule.md'),
      `---
name: "Auto"
triggers: 'path:"**/*.ts"'
tier: default
severity: error
type: auto
---
check`);
    await writeFile(join(dir, '.autoreview/rules/manual-rule.md'),
      `---
name: "Manual"
triggers: 'path:"**/*.ts"'
tier: default
severity: error
type: manual
---
check`);
    await writeFile(join(dir, 'demo.ts'), 'export const demo = 1;\n');
    git('add', 'demo.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'pass' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[pass\].*auto-rule/);
    assert.doesNotMatch(streams.err(), /manual-rule/);
  } finally { await cleanup(); }
});

test('--rule manual + severity:warning fail prints [warn] and exits 0', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), TIER_CONFIG);
    await writeFile(join(dir, '.autoreview/rules/manual-rule.md'),
      `---
name: "Manual Warning"
triggers: 'path:"**/*.ts"'
tier: default
severity: warning
type: manual
---
check`);
    await writeFile(join(dir, 'demo.ts'), 'export const demo = 1;\n');
    git('add', 'demo.ts');
    const streams = captureStreams();
    const code = await run(['--rule', 'manual-rule', '--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 0);
    assert.match(streams.err(), /\[warn\]/);
  } finally { await cleanup(); }
});

test('severity:error rule fails -> [reject] + exit 1', async () => {
  const { dir, run: git, cleanup } = await makeRepo();
  try {
    await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), TIER_CONFIG);
    await writeFile(join(dir, '.autoreview/rules/auto-rule.md'),
      `---
name: "Auto"
triggers: 'path:"**/*.ts"'
tier: default
severity: error
type: auto
---
check`);
    await writeFile(join(dir, 'demo.ts'), 'export const demo = 1;\n');
    git('add', 'demo.ts');
    const streams = captureStreams();
    const code = await run(['--scope', 'staged'], {
      cwd: dir, env: { ...process.env, AUTOREVIEW_STUB_PROVIDER: 'fail' }, ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.err(), /\[reject\]/);
  } finally { await cleanup(); }
});
