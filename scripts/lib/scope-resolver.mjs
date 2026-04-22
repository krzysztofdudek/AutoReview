// scripts/lib/scope-resolver.mjs
// Resolves --scope / --sha / --files / --dir into a list of {path, content, diff, binary, size}.
// Binary detection centralized here per design §3.

import { readFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array(Math.min(limit, items.length)).fill(0).map(worker);
  await Promise.all(workers);
  return results;
}
import {
  stagedPaths, worktreeModifiedPaths,
  diffStaged, diffUncommitted,
  commitFiles, fileAtCommit, commitDiff, resolveSha,
} from './git-utils.mjs';
import { walk, isBinary } from './fs-utils.mjs';

async function readWithBinaryDetect(absPath) {
  const buf = await readFile(absPath).catch(() => null);
  if (!buf) return { content: '', binary: false, size: 0 };
  const binary = isBinary(buf);
  return { content: buf.toString('utf8'), binary, size: buf.length };
}

async function readCommitContentWithBinaryDetect(repoRoot, sha, path) {
  const content = await fileAtCommit(repoRoot, sha, path);
  const buf = Buffer.from(content, 'utf8');
  return { content, binary: isBinary(buf), size: buf.length };
}

async function readEntries(repoRoot, paths, diffFn) {
  return runLimited(paths, 16, async (p) => {
    // Accept absolute paths straight; repo-relative get joined. Keep `path` field
    // normalized to repo-relative so rule `path:` globs evaluate the same way
    // regardless of how the caller spelled the file.
    const abs = isAbsolute(p) ? p : join(repoRoot, p);
    const { content, binary, size } = await readWithBinaryDetect(abs);
    const rel = isAbsolute(p) && p.startsWith(repoRoot + '/')
      ? p.slice(repoRoot.length + 1)
      : p;
    const diffResult = diffFn(rel);
    const diff = diffResult && typeof diffResult.catch === 'function'
      ? await diffResult.catch(() => null)
      : await diffResult;
    return { path: rel, content, diff, binary, size };
  });
}

export async function resolveScope({ repoRoot, scope = null, sha = null, files = null, dir = null, walkCap = 10000 }) {
  // Normalize dir: treat single string and array uniformly for mode-count purposes
  const dirNorm = Array.isArray(dir) ? (dir.length > 0 ? dir : null) : dir;
  const modes = [scope, sha, files, dirNorm].filter(x => x != null && x !== false);
  if (modes.length > 1) throw new Error('--scope, --sha, --files, --dir are mutually exclusive (pick one)');
  const warnings = [];
  if (sha) {
    const resolved = await resolveSha(repoRoot, sha);
    const paths = await commitFiles(repoRoot, resolved);
    const entries = await runLimited(paths, 16, async (p) => {
      const { content, binary, size } = await readCommitContentWithBinaryDetect(repoRoot, resolved, p);
      const diff = await commitDiff(repoRoot, resolved, p).catch(() => null);
      return { path: p, content, diff, binary, size };
    });
    return { entries, warnings, sha: resolved };
  }
  if (scope === 'staged') {
    const paths = await stagedPaths(repoRoot);
    return { entries: await readEntries(repoRoot, paths, p => diffStaged(repoRoot, p)), warnings };
  }
  if (scope === 'uncommitted') {
    const paths = await worktreeModifiedPaths(repoRoot);
    return { entries: await readEntries(repoRoot, paths, p => diffUncommitted(repoRoot, p)), warnings };
  }
  if (scope === 'all') {
    const paths = [];
    for await (const abs of walk({ root: repoRoot, cap: walkCap, onCapReached: () => warnings.push(`reached walk cap (${walkCap} files)`) })) {
      paths.push(relative(repoRoot, abs));
    }
    return { entries: await readEntries(repoRoot, paths, () => null), warnings };
  }
  if (files) {
    return { entries: await readEntries(repoRoot, files, () => null), warnings };
  }
  if (dirNorm) {
    const dirs = Array.isArray(dirNorm) ? dirNorm : [dirNorm];
    const paths = [];
    for (const d of dirs) {
      for await (const abs of walk({ root: join(repoRoot, d), cap: walkCap })) {
        paths.push(relative(repoRoot, abs));
      }
    }
    return { entries: await readEntries(repoRoot, paths, () => null), warnings };
  }
  throw new Error('one of --scope | --sha | --files | --dir required');
}
