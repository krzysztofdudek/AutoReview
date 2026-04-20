import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules } from '../../scripts/lib/rule-loader.mjs';
import { DEFAULT_CONFIG } from '../../scripts/lib/config-loader.mjs';

async function fixture(ruleFiles) {
  const dir = await mkdtemp(join(tmpdir(), 'ar-rl-'));
  for (const [path, body] of Object.entries(ruleFiles)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const RULE = (name, triggers, body = 'rule body') => `---
name: "${name}"
triggers: '${triggers}'
---
${body}`;

test('loads local rules with id from path', async () => {
  const { dir, cleanup } = await fixture({
    '.autoreview/rules/api/auth.md': RULE('Auth', 'path:"src/auth/**"'),
    '.autoreview/rules/style.md': RULE('Style', 'path:"**/*.ts"'),
  });
  try {
    const { rules, warnings } = await loadRules(dir, DEFAULT_CONFIG);
    assert.equal(rules.length, 2);
    const ids = rules.map(r => r.id).sort();
    assert.deepEqual(ids, ['api/auth', 'style']);
    assert.equal(warnings.length, 0);
  } finally { await cleanup(); }
});

test('local wins over remote on id collision', async () => {
  const { dir, cleanup } = await fixture({
    '.autoreview/rules/x.md': RULE('Local X', 'path:"**"'),
    '.autoreview/remote_rules/shared/v1/x.md': RULE('Remote X', 'path:"**"'),
  });
  try {
    const cfg = { ...DEFAULT_CONFIG, remote_rules: [{ name: 'shared', url: '', ref: 'v1', path: '.' }] };
    const { rules, warnings } = await loadRules(dir, cfg);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].frontmatter.name, 'Local X');
    assert.ok(warnings.some(w => w.includes('collision')));
  } finally { await cleanup(); }
});

test('config.rules.disabled removes rules', async () => {
  const { dir, cleanup } = await fixture({
    '.autoreview/rules/keep.md': RULE('Keep', 'path:"**"'),
    '.autoreview/rules/drop.md': RULE('Drop', 'path:"**"'),
  });
  try {
    const cfg = { ...DEFAULT_CONFIG, rules: { enabled_extra: [], disabled: ['drop'] } };
    const { rules } = await loadRules(dir, cfg);
    assert.deepEqual(rules.map(r => r.id).sort(), ['keep']);
  } finally { await cleanup(); }
});

test('default:disabled dropped unless enabled_extra lists it', async () => {
  const RULE_OPT = (n, t) => `---\nname: "${n}"\ntriggers: '${t}'\ndefault: disabled\n---\nbody`;
  const { dir, cleanup } = await fixture({
    '.autoreview/rules/opt.md': RULE_OPT('Opt', 'path:"**"'),
  });
  try {
    const cfgOff = { ...DEFAULT_CONFIG, rules: { enabled_extra: [], disabled: [] } };
    assert.equal((await loadRules(dir, cfgOff)).rules.length, 0);
    const cfgOn = { ...DEFAULT_CONFIG, rules: { enabled_extra: ['opt'], disabled: [] } };
    assert.equal((await loadRules(dir, cfgOn)).rules.length, 1);
  } finally { await cleanup(); }
});

test('malformed frontmatter emits warning, continues others', async () => {
  const { dir, cleanup } = await fixture({
    '.autoreview/rules/bad.md': `---\nname:\ntriggers:\n---\nbody`,
    '.autoreview/rules/good.md': RULE('Good', 'path:"**"'),
  });
  try {
    const { rules, warnings } = await loadRules(dir, DEFAULT_CONFIG);
    assert.equal(rules.length, 1);
    assert.ok(warnings.length >= 1);
  } finally { await cleanup(); }
});
