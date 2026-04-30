const PREFIX = { pass: '[pass]', fail: '[reject]', error: '[error]', suppressed: '[suppressed]' };

/**
 * Emit one stderr line per verdict. For rejects in quick mode (the pre-commit default)
 * also emit remediation hints — blocked users shouldn't have to hunt the README.
 *
 * `softContext` tags rejects with `(warn-only)` when enforcement is soft, so the user
 * understands the commit actually went through despite the [reject] line.
 */
export function reportVerdicts(entry, verdicts, mode, stderr, { softContext = false } = {}) {
  for (const v of verdicts) {
    const prefix = PREFIX[v.verdict] ?? '[error]';
    const softTag = softContext && v.verdict === 'fail' ? ' (warn-only — commit proceeds under soft enforcement)' : '';
    stderr.write(`${prefix} ${entry.path} :: ${v.rule}${softTag}\n`);
    if (mode === 'thinking' && v.reason) {
      stderr.write(`  reason: ${v.reason}\n`);
    }
    if (v.verdict === 'fail' && mode !== 'thinking') {
      // Slash form works inside Claude Code; node form works in any shell (copy-paste safe).
      stderr.write(`  why (Claude Code):  /autoreview:review --files '${entry.path}' --rule ${v.rule} --mode thinking\n`);
      stderr.write(`  why (shell):        node .autoreview/runtime/bin/validate.mjs --files '${entry.path}' --rule ${v.rule} --mode thinking\n`);
      stderr.write(`  skip:               // @autoreview-ignore ${v.rule} <your reason>   (above the offending code)\n`);
      stderr.write(`  edit:               .autoreview/rules/${v.rule}.md   (rule itself is wrong? open and change the body)\n`);
      stderr.write(`  help:               README section "Escape hatches" — soft mode, --no-verify, tradeoffs\n`);
    }
  }
}
