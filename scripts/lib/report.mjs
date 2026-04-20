const PREFIX = { pass: '[pass]', fail: '[reject]', error: '[error]' };

export function reportVerdicts(entry, verdicts, mode, stderr) {
  for (const v of verdicts) {
    const prefix = PREFIX[v.verdict] ?? '[error]';
    stderr.write(`${prefix} ${entry.path} :: ${v.rule}\n`);
    if (mode === 'thinking' && v.reason) {
      stderr.write(`  reason: ${v.reason}\n`);
    }
  }
}
