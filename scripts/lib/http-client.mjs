// scripts/lib/http-client.mjs
// HTTP client with timeout + retry. Zero deps beyond node:http/https.

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export async function request({ url, method = 'GET', headers = {}, body = null, timeoutMs = 120_000 }) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    headers: { ...headers },
  };
  if (body != null) opts.headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = mod.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`request timeout after ${timeoutMs}ms`)); });
    if (body != null) req.write(body);
    req.end();
  });
}

export function retryable(err) {
  if (!err) return false;
  const code = err.code ?? '';
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'].includes(code)) return true;
  const msg = String(err.message ?? err);
  if (/timeout/i.test(msg)) return true;
  if (/status:5\d\d/.test(msg)) return true;
  if (/status:(429|408)/.test(msg)) return true;
  if (err.status >= 500 && err.status < 600) return true;
  if (err.status === 429 || err.status === 408) return true;
  return false;
}

export function parseRetryAfter(value) {
  if (value == null) return null;
  const sec = Number(value);
  if (Number.isFinite(sec) && sec >= 0) return Math.floor(sec * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : 0;
  }
  return null;
}

export async function withRetry(fn, {
  attempts = 4,
  initialMs = 500,
  factor = 2,
  jitterMs = 200,
  capMs = 30_000,
  shouldRetry = retryable,
  onRetry = null,
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !shouldRetry(err)) throw err;
      const explicit = typeof err.retryAfterMs === 'number' && err.retryAfterMs >= 0
        ? Math.min(capMs, err.retryAfterMs)
        : null;
      const exp = Math.min(capMs, initialMs * Math.pow(factor, i)) + Math.floor(Math.random() * jitterMs);
      const delay = explicit ?? exp;
      if (onRetry) onRetry({ attempt: i + 1, attempts, delay, err });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
