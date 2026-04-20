import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('every skill has a name + description frontmatter', async () => {
  const skills = await readdir('skills');
  for (const s of skills) {
    const body = await readFile(`skills/${s}/SKILL.md`, 'utf8');
    assert.match(body, /description:/m, `${s} missing description`);
    assert.match(body, /name:/m, `${s} missing name`);
  }
});

test('all 5 expected skills exist', async () => {
  const skills = await readdir('skills');
  const expected = ['autoreview-setup', 'autoreview-create-rule', 'autoreview-review', 'autoreview-context', 'autoreview-guide'];
  for (const e of expected) assert.ok(skills.includes(e), `missing skill: ${e}`);
});
