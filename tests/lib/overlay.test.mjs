import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRules } from '../../scripts/lib/rule-loader.mjs';

async function setupRemote(opts) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-overlay-'));
  const remoteRoot = join(dir, '.autoreview/remote_rules', opts.name, opts.ref);
  await mkdir(remoteRoot, { recursive: true });
  await writeFile(join(remoteRoot, '.autoreview-managed'), 'sentinel');
  for (const [filename, body] of Object.entries(opts.files)) {
    const rulePath = opts.path ? join(remoteRoot, opts.path, filename) : join(remoteRoot, filename);
    await mkdir(dirname(rulePath), { recursive: true });
    await writeFile(rulePath, body);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('repo overlay overrides remote tier', async () => {
  const { dir, cleanup } = await setupRemote({
    name: 'corp', ref: 'v1', path: 'rules',
    files: {
      'a.md': `---
name: "A"
triggers: 'path:"**/*"'
tier: heavy
---
body`,
    },
  });
  try {
    const config = {
      remote_rules: [{
        name: 'corp', url: 'https://x', ref: 'v1', path: 'rules',
        overrides: { a: { tier: 'trivial' } },
      }],
    };
    const { rules } = await loadRules(dir, config);
    const rule = rules.find(r => r.id === 'corp/a');
    assert.equal(rule.frontmatter.tier, 'trivial');
  } finally { await cleanup(); }
});

test('overlay tier: null reverts to default', async () => {
  const { dir, cleanup } = await setupRemote({
    name: 'corp', ref: 'v1', path: 'rules',
    files: {
      'a.md': `---
name: "A"
triggers: 'path:"**/*"'
tier: heavy
---
body`,
    },
  });
  try {
    const config = {
      remote_rules: [{
        name: 'corp', url: 'https://x', ref: 'v1', path: 'rules',
        overrides: { a: { tier: null } },
      }],
    };
    const { rules } = await loadRules(dir, config);
    assert.equal(rules.find(r => r.id === 'corp/a').frontmatter.tier, 'default');
  } finally { await cleanup(); }
});

test('local rule with same id as overridden remote — local wins, warning logged', async () => {
  const { dir, cleanup } = await setupRemote({
    name: 'corp', ref: 'v1', path: 'rules',
    files: {
      'collide.md': `---
name: "Remote Collide"
triggers: 'path:"**/*"'
tier: heavy
---
remote body`,
    },
  });
  try {
    await mkdir(join(dir, '.autoreview/rules/corp'), { recursive: true });
    await writeFile(join(dir, '.autoreview/rules/corp/collide.md'), `---
name: "Local Collide"
triggers: 'path:"**/*"'
tier: trivial
---
local body`);
    const config = {
      remote_rules: [{
        name: 'corp', url: 'https://x', ref: 'v1', path: 'rules',
        overrides: { collide: { tier: 'critical' } },
      }],
    };
    const { rules, warnings } = await loadRules(dir, config);
    const rule = rules.find(r => r.id === 'corp/collide');
    assert.equal(rule.body.trim(), 'local body');
    assert.equal(rule.frontmatter.tier, 'trivial');
    assert.ok(warnings.some(w => /id collision for corp\/collide/.test(w)));
  } finally { await cleanup(); }
});
