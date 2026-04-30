import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { create } from '../../../scripts/lib/providers/google.mjs';

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

test('google sends thinkingConfig.thinkingBudget 2048 for medium reasoningEffort', async () => {
  const { port, close } = await spin({
    '/v1beta/models/gemini-pro:generateContent': (req, res, body) => {
      const b = JSON.parse(body);
      assert.equal(b.generationConfig.thinkingConfig.thinkingBudget, 2048);
      assert.equal(b.contents[0].parts[0].text, 'test prompt');
      res.writeHead(200);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"satisfied":true,"reason":"ok"}' }] } }] }));
    },
  });
  try {
    const p = create({ model: 'gemini-pro', apiKey: 'gk-test', baseUrl: `http://127.0.0.1:${port}/v1beta` });
    const v = await p.verify('test prompt', { maxTokens: 100, reasoningEffort: 'medium' });
    assert.equal(v.satisfied, true);
  } finally { await close(); }
});

test('google isAvailable false without key', async () => {
  assert.equal(await create({ model: 'x', apiKey: '' }).isAvailable(), false);
});

test('google no thinkingConfig when reasoningEffort not set', async () => {
  const { port, close } = await spin({
    '/v1beta/models/gemini-pro:generateContent': (req, res, body) => {
      const b = JSON.parse(body);
      assert.equal(b.generationConfig.thinkingConfig, undefined);
      res.writeHead(200);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"satisfied":false}' }] } }] }));
    },
  });
  try {
    const p = create({ model: 'gemini-pro', apiKey: 'gk-test', baseUrl: `http://127.0.0.1:${port}/v1beta` });
    const v = await p.verify('test prompt', { maxTokens: 100 });
    assert.equal(v.satisfied, false);
  } finally { await close(); }
});

test('google: 429 with Retry-After triggers retry; succeeds on second attempt', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1beta/models/m:generateContent': (req, res) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('rate limited'); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"satisfied":true}' }] } }] }));
    },
  });
  try {
    const p = create({ model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1beta` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.satisfied, true);
    assert.equal(calls, 2);
  } finally { await close(); }
});

test('google: 401 not retried; returns providerError', async () => {
  let calls = 0;
  const { port, close } = await spin({
    '/v1beta/models/m:generateContent': (req, res) => { calls++; res.writeHead(401); res.end(); },
  });
  try {
    const p = create({ model: 'm', apiKey: 'bad', baseUrl: `http://127.0.0.1:${port}/v1beta` });
    const v = await p.verify('p', { maxTokens: 100 });
    assert.equal(v.providerError, true);
    assert.equal(calls, 1);
  } finally { await close(); }
});

test('google: emits [warn] onRetry log on 429', async () => {
  const origWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let calls = 0;
  const { port, close } = await spin({
    '/v1beta/models/m:generateContent': (req, res) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end(); return; }
      res.writeHead(200);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"satisfied":true}' }] } }] }));
    },
  });
  try {
    const p = create({ model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/v1beta` });
    await p.verify('p', { maxTokens: 100 });
    assert.ok(lines.some(l => /\[warn\] google.*429/.test(l)));
  } finally {
    process.stderr.write = origWrite;
    await close();
  }
});
