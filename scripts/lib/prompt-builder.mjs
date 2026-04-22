// scripts/lib/prompt-builder.mjs
export const PROMPT_BOILERPLATE_BYTES = 1750;

const TASK_BODY = `You verify whether a source file satisfies a rule.
Check every statement in the rule against the code.

Evaluate: {evaluate}
  - diff: judge the changed lines only; full file is context.
  - full: judge the entire file state.

Mode: {mode}
  - quick: output exactly {"satisfied": true|false}
  - thinking:
      if satisfied=true  → output EXACTLY {"satisfied": true}. Do NOT add "reason". Do NOT add any other field unless a suppression marker below applies. One token of explanation is a bug.
      if satisfied=false → output {"satisfied": false, "reason": "<YOUR CONCRETE EXPLANATION HERE, citing file:line>"}
        where <YOUR CONCRETE EXPLANATION HERE, citing file:line> is REPLACED with your actual finding — e.g. "line 47 uses writeFile for .gitignore, must be writeAtomic". Do NOT copy the placeholder text literally. An empty, missing, or placeholder-echoed reason is a bug.
      if any honored @autoreview-ignore marker applies (regardless of satisfied), add "suppressed": [{"line": N, "reason": "<author's reason from the marker>"}]

Honor \`@autoreview-ignore <rule-id> <reason>\` comments in the code — treat suppressed
code as satisfied. The comment applies contextually (function / class / block / file-top).
When code contains an honored \`@autoreview-ignore <rule-id> <reason>\` marker, include an
entry in \`suppressed\` listing each honored span's starting line and the author-provided reason.
Still set \`satisfied: true\` for the suppressed portion. Absolutely no "reason" field when satisfied=true — there is nothing to say about a pass.

Respond with EXACTLY this JSON, nothing else.`;

export function buildPrompt({ rule, file, diff, mode, evaluate }) {
  const task = `<task>\n${TASK_BODY.replace('{evaluate}', evaluate).replace('{mode}', mode)}\n</task>`;
  const ruleBlock = `<rule id="${rule.id}" name="${rule.frontmatter.name}">\n${rule.body}\n</rule>`;
  const fileBlock = `<file path="${file.path}">\n${file.content}\n</file>`;
  const diffBlock = `\n\n<diff>\n${diff ?? '(no diff — reviewing file state)'}\n</diff>`;
  return `${task}\n\n${ruleBlock}\n\n${fileBlock}${diffBlock}`;
}
