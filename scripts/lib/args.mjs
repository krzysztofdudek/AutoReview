// scripts/lib/args.mjs
// Minimal argv parser. Zero deps.
// Supports --k v, --k=v, --flag (booleans list), -s v (aliases), repeatable (multiples list), -- stops parsing.

export function parseArgs(argv, { booleans = [], aliases = {}, multiple = [] } = {}) {
  const values = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      let [k, v] = a.slice(2).split(/=(.*)/, 2);
      if (booleans.includes(k)) { values[k] = true; i++; continue; }
      if (v === undefined) { v = argv[++i]; }
      if (multiple.includes(k)) { (values[k] ??= []).push(v); }
      else values[k] = v;
      i++; continue;
    }
    if (a.startsWith('-') && a.length === 2 && aliases[a[1]]) {
      const k = aliases[a[1]];
      if (booleans.includes(k)) { values[k] = true; i++; continue; }
      const v = argv[++i];
      if (multiple.includes(k)) { (values[k] ??= []).push(v); }
      else values[k] = v;
      i++; continue;
    }
    positional.push(a); i++;
  }
  return { values, positional };
}
