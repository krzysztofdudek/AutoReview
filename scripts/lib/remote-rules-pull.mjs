// scripts/lib/remote-rules-pull.mjs
// Git clone + sentinel-based wipe-and-replace. Zero deps beyond node stdlib.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, cp, stat, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileOrNull } from './fs-utils.mjs';

const SENTINEL = '.autoreview-managed';

const URL_RE = /^(?:https?:\/\/|git@[A-Za-z0-9._-]+:|ssh:\/\/|git:\/\/|file:\/\/|\/)[A-Za-z0-9@._\-:/_]+(?:\.git)?$/;

function validateRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('remote url must be a non-empty string');
  }
  if (url.startsWith('-')) {
    throw new Error(`remote url cannot start with '-': ${url}`);
  }
  if (!URL_RE.test(url)) {
    throw new Error(`remote url must use https/http/git/ssh scheme: ${url}`);
  }
}

function validateIdent(name, kind) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`remote ${kind} must be a non-empty string`);
  }
  if (name.includes('..') || name.startsWith('/') || name.startsWith('-')) {
    throw new Error(`remote ${kind} cannot contain '..', start with '/', or start with '-': ${name}`);
  }
  if (kind === 'name' && !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`remote name must match [A-Za-z0-9._-]+: ${name}`);
  }
  if (kind === 'ref' && !/^[A-Za-z0-9._\-\/]+$/.test(name)) {
    throw new Error(`remote ref must match [A-Za-z0-9._-\\/]+: ${name}`);
  }
  if (kind === 'path' && !/^[A-Za-z0-9._\-\/]*$/.test(name)) {
    throw new Error(`remote path must match [A-Za-z0-9._-\\/]*: ${name}`);
  }
}

function gitHard(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, {
      cwd,
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')}: ${err.trim()}`)));
  });
}

async function isAllMarkdown(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!(await isAllMarkdown(p))) return false;
    } else if (e.isFile() && !e.name.endsWith('.md') && e.name !== SENTINEL) {
      return false;
    }
  }
  return true;
}

export async function pullSource({ repoRoot, source, env = process.env }) {
  validateRemoteUrl(source.url);
  validateIdent(source.name, 'name');
  validateIdent(source.ref, 'ref');
  if (source.path !== undefined && source.path !== null) validateIdent(source.path, 'path');
  const target = join(repoRoot, '.autoreview/remote_rules', source.name, source.ref);
  let exists = false;
  try { exists = (await stat(target)).isDirectory(); } catch {}
  if (exists) {
    const sentinel = await readFileOrNull(join(target, SENTINEL));
    if (!sentinel) {
      const mdOnly = await isAllMarkdown(target);
      if (!mdOnly) throw new Error(`${target} has non-md files; refuse wipe`);
    }
    await rm(target, { recursive: true, force: true });
  }
  const tmp = await mkdtemp(join(tmpdir(), 'ar-pull-'));
  try {
    await gitHard(
      ['clone', '--depth', '1', '-c', 'core.hooksPath=/dev/null', '--branch', source.ref, '--', source.url, tmp],
      process.cwd(),
      env,
    );
    // Preserve layout: if `path` names a subdirectory of the upstream repo, copy it
    // into the same relative location under `target`. This way rule-loader's base
    // (`<target>/<path>/`) and the pulled tree agree. Without this, we'd strip the
    // prefix and rule-loader would look in an empty dir.
    const hasSubPath = source.path && source.path !== '.';
    const src = hasSubPath ? join(tmp, source.path) : tmp;
    const dst = hasSubPath ? join(target, source.path) : target;
    await cp(src, dst, { recursive: true });
    await writeFile(
      join(target, SENTINEL),
      `source: ${source.url}\nref: ${source.ref}\npulled: ${new Date().toISOString()}\n`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
