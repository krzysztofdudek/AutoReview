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
