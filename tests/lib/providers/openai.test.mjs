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
