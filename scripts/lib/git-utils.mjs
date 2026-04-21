// scripts/lib/git-utils.mjs
// Git subprocess wrapper. Zero deps. All spawns use arg arrays — no shell interpolation.

import { spawn } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileOrNull, writeAtomic } from './fs-utils.mjs';

function execGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`git ${args.join(' ')}: ${err.trim()}`)));
  });
}

export async function repoRoot(cwd) {
  return (await execGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function stagedPaths(cwd) {
  const out = await execGit(cwd, ['status', '--porcelain=v1', '-z']);
  const entries = out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const index = e[0];
    const path = e.slice(3);
    if ('AMRC'.includes(index)) paths.push(path);
    if (index === 'R' || index === 'C') i++;
  }
  return paths;
}

export async function diffStaged(cwd, path) {
  return execGit(cwd, ['diff', '--cached', '--', path]);
}

export async function worktreeModifiedPaths(cwd) {
  const out = await execGit(cwd, ['status', '--porcelain=v1', '-z']);
  const entries = out.split('\0').filter(Boolean);
  const set = new Set();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const index = e[0], work = e[1];
    const path = e.slice(3);
    if (index !== ' ' && 'AMRCDU'.includes(index)) set.add(path);
    if (work !== ' ' && 'MDRC'.includes(work)) set.add(path);
    if (index === 'R' || index === 'C') i++;
  }
  return Array.from(set);
}

export async function diffUncommitted(cwd, path) {
  return execGit(cwd, ['diff', 'HEAD', '--', path]);
}

export async function commitFiles(cwd, sha) {
  const out = await execGit(cwd, ['show', '--name-only', '--pretty=', sha]);
  return out.split('\n').filter(Boolean);
}

export async function fileAtCommit(cwd, sha, path) {
  return execGit(cwd, ['show', `${sha}:${path}`]);
}

export async function commitDiff(cwd, sha, path) {
  try {
    return await execGit(cwd, ['diff', `${sha}^`, sha, '--', path]);
  } catch {
    return execGit(cwd, ['show', sha, '--', path]);
  }
}

export async function resolveSha(cwd, ref) {
  return (await execGit(cwd, ['rev-parse', ref])).trim();
}

export async function installPrecommit(cwd, scriptBody) {
  const hookPath = join(cwd, '.git/hooks/pre-commit');
  const existing = await readFileOrNull(hookPath);
  if (existing === scriptBody) return 'exists-identical';
  if (existing !== null) return 'exists-different';
  await writeAtomic(hookPath, scriptBody);
  await chmod(hookPath, 0o755);
  return 'installed';
}

export async function gitignoreEnsure(cwd, lines) {
  const path = join(cwd, '.gitignore');
  const existing = (await readFileOrNull(path)) ?? '';
  const present = new Set(existing.split(/\r?\n/));
  const toAppend = lines.filter(l => !present.has(l));
  if (toAppend.length === 0) return;
  const body = existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + toAppend.join('\n') + '\n';
  await writeAtomic(path, body);
}
