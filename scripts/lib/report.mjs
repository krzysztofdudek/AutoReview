function prefixFor(verdict, severity) {
  if (verdict === 'pass') return '[pass]';
  if (verdict === 'suppressed') return '[suppressed]';
  if (verdict === 'error') return '[error]';
  if (verdict === 'fail') return severity === 'warning' ? '[warn]' : '[reject]';
  return '[error]';
}

/**
 * Emit one stderr line per verdict. For severity:error rejects in quick mode (the pre-commit
 * default) also emit remediation hints — blocked users shouldn't have to hunt the README.
 */
export function reportVerdicts(entry, verdicts, mode, stderr) {
  for (const v of verdicts) {
    const prefix = prefixFor(v.verdict, v.severity);
    stderr.write(`${prefix} ${entry.path} :: ${v.rule}\n`);
    if (mode === 'thinking' && v.reason) {
      stderr.write(`  reason: ${v.reason}\n`);
    }
    if (v.verdict === 'fail' && v.severity === 'error' && mode !== 'thinking') {
      stderr.write(`  why (Claude Code):  /autoreview:review --files ${JSON.stringify(entry.path)} --rule ${v.rule}\n`);
      stderr.write(`  why (shell):        node .autoreview/runtime/bin/validate.mjs --files ${JSON.stringify(entry.path)} --rule ${v.rule}\n`);
      stderr.write(`  skip:               // @autoreview-ignore ${v.rule} <your reason>   (above the offending code)\n`);
      stderr.write(`  edit:               .autoreview/rules/${v.rule}.md   (rule itself is wrong? open and change the body)\n`);
    }
  }
}
