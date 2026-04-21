import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('all 7 commands exist', async () => {
  const cmds = await readdir('commands');
  const expected = ['init.md', 'validate.md', 'create-rule.md', 'check-breadth.md', 'context.md', 'pull-remote.md', 'guide.md'];
  for (const e of expected) assert.ok(cmds.includes(e), `missing command: ${e}`);
});

test('every slash command (except create-rule delegate) references scripts/bin', async () => {
  const cmds = await readdir('commands');
  for (const c of cmds) {
    const body = await readFile(`commands/${c}`, 'utf8');
    if (c === 'create-rule.md') continue;
    assert.match(body, /scripts\/bin\//, `${c} missing bin reference`);
  }
});
