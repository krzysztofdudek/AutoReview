const PREFIX = { pass: '[pass]', fail: '[reject]', error: '[error]', suppressed: '[suppressed]' };

export function reportVerdicts(entry, verdicts, mode, stderr) {
  for (const v of verdicts) {
    const prefix = PREFIX[v.verdict] ?? '[error]';
    stderr.write(`${prefix} ${entry.path} :: ${v.rule}\n`);
    if (mode === 'thinking' && v.reason) {
      stderr.write(`  reason: ${v.reason}\n`);
    }
    // Every blocked user sees [reject]. Surface remediation right next to it —
    // they shouldn't have to hunt through the README to know what to do.
    if (v.verdict === 'fail' && mode !== 'thinking') {
      stderr.write(`  why: autoreview validate --files '${entry.path}' --rule ${v.rule} --mode thinking\n`);
      stderr.write(`  skip: // @autoreview-ignore ${v.rule} <your reason>   (above the offending code)\n`);
    }
  }
}
