import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { create } from '../../../scripts/lib/providers/openai.mjs';

function spin(routes) {
  return new Promise(resolve => {
    const s = createServer((req, res) => {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const path = req.url.split('?')[0];
        const r = routes[path];
        if (!r) { res.writeHead(404); res.end(); return; }
        r(req, res, body);
      });
    });
    s.listen(0, () => resolve({ port: s.address().port, close: () => new Promise(r => s.close(r)) }));
  });
}

test('openai forwards reasoning_effort in body', async () => {
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res, body) => {
      const b = JSON.parse(body);
      assert.equal(b.reasoning_effort, 'high');
      assert.equal(b.model, 'gpt-4o');
      assert.equal(req.headers['authorization'], 'Bearer sk-test');
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true,"reason":"ok"}' } }] }));
    },
  });
  try {
    const p = create({ model: 'gpt-4o', apiKey: 'sk-test', url: `http://127.0.0.1:${port}/v1/chat/completions` });
    const v = await p.verify('p', { maxTokens: 100, reasoningEffort: 'high' });
    assert.equal(v.satisfied, true);
  } finally { await close(); }
});

test('openai retries on 503 then succeeds on 200', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res, body) => {
      calls++;
      if (calls === 1) { res.writeHead(503); res.end('unavailable'); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true}' } }] }));
    },
  });
  try {
    const p = create({ model: 'gpt-4o', apiKey: 'sk-test', url: `http://127.0.0.1:${port}/v1/chat/completions`, _retryOptions: { initialMs: 10 } });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(calls, 2);
  } finally { await close(); }
});

test('openai: 429 with Retry-After triggers retry; succeeds on second attempt', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res, body) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('rate limited'); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true}' } }] }));
    },
  });
  try {
    const p = create({ model: 'gpt-4o-mini', apiKey: 'sk', url: `http://127.0.0.1:${port}/v1/chat/completions` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(calls, 2);
  } finally { await close(); }
});

test('openai: 401 not retried; returns providerError', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res) => { calls++; res.writeHead(401); res.end('nope'); },
  });
  try {
    const p = create({ model: 'gpt-4o-mini', apiKey: 'bad', url: `http://127.0.0.1:${port}/v1/chat/completions` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.providerError, true);
    assert.equal(calls, 1);
  } finally { await close(); }
});

test('openai: timeoutMs override is honoured per verify call', async () => {
  // Server delays response > our 80ms timeout. Without plumbing, openai uses the 120s default
  // and the test would hang for 120s instead of failing fast.
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res) => {
      setTimeout(() => { res.writeHead(200); res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true}' } }] })); }, 300);
    },
  });
  try {
    const p = create({
      model: 'gpt-4o-mini', apiKey: 'sk',
      url: `http://127.0.0.1:${port}/v1/chat/completions`,
      timeoutMs: 80,
      _retryOptions: { attempts: 1 },
    });
    const t0 = Date.now();
    const v = await p.verify('p', { maxTokens: 100 });
    const dur = Date.now() - t0;
    assert.equal(v.providerError, true, `expected providerError, got ${JSON.stringify(v)}`);
    assert.match(v.raw, /timeout/i, `expected raw to mention timeout, got ${v.raw}`);
    assert.ok(dur < 2000, `verify should fail fast (<2s), took ${dur}ms`);
  } finally { await close(); }
});

test('openai: emits [warn] onRetry log on 429', async () => {
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let calls = 0;
  const { port, close } = await spin({
    '/v1/chat/completions': (req, res) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end(); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true}' } }] }));
    },
  });
  try {
    const p = create({ model: 'gpt-4o-mini', apiKey: 'sk', url: `http://127.0.0.1:${port}/v1/chat/completions` });
    await p.verify('p', { maxTokens: 100 });
    assert.ok(lines.some(l => /\[warn\] openai.*429/.test(l)));
  } finally {
    process.stderr.write = origWrite;
    await close();
  }
});
