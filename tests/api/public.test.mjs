import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../scripts/index.mjs';

test('public API exports required symbols', () => {
  const expectedFunctions = [
    'loadConfig', 'loadRules', 'reviewFile',
    'resolveScope', 'getProvider', 'parseTrigger', 'evaluateTrigger',
    'matchPath', 'buildPrompt', 'parseResponse', 'appendVerdict',
    'createIntentGate', 'pullSource',
    'runValidate', 'runInit', 'runCreateRule', 'runCheckBreadth',
    'runContext', 'runGuide', 'runPullRemote',
  ];
  for (const name of expectedFunctions) {
    assert.equal(typeof api[name], 'function', `missing export: ${name}`);
  }
  // DEFAULT_CONFIG is an object constant, not a function
  assert.equal(typeof api.DEFAULT_CONFIG, 'object', 'missing export: DEFAULT_CONFIG');
  assert.ok(api.DEFAULT_CONFIG !== null, 'DEFAULT_CONFIG should not be null');
});
