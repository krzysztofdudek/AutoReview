import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { create } from '../../../scripts/lib/providers/openai-compat.mjs';

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

test('openai-compat throws when endpoint missing', () => {
  assert.throws(() => create({ model: 'x' }), /openai-compat requires endpoint/);
});

test('openai-compat forwards request to <endpoint>/chat/completions with reasoning_effort', async () => {
  const { port, close } = await spin({
    '/chat/completions': (req, res, body) => {
      const b = JSON.parse(body);
      assert.equal(b.model, 'llama3');
      assert.equal(b.reasoning_effort, 'low');
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: '{"satisfied":true,"reason":"looks good"}' } }] }));
    },
  });
  try {
    const p = create({ model: 'llama3', apiKey: 'local-key', endpoint: `http://127.0.0.1:${port}` });
    assert.equal(p.name, 'openai-compat');
    const v = await p.verify('check this', { maxTokens: 200, reasoningEffort: 'low' });
    assert.equal(v.satisfied, true);
    assert.equal(v.reason, undefined);
  } finally { await close(); }
});
