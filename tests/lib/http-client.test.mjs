import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request, withRetry, retryable } from '../../scripts/lib/http-client.mjs';

function spin(handler) {
  return new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ port, close: () => new Promise(r => server.close(r)) });
    });
  });
}

test('request returns status + body for 200', async () => {
  const { port, close } = await spin((req, res) => {
    res.writeHead(200, {'content-type':'application/json'});
    res.end('{"ok":true}');
  });
  try {
    const r = await request({ url: `http://127.0.0.1:${port}/x`, method: 'GET' });
    assert.equal(r.status, 200);
    assert.equal(r.body, '{"ok":true}');
  } finally { await close(); }
});

test('request posts body with content-length', async () => {
  const { port, close } = await spin((req, res) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { res.writeHead(200); res.end(Buffer.concat(chunks)); });
  });
  try {
    const r = await request({
      url: `http://127.0.0.1:${port}/`,
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: '{"a":1}',
    });
    assert.equal(r.body, '{"a":1}');
  } finally { await close(); }
});

test('timeout aborts request', async () => {
  const { port, close } = await spin((req, res) => { /* never respond */ });
  try {
    await assert.rejects(
      () => request({ url: `http://127.0.0.1:${port}/`, method: 'GET', timeoutMs: 100 }),
      /timeout/i
    );
  } finally { await close(); }
});

test('withRetry retries on thrown error, succeeds on third try', async () => {
  let n = 0;
  const fn = async () => { n++; if (n < 3) { const e = new Error('econn'); e.code = 'ECONNREFUSED'; throw e; } return 'ok'; };
  const r = await withRetry(fn, { attempts: 3, initialMs: 10, factor: 1, jitterMs: 0 });
  assert.equal(r, 'ok');
  assert.equal(n, 3);
});

test('withRetry gives up after attempts', async () => {
  const fn = async () => { const e = new Error('always'); e.code = 'ECONNREFUSED'; throw e; };
  await assert.rejects(() => withRetry(fn, { attempts: 2, initialMs: 5, factor: 1, jitterMs: 0 }), /always/);
});

test('withRetry does NOT retry non-retryable errors', async () => {
  let n = 0;
  const fn = async () => { n++; const e = new Error('validation'); throw e; };
  await assert.rejects(() => withRetry(fn, { attempts: 3, initialMs: 5, factor: 1, jitterMs: 0, shouldRetry: () => false }), /validation/);
  assert.equal(n, 1);
});

test('retryable: ETIMEDOUT / ECONNREFUSED / ENOTFOUND / ECONNRESET', () => {
  for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET']) {
    const e = new Error(code); e.code = code;
    assert.ok(retryable(e), `${code} should be retryable`);
  }
});

test('retryable: /timeout/ message substring', () => {
  assert.ok(retryable(new Error('request timeout after 100ms')));
});

test('retryable: status 5xx parsed from message', () => {
  assert.ok(retryable(new Error('openai status:502 service unavailable')));
});

test('retryable: err.status numeric 5xx', () => {
  assert.ok(retryable({ status: 503 }));
});

test('retryable: rejects 4xx', () => {
  assert.equal(retryable({ status: 404 }), false);
});

test('retryable: rejects plain Error with no code/message signal', () => {
  assert.equal(retryable(new Error('validation failed')), false);
});

test('retryable: falsy / null safe', () => {
  assert.equal(retryable(null), false);
  assert.equal(retryable(undefined), false);
});

test('request on non-200 status still resolves with status+body', async () => {
  const { port, close } = await spin((req, res) => {
    res.writeHead(418, {'content-type':'text/plain'});
    res.end('teapot');
  });
  try {
    const r = await request({ url: `http://127.0.0.1:${port}/`, method: 'GET' });
    assert.equal(r.status, 418);
    assert.equal(r.body, 'teapot');
  } finally { await close(); }
});

test('request with no body (GET, body=null) — no content-length header set', async () => {
  let sawCL;
  const { port, close } = await spin((req, res) => {
    sawCL = req.headers['content-length'];
    res.writeHead(200); res.end();
  });
  try {
    await request({ url: `http://127.0.0.1:${port}/`, method: 'GET' });
    assert.equal(sawCL, undefined);
  } finally { await close(); }
});
