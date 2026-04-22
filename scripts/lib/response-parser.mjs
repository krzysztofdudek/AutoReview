// 4-tier fallback JSON extraction for provider responses.
// Each tier yields a candidate; we accept the LAST candidate that has a `satisfied` key
// (models often quote the input file's JSON before emitting the verdict — we must not
// pick up the quoted input as the verdict object).

export function parseResponse(raw) {
  if (!raw || typeof raw !== 'string') return { satisfied: false, providerError: true, raw };
  const trimmed = raw.trim();

  // Tier 1: direct parse
  try {
    const obj = JSON.parse(trimmed);
    if (hasSatisfiedKey(obj)) return normalize(obj, raw);
  } catch {}

  // Tier 2: every markdown fence — pick the LAST with a `satisfied` key.
  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g)];
  let fenceVerdict = null;
  for (const m of fenceMatches) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (hasSatisfiedKey(obj)) fenceVerdict = obj;
    } catch {}
  }
  if (fenceVerdict) return normalize(fenceVerdict, raw);

  // Tier 3: every balanced-brace object — pick the LAST with a `satisfied` key.
  let braceVerdict = null;
  let i = 0;
  while (i < trimmed.length) {
    const open = trimmed.indexOf('{', i);
    if (open === -1) break;
    const slice = balancedObject(trimmed, open);
    if (!slice) break;
    try {
      const obj = JSON.parse(slice);
      if (hasSatisfiedKey(obj)) braceVerdict = obj;
    } catch {}
    i = open + slice.length;
  }
  if (braceVerdict) return normalize(braceVerdict, raw);

  // Tier 4: keyword fallback — look at the TAIL of the raw text (last 500 chars), which is
  // where a reasoning trace typically ends with the verdict.
  const tail = trimmed.slice(-500).toLowerCase();
  const hasNot = /\bnot\s+satisfied\b|satisfied[^\n]{0,20}false/.test(tail);
  const hasSatisfied = /\bsatisfied\b/.test(tail);
  if (hasNot) return { satisfied: false, reason: trimmed.slice(-200) };
  if (hasSatisfied) return { satisfied: true };

  return { satisfied: false, providerError: true, raw };
}

function hasSatisfiedKey(obj) {
  return obj != null && typeof obj === 'object' && !Array.isArray(obj) && 'satisfied' in obj;
}

function balancedObject(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function normalize(obj, raw) {
  if (typeof obj !== 'object' || obj === null) return { satisfied: false, providerError: true, raw };
  const satisfied = !!obj.satisfied;
  // Reason is redundant when satisfied=true. Drop it regardless of what the model emitted.
  return { satisfied, reason: satisfied ? undefined : obj.reason, suppressed: obj.suppressed };
}
