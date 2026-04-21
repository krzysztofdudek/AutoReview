import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '../../../scripts/lib/providers/codex.mjs';

const fixDir = join(fileURLToPath(new URL('../', import.meta.url)), 'fixtures/fake-cli');

test('codex uses stdin mode and parses response', async () => {
  const p = create({ model: 'gpt-5', _binary: join(fixDir, 'ok.sh') });
  const v = await p.verify('hello', { maxTokens: 100 });
  assert.equal(v.satisfied, true);
});

test('codex isAvailable returns false when binary missing', async () => {
  const p = create({ model: 'gpt-5', _binary: 'definitely-not-installed-xyz' });
  assert.equal(await p.isAvailable(), false);
});
