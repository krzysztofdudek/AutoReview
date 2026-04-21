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
