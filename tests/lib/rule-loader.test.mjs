import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRules } from '../../scripts/lib/rule-loader.mjs';

async function repoWithRule(filename, body) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rules-'));
  await mkdir(join(dir, '.autoreview/rules'), { recursive: true });
  await writeFile(join(dir, '.autoreview/rules', filename), body);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('local rule with explicit tier carries tier in effective frontmatter', async () => {
  const { dir, cleanup } = await repoWithRule('foo.md', `---
name: "Foo"
triggers: 'path:"**/*.ts"'
tier: heavy
severity: error
type: auto
---
body`);
  try {
    const { rules, warnings } = await loadRules(dir, { remote_rules: [] });
    assert.equal(warnings.length, 0);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].frontmatter.tier, 'heavy');
    assert.equal(rules[0].frontmatter.severity, 'error');
    assert.equal(rules[0].frontmatter.type, 'auto');
  } finally { await cleanup(); }
});

test('local rule without optional fields applies defaults', async () => {
  const { dir, cleanup } = await repoWithRule('bar.md', `---
name: "Bar"
triggers: 'path:"**/*.ts"'
---
body`);
  try {
    const { rules } = await loadRules(dir, { remote_rules: [] });
    assert.equal(rules[0].frontmatter.tier, 'default');
    assert.equal(rules[0].frontmatter.severity, 'error');
    assert.equal(rules[0].frontmatter.type, 'auto');
  } finally { await cleanup(); }
});

test('unknown tier value produces _invalid marker', async () => {
  const { dir, cleanup } = await repoWithRule('bad.md', `---
name: "Bad"
triggers: 'path:"**/*.ts"'
tier: bogus
---
body`);
  try {
    const { rules } = await loadRules(dir, { remote_rules: [] });
    assert.equal(rules.length, 1);
    assert.match(rules[0].frontmatter._invalid, /tier 'bogus' unknown/);
  } finally { await cleanup(); }
});

test('unknown severity value produces _invalid', async () => {
  const { dir, cleanup } = await repoWithRule('bad.md', `---
name: "Bad"
triggers: 'path:"**/*.ts"'
severity: paranoid
---
body`);
  try {
    const { rules } = await loadRules(dir, { remote_rules: [] });
    assert.match(rules[0].frontmatter._invalid, /severity 'paranoid' unknown/);
  } finally { await cleanup(); }
});

test('unknown type value produces _invalid', async () => {
  const { dir, cleanup } = await repoWithRule('bad.md', `---
name: "Bad"
triggers: 'path:"**/*.ts"'
type: cron
---
body`);
  try {
    const { rules } = await loadRules(dir, { remote_rules: [] });
    assert.match(rules[0].frontmatter._invalid, /type 'cron' unknown/);
  } finally { await cleanup(); }
});

test('multiple invalid fields in _invalid joined with semicolon', async () => {
  const { dir, cleanup } = await repoWithRule('multi-bad.md', `---
name: "Multi"
triggers: 'path:"**/*"'
tier: bogus
severity: paranoid
---
body`);
  try {
    const { rules } = await loadRules(dir, { remote_rules: [] });
    assert.equal(rules.length, 1);
    assert.match(rules[0].frontmatter._invalid, /tier 'bogus'.+;.*severity 'paranoid'/);
  } finally { await cleanup(); }
});
