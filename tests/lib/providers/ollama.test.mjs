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
    assert.equal(v.reason, undefined);
  } finally { await close(); }
});

test('verify extracts token usage from prompt_eval_count + eval_count', async () => {
  const { port, close } = await spin({
    '/api/generate': (q, r) => {
      r.writeHead(200);
      r.end(JSON.stringify({
        response: '{"satisfied":true}',
        prompt_eval_count: 150,
        eval_count: 40,
      }));
    },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.usage.input_tokens, 150);
    assert.equal(v.usage.output_tokens, 40);
    assert.equal(v.usage.total_tokens, 190);
  } finally { await close(); }
});

test('verify omits usage when counts missing from response', async () => {
  const { port, close } = await spin({
    '/api/generate': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ response: '{"satisfied":true}' })); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.usage, undefined);
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

test('contextWindowBytes falls back to 32768 when model_info missing', async () => {
  const { port, close } = await spin({
    '/api/show': (q, r) => { r.writeHead(200); r.end('{}'); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    assert.equal(await p.contextWindowBytes(), 32768);
  } finally { await close(); }
});

test('contextWindowBytes falls back when /api/show returns 500', async () => {
  const { port, close } = await spin({
    '/api/show': (q, r) => { r.writeHead(500); r.end('err'); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    assert.equal(await p.contextWindowBytes(), 32768);
  } finally { await close(); }
});

test('contextWindowBytes falls back on network error', async () => {
  const p = create({ endpoint: 'http://127.0.0.1:1', model: 'x' });
  assert.equal(await p.contextWindowBytes(), 32768);
});

test('isAvailable false when endpoint unreachable', async () => {
  const p = create({ endpoint: 'http://127.0.0.1:1', model: 'x' });
  assert.equal(await p.isAvailable(), false);
});

test('isAvailable false on non-200 status', async () => {
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(500); r.end(); },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    assert.equal(await p.isAvailable(), false);
  } finally { await close(); }
});

test('verify catches network error, returns providerError with stringified err', async () => {
  const p = create({
    endpoint: 'http://127.0.0.1:1', model: 'x',
    _retryOptions: { attempts: 1, initialMs: 5, factor: 1, jitterMs: 0, shouldRetry: () => false },
  });
  const v = await p.verify('p', { maxTokens: 10 });
  assert.equal(v.providerError, true);
  assert.match(String(v.raw), /ECONNREFUSED|EADDRNOTAVAIL|Error/);
});

test('ollamaHasModel: true when model name matches', async () => {
  const { ollamaHasModel } = await import('../../../scripts/lib/providers/ollama.mjs');
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ models: [{ name: 'gemma4:e4b' }, { name: 'other' }] })); },
  });
  try {
    assert.equal(await ollamaHasModel(`http://127.0.0.1:${port}`, 'gemma4:e4b'), true);
  } finally { await close(); }
});

test('ollamaHasModel: true when installed variant has tag-suffixed name', async () => {
  const { ollamaHasModel } = await import('../../../scripts/lib/providers/ollama.mjs');
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ models: [{ name: 'llama3:8b' }] })); },
  });
  try {
    assert.equal(await ollamaHasModel(`http://127.0.0.1:${port}`, 'llama3'), true);
  } finally { await close(); }
});

test('ollamaHasModel: false when not present', async () => {
  const { ollamaHasModel } = await import('../../../scripts/lib/providers/ollama.mjs');
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(200); r.end(JSON.stringify({ models: [{ name: 'other' }] })); },
  });
  try {
    assert.equal(await ollamaHasModel(`http://127.0.0.1:${port}`, 'gemma4'), false);
  } finally { await close(); }
});

test('ollamaHasModel: false when endpoint unreachable', async () => {
  const { ollamaHasModel } = await import('../../../scripts/lib/providers/ollama.mjs');
  assert.equal(await ollamaHasModel('http://127.0.0.1:1', 'x'), false);
});

test('ollamaHasModel: false on non-200', async () => {
  const { ollamaHasModel } = await import('../../../scripts/lib/providers/ollama.mjs');
  const { port, close } = await spin({
    '/api/tags': (q, r) => { r.writeHead(500); r.end(); },
  });
  try {
    assert.equal(await ollamaHasModel(`http://127.0.0.1:${port}`, 'x'), false);
  } finally { await close(); }
});

test('ollama: 429 with Retry-After triggers retry; succeeds on second attempt', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/api/generate': (q, r) => {
      calls++;
      if (calls === 1) { r.writeHead(429, { 'retry-after': '0' }); r.end('rate limited'); return; }
      r.writeHead(200);
      r.end(JSON.stringify({ response: '{"satisfied":true,"reason":"ok"}' }));
    },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(calls, 2);
  } finally { await close(); }
});

test('ollama: emits [warn] onRetry log on 429', async () => {
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let calls = 0;
  const { port, close } = await spin({
    '/api/generate': (q, r) => {
      calls++;
      if (calls === 1) { r.writeHead(429, { 'retry-after': '0' }); r.end(); return; }
      r.writeHead(200); r.end(JSON.stringify({ response: '{"satisfied":true}' }));
    },
  });
  try {
    const p = create({ endpoint: `http://127.0.0.1:${port}`, model: 'x' });
    await p.verify('p', { maxTokens: 100 });
    assert.ok(lines.some(l => /\[warn\] ollama: 429/.test(l)),
      `expected [warn] ollama: 429 line, got: ${lines.join(' | ')}`);
  } finally {
    process.stderr.write = origWrite;
    await close();
  }
});

test('ollama: 401 not retried; returns providerError', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/api/generate': (q, r) => { calls++; r.writeHead(401); r.end('nope'); },
  });
  try {
    const p = create({
      endpoint: `http://127.0.0.1:${port}`, model: 'x',
      _retryOptions: { attempts: 4, initialMs: 1, factor: 1, jitterMs: 0, shouldRetry: retryable },
    });
    const v = await p.verify('p', { maxTokens: 10 });
    assert.equal(v.providerError, true);
    assert.equal(calls, 1, 'must not retry on 401');
  } finally { await close(); }
});
