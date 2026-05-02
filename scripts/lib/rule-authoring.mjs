// scripts/lib/rule-authoring.mjs
// Rule authoring helpers — rendering YAML frontmatter + writing file.

import { mkdir } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute, sep } from 'node:path';
import { writeAtomic } from './fs-utils.mjs';

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('relativePath must be a non-empty string');
  }
  if (isAbsolute(relativePath)) {
    throw new Error(`relativePath must not be absolute: ${relativePath}`);
  }
  // Reject traversal segments outright; filters `..`, `./..`, `foo/../bar` etc.
  const segments = relativePath.split(/[/\\]/).filter(Boolean);
  if (segments.some(s => s === '..')) {
    throw new Error(`relativePath must not contain '..' segments: ${relativePath}`);
  }
}

function escapeDouble(str) { return str.replace(/"/g, '\\"'); }

export function renderRule({ name, triggers, tier, severity, type, description, body }) {
  const fm = [
    `name: "${escapeDouble(name)}"`,
    `triggers: '${triggers.replace(/'/g, "''")}'`,
  ];
  if (tier) fm.push(`tier: ${tier}`);
  if (severity) fm.push(`severity: ${severity}`);
  if (type) fm.push(`type: ${type}`);
  if (description) fm.push(`description: "${escapeDouble(description)}"`);
  return `---\n${fm.join('\n')}\n---\n${body}\n`;
}

export async function saveRule({ repoRoot, relativePath, content }) {
  validateRelativePath(relativePath);
  const rulesDir = resolve(repoRoot, '.autoreview/rules');
  const abs = resolve(rulesDir, relativePath);
  // Belt-and-braces: even with validation above, verify the resolved path stays inside the rules dir.
  // Use the platform path separator at the boundary (POSIX `/`, Windows `\`) — both `rulesDir` and
  // `abs` come from the same `resolve()` and thus use the same separator on each platform.
  if (abs !== rulesDir && !abs.startsWith(rulesDir + sep)) {
    throw new Error(`relativePath escapes .autoreview/rules: ${relativePath}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeAtomic(abs, content);
  // Return a POSIX-style path so callers (display, tests) get a consistent string
  // across platforms. The file system path itself is correctly `abs` on disk.
  return abs.split(sep).join('/');
}
