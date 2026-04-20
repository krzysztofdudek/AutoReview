import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('precommit-hook.sh has shebang and calls validate with correct flags', async () => {
  const body = await readFile('templates/precommit-hook.sh', 'utf8');
  assert.match(body, /^#!\/usr\/bin\/env sh/);
  assert.match(body, /\.autoreview\/runtime\/bin\/validate\.mjs/);
  assert.match(body, /--scope staged/);
  assert.match(body, /--context precommit/);
  assert.match(body, /"\$@"/);
});

test('precommit-hook.sh file exists', async () => {
  await stat('templates/precommit-hook.sh');
});
