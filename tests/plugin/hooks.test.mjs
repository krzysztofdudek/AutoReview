import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
const accessP = promisify(access);

test('hooks.json valid and points to session-start.sh', async () => {
  const raw = await readFile('hooks/hooks.json', 'utf8');
  const h = JSON.parse(raw);
  assert.ok(h.hooks.SessionStart);
  const entry = h.hooks.SessionStart[0];
  assert.equal(entry.matcher, 'startup');
  assert.ok(Array.isArray(entry.hooks), 'matcher entry must carry a nested hooks array');
  assert.match(entry.hooks[0].command, /session-start\.sh/);
});

test('session-start.sh is executable', async () => {
  await accessP('hooks/session-start.sh', constants.X_OK);
});
