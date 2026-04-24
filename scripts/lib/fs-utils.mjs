/**
 * AutoReview fs-utils. Zero deps.
 *
 * .gitignore support: MVP, per-directory at root only. Patterns: blank/# skipped;
 * `!` negation NOT supported; `/` anchors to root; trailing `/` = directory-only;
 * `*`, `**`, `?` glob tokens.
 */
import { readFile, writeFile, rename, stat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function readFileOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

export async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch (err) {
    if (err.code === 'ENOENT') return -1;
    throw err;
  }
}

export function isBinary(buf) {
  const n = Math.min(buf.length, 512);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function readGitignore(root) {
  const raw = await readFileOrNull(join(root, '.gitignore'));
  if (!raw) return [];
  return raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith('!'));
}

function gitignoreMatch(patterns, relPath, isDir) {
  const parts = relPath.split(sep).join('/');
  for (const p of patterns) {
    const dirOnly = p.endsWith('/');
    const anchored = p.startsWith('/');
    let pat = p.replace(/^\//, '').replace(/\/$/, '');
    if (dirOnly && !isDir) continue;
    const rx = new RegExp('^' +
      pat.split('/').map(seg =>
        seg.replace(/[.+^${}()|\\]/g, '\\$&')
           .replace(/\*\*/g, '::GLOBSTAR::')
           .replace(/\*/g, '[^/]*')
           .replace(/\?/g, '[^/]')
           .replace(/::GLOBSTAR::/g, '.*')
      ).join('/') + (dirOnly ? '($|/)' : '$'));
    if (anchored) {
      if (rx.test(parts)) return true;
    } else {
      const segments = parts.split('/');
      for (let i = 0; i < segments.length; i++) {
        if (rx.test(segments.slice(i).join('/'))) return true;
      }
    }
  }
  return false;
}

export async function* walk({ root, skipDirs = ['node_modules', '.git', 'dist', 'build', '.autoreview'], includeHidden = false, cap = Infinity, onCapReached = null }) {
  const patterns = await readGitignore(root);
  let count = 0;
  async function* recurse(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!includeHidden && e.name.startsWith('.') && e.name !== '.gitignore') continue;
      if (e.isDirectory() && skipDirs.includes(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relative(root, abs);
      if (gitignoreMatch(patterns, rel, e.isDirectory())) continue;
      if (e.isDirectory()) {
        yield* recurse(abs);
      } else if (e.isFile()) {
        if (count >= cap) { if (onCapReached) onCapReached(count); return; }
        count++;
        yield abs;
      }
    }
  }
  yield* recurse(root);
}

/**
 * Resolve the plugin root directory.
 *   - If env CLAUDE_PLUGIN_ROOT is set, that wins (set by Claude Code hooks).
 *   - Fallback: three dirs up from the caller (assumes scripts/bin/ or scripts/lib/).
 */
export function pluginRoot(importMetaUrl, env = process.env) {
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT;
  return resolve(fileURLToPath(importMetaUrl), '../../../');
}

// Windows-safe replacement for `import.meta.url === \`file://${process.argv[1]}\``.
// That naive comparison fails on Windows (backslashes + double- vs triple-slash
// file:// URL), causing entrypoints to silently no-op with exit 0.
export function isMainModule(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return importMetaUrl === pathToFileURL(argv1).href;
}
