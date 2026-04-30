import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execPath } from 'node:process';
import { runCli, whichBinary } from '../../scripts/lib/cli-base.mjs';

const fixDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/fake-cli');
// Use node + a .mjs fixture for portable spawn — `.sh` shebangs are not honored
// by spawn() on Windows (EFTYPE). Tests spawn `node <fixture.mjs>` cross-platform.
const fix = (name) => ({ binary: execPath, args: [join(fixDir, name)] });

test('runCli captures stdout + exit 0', async () => {
  const r = await runCli({ ...fix('ok.mjs'), stdin: null });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /satisfied/);
});

test('runCli passes stdin and captures echo', async () => {
  const r = await runCli({ ...fix('echo-stdin.mjs'), stdin: 'hello world' });
  assert.equal(r.stdout, 'hello world');
});

test('runCli surfaces non-zero exit and stderr', async () => {
  const r = await runCli({ ...fix('err.mjs'), stdin: null });
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /boom/);
});

test('runCli timeout returns timedOut: true', async () => {
  const r = await runCli({ ...fix('timeout.mjs'), stdin: null, timeoutMs: 200 });
  assert.equal(r.timedOut, true);
});

test('whichBinary returns path for sh', async () => {
  const p = await whichBinary('sh');
  assert.ok(p && p.includes('sh'));
});

test('whichBinary returns null for missing binary', async () => {
  assert.equal(await whichBinary('definitely-does-not-exist-xyz'), null);
});

test('whichBinary resists shell injection in name', async () => {
  // A name containing `; rm -rf /` must not execute rm. Since `name` is passed
  // as $1, shell never interprets it as a command.
  const p = await whichBinary('x; echo INJECTED');
  assert.equal(p, null);
});

test('runCli tolerates EPIPE when child closes stdin before parent write completes', async () => {
  // ok.mjs does not read stdin and exits instantly — on fast kernels (CI Ubuntu)
  // the child closes its stdin pipe before our write flushes, triggering EPIPE
  // as an uncaught exception. The runner must swallow that and return the
  // captured stdout/exit normally.
  const r = await runCli({ ...fix('ok.mjs'), stdin: 'payload that cannot land' });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /satisfied/);
});
