import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request, withRetry } from '../../scripts/lib/http-client.mjs';

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
