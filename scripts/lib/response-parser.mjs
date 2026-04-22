// 4-tier fallback JSON extraction for provider responses.

export function parseResponse(raw) {
  if (!raw || typeof raw !== 'string') return { satisfied: false, providerError: true, raw };
  const trimmed = raw.trim();

  // Tier 1: direct parse
  try {
    return normalize(JSON.parse(trimmed), raw);
  } catch {}

  // Tier 2: markdown fence
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) {
    try {
      return normalize(JSON.parse(fence[1].trim()), raw);
    } catch {}
  }

  // Tier 3: first balanced-brace object
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    const slice = balancedObject(trimmed, firstBrace);
    if (slice) {
      try {
        return normalize(JSON.parse(slice), raw);
      } catch {}
    }
  }

  // Tier 4: keyword fallback
  const lower = trimmed.toLowerCase();
  const hasNot = /\bnot\s+satisfied\b/.test(lower);
  const hasSatisfied = /\bsatisfied\b/.test(lower);
  if (hasNot) return { satisfied: false, reason: trimmed.slice(0, 200) };
  if (hasSatisfied) return { satisfied: true };

  return { satisfied: false, providerError: true, raw };
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
