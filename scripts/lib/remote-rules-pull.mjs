// scripts/lib/remote-rules-pull.mjs
// Git clone + sentinel-based wipe-and-replace. Zero deps beyond node stdlib.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, cp, stat, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileOrNull } from './fs-utils.mjs';

const SENTINEL = '.autoreview-managed';

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
      ['clone', '--depth', '1', '-c', 'core.hooksPath=/dev/null', '--branch', source.ref, source.url, tmp],
      process.cwd(),
      env,
    );
    const src = join(tmp, source.path ?? '.');
    await cp(src, target, { recursive: true });
    await writeFile(
      join(target, SENTINEL),
      `source: ${source.url}\nref: ${source.ref}\npulled: ${new Date().toISOString()}\n`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
