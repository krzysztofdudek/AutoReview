import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { create } from '../../../scripts/lib/providers/anthropic.mjs';

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

test('anthropic sends x-api-key and parses content[0].text', async () => {
  const { port, close } = await spin({
    '/v1/messages': (req, res, body) => {
      assert.equal(req.headers['x-api-key'], 'sk-test');
      assert.equal(req.headers['anthropic-version'], '2023-06-01');
      const b = JSON.parse(body);
      assert.equal(b.model, 'claude-haiku-4-5');
      res.writeHead(200);
      res.end(JSON.stringify({ content: [{ text: '{"satisfied":true,"reason":"ok"}' }] }));
    },
  });
  try {
    const p = create({ model: 'claude-haiku-4-5', apiKey: 'sk-test', url: `http://127.0.0.1:${port}/v1/messages` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
  } finally { await close(); }
});

test('anthropic thinking mode when reasoningEffort set', async () => {
  const { port, close } = await spin({
    '/v1/messages': (req, res, body) => {
      const b = JSON.parse(body);
      assert.equal(b.thinking.budget_tokens, 4096);
      res.writeHead(200);
      res.end(JSON.stringify({ content: [{ text: '{"satisfied":true}' }] }));
    },
  });
  try {
    const p = create({ model: 'x', apiKey: 'sk', url: `http://127.0.0.1:${port}/v1/messages` });
    await p.verify('p', { maxTokens: 100, reasoningEffort: 'medium' });
  } finally { await close(); }
});

test('anthropic isAvailable false without key', async () => {
  assert.equal(await create({ model: 'x', apiKey: '' }).isAvailable(), false);
});

test('anthropic: 429 with Retry-After triggers retry; succeeds on second attempt', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1/messages': (req, res, body) => {
      calls++;
      if (calls === 1) {
        res.writeHead(429, { 'retry-after': '0' });
        res.end('rate limited');
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ content: [{ text: '{"satisfied":true,"reason":"ok"}' }] }));
    },
  });
  try {
    const p = create({ model: 'claude-haiku-4-5', apiKey: 'sk-test', url: `http://127.0.0.1:${port}/v1/messages` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(calls, 2);
  } finally { await close(); }
});

test('anthropic: 4xx non-retryable returns providerError without retry', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1/messages': (req, res) => {
      calls++;
      res.writeHead(401);
      res.end('unauthorized');
    },
  });
  try {
    const p = create({ model: 'claude-haiku-4-5', apiKey: 'bad', url: `http://127.0.0.1:${port}/v1/messages` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.providerError, true);
    assert.equal(calls, 1);
  } finally { await close(); }
});

test('anthropic: 429 emits [warn] retry log via onRetry → process.stderr', async () => {
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let calls = 0;
  const { port, close } = await spin({
    '/v1/messages': (req, res) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end(); return; }
      res.writeHead(200); res.end(JSON.stringify({ content: [{ text: '{"satisfied":true}' }] }));
    },
  });
  try {
    const p = create({ model: 'claude-haiku-4-5', apiKey: 'sk-test', url: `http://127.0.0.1:${port}/v1/messages` });
    await p.verify('p', { maxTokens: 100 });
    assert.ok(lines.some(l => /\[warn\] anthropic.*429/.test(l)),
      `expected a [warn] anthropic 429 line, got: ${lines.join(' | ')}`);
  } finally {
    process.stderr.write = origWrite;
    await close();
  }
});
