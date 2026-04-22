import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../scripts/bin/session-start.mjs';

function capture() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

test('exits 0 with actionable init hint when no .autoreview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-ss-'));
  try {
    const c = capture();
    const code = await run([], { cwd: dir, env: {}, ...c });
    assert.equal(code, 0);
    // Hint now goes to stdout so the agent sees it in its context and can relay to the user.
    assert.match(c.out(), /\[autoreview\].*\.autoreview.*does not exist/);
    assert.match(c.out(), /\/autoreview:init/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('emits operating manual to stdout when config present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-ss-'));
  try {
    await mkdir(join(dir, '.autoreview'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'provider:\n  active: ollama\n');
    await mkdir(join(dir, 'templates'), { recursive: true });
    await writeFile(join(dir, 'templates/agent-rules.md'), '# agent rules\n');
    const c = capture();
    const code = await run([], { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: dir }, ...c });
    assert.equal(code, 0);
    assert.match(c.out(), /agent rules/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
