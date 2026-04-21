// scripts/lib/rule-authoring.mjs
// Rule authoring helpers — rendering YAML frontmatter + writing file.

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

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
  const abs = join(repoRoot, '.autoreview/rules', relativePath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return abs;
}
