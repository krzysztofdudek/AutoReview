import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntentGate } from '../../scripts/lib/intent-gate.mjs';

function stubProvider(responses) {
  let i = 0;
  return { name: 'stub', model: 'x', async verify() { return responses[i++ % responses.length]; } };
}

const rule = { id: 'r1', frontmatter: { intent: 'command handler' } };
const ruleOverride = { id: 'r2', frontmatter: { intent: 'handler', provider: 'anthropic' } };

test('check returns match when provider answers yes', async () => {
  const prov = stubProvider([{ satisfied: false, reason: 'yes' }]);
  const gate = createIntentGate({ resolveProvider: () => prov, budget: 10 });
  const r = await gate.check(rule, 'a.ts', 'content');
  assert.equal(r, 'match');
});

test('check returns skip-no when provider answers no', async () => {
  const prov = stubProvider([{ satisfied: false, reason: 'no' }]);
  const gate = createIntentGate({ resolveProvider: () => prov, budget: 10 });
  const r = await gate.check(rule, 'a.ts', 'content');
  assert.equal(r, 'skip-no');
});

test('cached within run — second call does not re-invoke provider', async () => {
  let calls = 0;
  const prov = { name: 'stub', model: 'x', async verify() { calls++; return { satisfied: false, reason: 'yes' }; } };
  const gate = createIntentGate({ resolveProvider: () => prov, budget: 10 });
  await gate.check(rule, 'a.ts', 'content');
  await gate.check(rule, 'a.ts', 'content');
  assert.equal(calls, 1);
});

test('budget exhausted returns skip-budget', async () => {
  const prov = stubProvider([{ satisfied: false, reason: 'yes' }]);
  const gate = createIntentGate({ resolveProvider: () => prov, budget: 1 });
  await gate.check(rule, 'a.ts', 'c1');
  const r = await gate.check(rule, 'b.ts', 'c2');
  assert.equal(r, 'skip-budget');
  assert.equal(gate.stats().skipped, 1);
});

test('resolveProvider invoked per rule', async () => {
  const ruleProviders = new Map();
  const gate = createIntentGate({
    resolveProvider: (r) => {
      if (!ruleProviders.has(r.id)) {
        ruleProviders.set(r.id, { name: `stub-${r.id}`, model: 'x', async verify() { return { satisfied: false, reason: 'yes' }; } });
      }
      return ruleProviders.get(r.id);
    },
    budget: 10,
  });
  await gate.check(rule, 'a.ts', 'c1');
  await gate.check(ruleOverride, 'a.ts', 'c1');
  assert.equal(ruleProviders.size, 2);
});
