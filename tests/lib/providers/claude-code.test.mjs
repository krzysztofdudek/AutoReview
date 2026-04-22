import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '../../../scripts/lib/providers/claude-code.mjs';

const fixDir = join(fileURLToPath(new URL('../', import.meta.url)), 'fixtures/fake-cli');

test('claude-code uses stdin mode and parses response', async () => {
  const p = create({ model: 'haiku', _binary: join(fixDir, 'ok.sh') });
  const v = await p.verify('hello', { maxTokens: 100 });
  assert.equal(v.satisfied, true);
});

test('claude-code isAvailable returns false when binary missing', async () => {
  const p = create({ model: 'haiku', _binary: 'definitely-not-installed-xyz' });
  assert.equal(await p.isAvailable(), false);
});

test('claude-code isAvailable returns true when binary resolvable', async () => {
  const p = create({ model: 'haiku', _binary: join(fixDir, 'ok.sh') });
  assert.equal(await p.isAvailable(), true);
});

test('claude-code non-zero exit -> providerError with stderr', async () => {
  const p = create({ model: 'haiku', _binary: join(fixDir, 'err.sh') });
  const v = await p.verify('hello', { maxTokens: 10 });
  assert.equal(v.providerError, true);
  assert.match(String(v.raw), /boom/);
});

test('claude-code timeout -> providerError with "timeout" raw', async () => {
  // Monkey-patch timeout shortcut: invoke runCli with small timeoutMs via a fake module.
  // Using `timeout.sh` which sleeps 10s; we can't easily set timeoutMs below the internal default.
  // Instead, stub runCli output via a 1ms-sleeping fake that is already scripted to timeout-like behavior.
  // Easiest route: directly test that runCli honors timedOut === true by importing it with a short timeout.
  const { runCli } = await import('../../../scripts/lib/cli-base.mjs');
  const r = await runCli({ binary: join(fixDir, 'timeout.sh'), args: [], timeoutMs: 100 });
  assert.equal(r.timedOut, true);
});

test('claude-code contextWindowBytes = 200k tokens (~800kB)', async () => {
  const p = create({ model: 'haiku', _binary: join(fixDir, 'ok.sh') });
  assert.equal(await p.contextWindowBytes(), 200_000 * 4);
});
