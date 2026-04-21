import { test } from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../../scripts/lib/providers/gemini-cli.mjs';

test('gemini-cli surfaces E2BIG via runCli injection seam', async () => {
  const fakeRun = async () => ({ spawnError: 'E2BIG', stdout: '', stderr: '', exitCode: -1, timedOut: false });
  const p = create({ model: 'gemini-2.5-flash', _binary: 'gemini', _runCli: fakeRun });
  const v = await p.verify('x'.repeat(100000), { maxTokens: 100 });
  assert.equal(v.providerError, true);
  assert.match(v.raw, /too large/);
});

test('gemini-cli passes parsed verdict', async () => {
  const fakeRun = async () => ({ stdout: '{"satisfied":true,"reason":"ok"}', stderr: '', exitCode: 0, timedOut: false });
  const p = create({ model: 'gemini-2.5-flash', _binary: 'gemini', _runCli: fakeRun });
  const v = await p.verify('p', { maxTokens: 100 });
  assert.equal(v.satisfied, true);
});
