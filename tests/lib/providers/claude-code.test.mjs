import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execPath } from 'node:process';
import { create } from '../../../scripts/lib/providers/claude-code.mjs';

const fixDir = join(fileURLToPath(new URL('../', import.meta.url)), 'fixtures/fake-cli');
// Spawn `node <fixture.mjs>` so shebangs (which Windows ignores) don't matter.
const fix = (name) => ({ _binary: execPath, _argPrefix: [join(fixDir, name)] });

test('claude-code uses stdin mode and parses --output-format json envelope', async () => {
  // parseResponse drops `reason` when satisfied=true (redundant noise) — assert satisfied only.
  const p = create({ model: 'haiku', ...fix('ok-envelope.mjs') });
  const v = await p.verify('hello', { maxTokens: 100 });
  assert.equal(v.satisfied, true);
});

test('claude-code surfaces envelope.usage as structured token counts', async () => {
  const p = create({ model: 'haiku', ...fix('ok-envelope.mjs') });
  const v = await p.verify('hello', { maxTokens: 100 });
  assert.deepEqual(v.usage, { input_tokens: 12, output_tokens: 7, total_tokens: 19 });
});

// Tiny fixture helper. Returns the standard `{ dir, cleanup }` shape — caller
// destructures and wraps body in try { ... } finally { await cleanup(); }.
async function makeTempDir(tag) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), `ar-${tag}-`));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('claude-code passes max-isolation flags to the CLI', async () => {
  // Sentinel fixture echoes argv (after the script path) as JSON in the result envelope.
  // We inspect the request rather than the response: the provider must include the isolation
  // flags so review never picks up the caller's CLAUDE.md, plugins, hooks, or MCP servers.
  const { dir, cleanup } = await makeTempDir('cc-isol');
  try {
    const { writeFile, chmod } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const sentinel = join(dir, 'echo-argv.mjs');
    // satisfied:false on purpose — parseResponse drops reason when satisfied=true,
    // so we use a falsey verdict to surface the argv echo through to v.reason.
    await writeFile(sentinel,
      `#!/usr/bin/env node\n` +
      `const inner = JSON.stringify({ satisfied: false, reason: process.argv.slice(2).join(' ') });\n` +
      `const e = { type: 'result', result: '\`\`\`json\\n' + inner + '\\n\`\`\`' };\n` +
      `process.stdout.write(JSON.stringify(e));\n`);
    await chmod(sentinel, 0o755);
    const p = create({ model: 'haiku', _binary: execPath, _argPrefix: [sentinel] });
    const v = await p.verify('hello', {});
    for (const flag of [
      '--tools', '',
      '--disable-slash-commands',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--exclude-dynamic-system-prompt-sections',
      '--output-format', 'json',
    ]) {
      assert.match(v.reason, new RegExp(`(^|\\s)${flag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\s|$)`),
        `expected flag ${flag} in argv: ${v.reason}`);
    }
  } finally { await cleanup(); }
});

test('claude-code isAvailable returns false when binary missing', async () => {
  const p = create({ model: 'haiku', _binary: 'definitely-not-installed-xyz' });
  assert.equal(await p.isAvailable(), false);
});

test('claude-code isAvailable returns true when binary resolvable', async () => {
  const p = create({ model: 'haiku', _binary: execPath });
  assert.equal(await p.isAvailable(), true);
});

test('claude-code non-zero exit -> providerError with stderr', async () => {
  const p = create({ model: 'haiku', ...fix('err.mjs') });
  const v = await p.verify('hello', { maxTokens: 10 });
  assert.equal(v.providerError, true);
  assert.match(String(v.raw), /boom/);
});

test('claude-code timeout -> providerError with "timeout" raw', async () => {
  const { runCli } = await import('../../../scripts/lib/cli-base.mjs');
  const r = await runCli({ binary: execPath, args: [join(fixDir, 'timeout.mjs')], timeoutMs: 100 });
  assert.equal(r.timedOut, true);
});

test('claude-code contextWindowBytes = 200k tokens (~800kB)', async () => {
  const p = create({ model: 'haiku', ...fix('ok-envelope.mjs') });
  assert.equal(await p.contextWindowBytes(), 200_000 * 4);
});

test('claude-code invalid JSON stdout -> providerError', async () => {
  const { writeFile, chmod } = await import('node:fs/promises');
  const { dir, cleanup } = await makeTempDir('cc-json');
  try {
    const fixture = join(dir, 'bad-json.mjs');
    await writeFile(fixture, `#!/usr/bin/env node\nprocess.stdout.write('not json at all');\nprocess.exit(0);\n`);
    await chmod(fixture, 0o755);
    const p = create({ model: 'haiku', _binary: execPath, _argPrefix: [fixture] });
    const v = await p.verify('hello', {});
    assert.equal(v.providerError, true);
    assert.equal(v.raw, 'not json at all');
  } finally { await cleanup(); }
});

test('claude-code envelope without usage -> no usage field on result', async () => {
  const { writeFile, chmod } = await import('node:fs/promises');
  const { dir, cleanup } = await makeTempDir('cc-nousage');
  try {
    const fixture = join(dir, 'no-usage.mjs');
    const inner = JSON.stringify({ satisfied: true, reason: 'ok' });
    const envelope = JSON.stringify({ type: 'result', result: '```json\n' + inner + '\n```' });
    await writeFile(fixture, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(envelope)});\nprocess.exit(0);\n`);
    await chmod(fixture, 0o755);
    const p = create({ model: 'haiku', _binary: execPath, _argPrefix: [fixture] });
    const v = await p.verify('hello', {});
    assert.equal(v.satisfied, true);
    assert.equal(v.usage, undefined);
  } finally { await cleanup(); }
});

test('claude-code envelope usage without total_tokens -> derives total from input+output', async () => {
  const { writeFile, chmod } = await import('node:fs/promises');
  const { dir, cleanup } = await makeTempDir('cc-total');
  try {
    const fixture = join(dir, 'no-total.mjs');
    const inner = JSON.stringify({ satisfied: true, reason: 'ok' });
    const envelope = JSON.stringify({
      type: 'result',
      result: '```json\n' + inner + '\n```',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    await writeFile(fixture, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(envelope)});\nprocess.exit(0);\n`);
    await chmod(fixture, 0o755);
    const p = create({ model: 'haiku', _binary: execPath, _argPrefix: [fixture] });
    const v = await p.verify('hello', {});
    assert.deepEqual(v.usage, { input_tokens: 5, output_tokens: 3, total_tokens: 8 });
  } finally { await cleanup(); }
});
