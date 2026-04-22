// scripts/lib/rule-authoring.mjs
// Rule authoring helpers — rendering YAML frontmatter + writing file.

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';

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

export function renderRule({ name, triggers, intent, description, provider, model, body }) {
  const fm = [
    `name: "${escapeDouble(name)}"`,
    `triggers: '${triggers.replace(/'/g, "''")}'`,
  ];
  if (intent) fm.push(`intent: "${escapeDouble(intent)}"`);
  if (description) fm.push(`description: "${escapeDouble(description)}"`);
  if (provider) fm.push(`provider: ${provider}`);
  if (model) fm.push(`model: ${model}`);
  return `---\n${fm.join('\n')}\n---\n${body}\n`;
}

export async function saveRule({ repoRoot, relativePath, content }) {
  validateRelativePath(relativePath);
  const rulesDir = resolve(repoRoot, '.autoreview/rules');
  const abs = resolve(rulesDir, relativePath);
  // Belt-and-braces: even with validation above, verify the resolved path stays inside the rules dir.
  if (abs !== rulesDir && !abs.startsWith(rulesDir + '/')) {
    throw new Error(`relativePath escapes .autoreview/rules: ${relativePath}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return abs;
}
