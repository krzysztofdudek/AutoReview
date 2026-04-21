import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { create } from '../../../scripts/lib/providers/ollama.mjs';
import { retryable } from '../../../scripts/lib/http-client.mjs';

function spin(routes) {
  return new Promise(resolve => {
    const s = createServer((req, res) => {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const r = routes[req.url];
        if (!r) { res.writeHead(404); res.end(); return; }
        r(req, res, body);
      });
    });
    s.listen(0, () => resolve({ port: s.address().port, close: () => new Promise(r => s.close(r)) }));
  });
}

test('isAvailable true on 200 from /api/tags', async () => {
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(200); r.end('{"models":[]}'); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    assert.equal(await p.isAvailable(), true);
  } finally { await close(); }
});

test('verify posts to /api/generate and parses response', async () => {
  const { port, close } = await spin({
    '/api/generate': (q, r, body) => {
      const req = JSON.parse(body);
      assert.equal(req.model, 'qwen2.5-coder:7b');
      r.writeHead(200);
      r.end(JSON.stringify({ response: '{"satisfied":true,"reason":"ok"}' }));
    },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'qwen2.5-coder:7b' });
    const v = await p.verify('does it pass?', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(v.reason, 'ok');
  } finally { await close(); }
});

test('verify handles non-200 as providerError', async () => {
  const { port, close } = await spin({
    '/api/generate': (q, r) => { r.writeHead(500); r.end('boom'); },
  });
  try {
    const p = create({
      endpoint: `http://127.0.0.1:${port}`,
      model: 'x',
      _retryOptions: { attempts: 2, initialMs: 5, factor: 1, jitterMs: 0, shouldRetry: retryable },
    });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.providerError, true);
  } finally { await close(); }
});

test('contextWindowBytes reads model_info.general.context_length', async () => {
  const { port, close } = await spin({
    '/api/show': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ model_info: { general: { context_length: 32768 } } })); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    assert.equal(await p.contextWindowBytes(), 32768 * 4);
  } finally { await close(); }
});
