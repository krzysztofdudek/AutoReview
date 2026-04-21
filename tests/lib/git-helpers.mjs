import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'ar-git-'));
  const run = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  run('init', '-q');
  run('config', 'user.email', 'test@test.test');
  run('config', 'user.name', 'test');
  run('commit', '--allow-empty', '-m', 'init', '-q');
  return { dir, run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
