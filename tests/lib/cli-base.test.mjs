import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, whichBinary } from '../../scripts/lib/cli-base.mjs';

const fixDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/fake-cli');

test('runCli captures stdout + exit 0', async () => {
  const r = await runCli({ binary: join(fixDir, 'ok.sh'), args: [], stdin: null });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /satisfied/);
});

test('runCli passes stdin and captures echo', async () => {
  const r = await runCli({ binary: join(fixDir, 'echo-stdin.sh'), args: [], stdin: 'hello world' });
  assert.equal(r.stdout, 'hello world');
});

test('runCli surfaces non-zero exit and stderr', async () => {
  const r = await runCli({ binary: join(fixDir, 'err.sh'), args: [], stdin: null });
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /boom/);
});

test('runCli timeout returns timedOut: true', async () => {
  const r = await runCli({ binary: join(fixDir, 'timeout.sh'), args: [], stdin: null, timeoutMs: 200 });
  assert.equal(r.timedOut, true);
});

test('whichBinary returns path for sh', async () => {
  const p = await whichBinary('sh');
  assert.ok(p && p.includes('sh'));
});

test('whichBinary returns null for missing binary', async () => {
  assert.equal(await whichBinary('definitely-does-not-exist-xyz'), null);
});
