import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
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

test('auto-upgrades .autoreview/runtime when plugin version has bumped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ar-ss-upgrade-'));
  try {
    // Repo side: .autoreview/ with a stale runtime pinned to 0.1.0
    await mkdir(join(dir, '.autoreview/runtime/lib'), { recursive: true });
    await mkdir(join(dir, '.autoreview/runtime/bin'), { recursive: true });
    await writeFile(join(dir, '.autoreview/config.yaml'), 'provider:\n  active: ollama\n');
    await writeFile(join(dir, '.autoreview/runtime/.version'), '0.1.0\n');
    await writeFile(join(dir, '.autoreview/runtime/lib/marker.mjs'), 'STALE\n');

    // Plugin side: 0.1.1 with fresh sources
    const plug = await mkdtemp(join(tmpdir(), 'ar-ss-plug-'));
    await mkdir(join(plug, '.claude-plugin'), { recursive: true });
    await writeFile(join(plug, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'autoreview', version: '0.1.1' }));
    await mkdir(join(plug, 'scripts/lib'), { recursive: true });
    await mkdir(join(plug, 'scripts/bin'), { recursive: true });
    await writeFile(join(plug, 'scripts/lib/marker.mjs'), "export const V = '0.1.1';\n");
    await writeFile(join(plug, 'scripts/bin/validate.mjs'), '// fresh\n');
    await mkdir(join(plug, 'templates'), { recursive: true });
    await writeFile(join(plug, 'templates/agent-rules.md'), '# manual\n');

    try {
      const c = capture();
      const code = await run([], { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: plug }, ...c });
      assert.equal(code, 0);
      assert.match(c.out(), /runtime upgraded 0\.1\.0 → 0\.1\.1/);
      const marker = await readFile(join(dir, '.autoreview/runtime/lib/marker.mjs'), 'utf8');
      assert.match(marker, /0\.1\.1/);
    } finally {
      await rm(plug, { recursive: true, force: true });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
