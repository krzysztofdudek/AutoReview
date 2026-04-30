import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../../scripts/lib/concurrency.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('Semaphore(1) strictly serialises run() calls', async () => {
  const sem = new Semaphore(1);
  const trace = [];
  await Promise.all([1, 2, 3, 4, 5].map(i => sem.run(async () => {
    trace.push(`start-${i}`);
    await sleep(10);
    trace.push(`end-${i}`);
  })));
  for (let i = 0; i < trace.length; i += 2) {
    assert.match(trace[i], /^start-/);
    assert.match(trace[i + 1], /^end-/);
    assert.equal(trace[i].slice(6), trace[i + 1].slice(4));
  }
});

test('Semaphore(5) allows up to 5 in-flight at once', async () => {
  const sem = new Semaphore(5);
  let inFlight = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 10 }, () => sem.run(async () => {
    inFlight++;
    if (inFlight > peak) peak = inFlight;
    await sleep(20);
    inFlight--;
  })));
  assert.equal(peak, 5);
});

test('available never exceeds max — invariant under concurrent run()', async () => {
  const sem = new Semaphore(3);
  let violations = 0;
  const checker = setInterval(() => { if (sem.available > sem.max) violations++; }, 1);
  await Promise.all(Array.from({ length: 20 }, () => sem.run(() => sleep(5))));
  clearInterval(checker);
  assert.equal(violations, 0);
  assert.equal(sem.available, sem.max);
});

test('queued tasks run in FIFO order of acquire()', async () => {
  const sem = new Semaphore(1);
  const order = [];
  const tasks = [1, 2, 3].map(i => sem.run(async () => { order.push(i); await sleep(5); }));
  await Promise.all(tasks);
  assert.deepEqual(order, [1, 2, 3]);
});

test('thrown function still releases slot', async () => {
  const sem = new Semaphore(1);
  await assert.rejects(() => sem.run(() => { throw new Error('boom'); }), /boom/);
  assert.equal(sem.available, 1);
  await sem.run(() => sleep(1));
});

test('rejected promise still releases slot', async () => {
  const sem = new Semaphore(1);
  await assert.rejects(() => sem.run(async () => { throw new Error('async-boom'); }), /async-boom/);
  assert.equal(sem.available, 1);
});

test('queued tasks are not killed by an external timeout while waiting for slot', async () => {
  // Regression: voteConsensus used to wrap `provider.verify()` in Promise.race with a
  // timeout that started ticking the moment the promise was created — *before* sem.acquire().
  // Under fan-out (Promise.all over many pairs, parallel:1), all calls entered the timeout
  // race simultaneously; calls queued past the timeout died in the queue. Effect: many
  // verdicts errored at exactly the timeout duration with the provider sitting at 0% load.
  // Mitigation: removed consensus.withTimeout. This test ensures sem.run does not itself
  // re-introduce a queue-side timeout.
  const sem = new Semaphore(1);
  const tasks = Array.from({ length: 50 }, (_, i) => sem.run(async () => {
    await sleep(20);
    return i;
  }));
  const results = await Promise.all(tasks);
  assert.deepEqual(results.length, 50);
  assert.ok(results.every((v, i) => v === i));
});

test('constructor rejects non-positive integer', () => {
  assert.throws(() => new Semaphore(0), /positive integer/i);
  assert.throws(() => new Semaphore(-1), /positive integer/i);
  assert.throws(() => new Semaphore(1.5), /positive integer/i);
  assert.throws(() => new Semaphore('5'), /positive integer/i);
  assert.throws(() => new Semaphore(null), /positive integer/i);
});
