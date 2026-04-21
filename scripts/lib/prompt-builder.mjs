// scripts/lib/prompt-builder.mjs
export const PROMPT_BOILERPLATE_BYTES = 700;

const TASK_BODY = `You verify whether a source file satisfies a rule.
Check every statement in the rule against the code.

Evaluate: {evaluate}
  - diff: judge the changed lines only; full file is context.
  - full: judge the entire file state.

Mode: {mode}
  - quick: output exactly {"satisfied": true|false}
  - thinking: output exactly {"satisfied": true|false, "reason": "explanation with file:line refs", "suppressed": [{"line": N, "reason": "..."}]}

Honor \`@autoreview-ignore <rule-id> <reason>\` comments in the code — treat suppressed
code as satisfied. The comment applies contextually (function / class / block / file-top).
When code contains an honored \`@autoreview-ignore <rule-id> <reason>\` marker, include an
entry in \`suppressed\` listing each honored span's starting line and the author-provided reason.
Still set \`satisfied: true\` for the suppressed portion.

Respond with EXACTLY this JSON, nothing else.`;

export function buildPrompt({ rule, file, diff, mode, evaluate }) {
  const task = `<task>\n${TASK_BODY.replace('{evaluate}', evaluate).replace('{mode}', mode)}\n</task>`;
  const ruleBlock = `<rule id="${rule.id}" name="${rule.frontmatter.name}">\n${rule.body}\n</rule>`;
  const fileBlock = `<file path="${file.path}">\n${file.content}\n</file>`;
  const diffBlock = diff ? `\n\n<diff>\n${diff}\n</diff>` : '';
  return `${task}\n\n${ruleBlock}\n\n${fileBlock}${diffBlock}`;
}
