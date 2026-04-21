// scripts/lib/suppress-parser.mjs
// Scan file content for @autoreview-ignore markers. Returns [{line, ruleId, reason, scope}].
// Scope is a heuristic: file-top if within first 5 lines, otherwise 'block'.

export function scanSuppressMarkers(content) {
  const lines = content.split(/\r?\n/);
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only look inside comment-like prefixes
    if (!/^\s*(?:\/\/|#|\/\*|\*|<!--)/.test(line) && !line.includes('@autoreview-ignore')) continue;
    const m = /@autoreview-ignore\s+([A-Za-z0-9_/-]+)(?:\s+(.+?))?\s*(?:\*\/|-->)?\s*$/.exec(line);
    if (!m) continue;
    const ruleId = m[1];
    const reason = (m[2] ?? '').trim();
    const scope = i < 5 ? 'file-top' : 'block';
    markers.push({ line: i + 1, ruleId, reason, scope, valid: reason.length > 0 });
  }
  return markers;
}

