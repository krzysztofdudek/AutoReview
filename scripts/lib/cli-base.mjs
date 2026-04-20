// scripts/lib/cli-base.mjs
// Subprocess runner. Zero deps.

import { spawn } from 'node:child_process';

export function runCli({ binary, args = [], stdin = null, timeoutMs = 120_000, env = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    let stdout = '', stderr = '';
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    }, timeoutMs);
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', err => {
      clearTimeout(killer);
      resolve({ stdout, stderr: stderr + String(err), exitCode: -1, timedOut, spawnError: err.code });
    });
    child.on('close', code => {
      clearTimeout(killer);
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
    });
    if (stdin !== null) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export async function whichBinary(name, { timeoutMs = 5000 } = {}) {
  const r = await runCli({ binary: 'sh', args: ['-c', `command -v ${name}`], stdin: null, timeoutMs });
  const out = r.stdout.trim();
  return r.exitCode === 0 && out ? out : null;
}
