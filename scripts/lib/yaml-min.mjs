// scripts/lib/yaml-min.mjs
// Minimal YAML subset parser. Zero deps. Targets AutoReview config + rule frontmatter only.
// Supported: scalars, nested maps, block lists, inline maps/lists, comments, literal |.
// Unsupported (throws): anchors (&), aliases (*), tags (!!), folded (>), multi-document (---).

export class YamlError extends Error {
  constructor(msg, line) {
    super(line >= 0 ? `${msg} (line ${line})` : msg);
    this.line = line;
  }
}

const UNSUPPORTED = /^[*&!]|^>\s*$/;

function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line;
}

function indentOf(s) { const m = s.match(/^ */); return m[0].length; }

function coerceScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('{') || s.startsWith('[')) return parseInlineExpr(s);
  if (UNSUPPORTED.test(s)) throw new YamlError(`unsupported YAML construct: ${s[0]}`, -1);
  return s;
}

function parseInlineExpr(s) {
  const toks = tokenizeInline(s);
  let i = 0;
  function parseOne() {
    if (toks[i] === '{') {
      i++; const obj = {};
      while (toks[i] !== '}') {
        const kTok = toks[i++];
        const key = (kTok.startsWith('"') || kTok.startsWith("'")) ? kTok.slice(1, -1) : kTok;
        if (toks[i] !== ':') throw new YamlError('expected : in inline map', -1);
        i++;
        obj[key] = parseOne();
        if (toks[i] === ',') i++;
      }
      i++; return obj;
    }
    if (toks[i] === '[') {
      i++; const arr = [];
      while (toks[i] !== ']') {
        arr.push(parseOne());
        if (toks[i] === ',') i++;
      }
      i++; return arr;
    }
    const v = toks[i++];
    if (typeof v === 'string' && (v.startsWith('"') || v.startsWith("'"))) return coerceScalar(v);
    return coerceBare(v);
  }
  return parseOne();
}

function tokenizeInline(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('{}[],:'.includes(c)) { out.push(c); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1;
      while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; }
      out.push(s.slice(i, j + 1)); i = j + 1; continue;
    }
    let j = i;
    while (j < s.length && !'{}[],: \t'.includes(s[j])) j++;
    out.push(s.slice(i, j)); i = j;
  }
  return out;
}

function coerceBare(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  return s;
}

export function parse(text) {
  // Normalize CRLF → LF so trailing `\r` on the last line (e.g. when fm came from
  // `splitFrontmatter` cut at `\n---` and the file uses CRLF) doesn't slip through
  // `split(/\r?\n/)` and break key-line regexes that anchor on `$`.
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '');
  text = text.replace(/^---\s*\n/, '');
  if (/\n---\s*\n/.test(text)) throw new YamlError('multi-document streams not supported', -1);
  const rawLines = text.split('\n');
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripComment(rawLines[i]);
    if (stripped.trim() === '') continue;
    lines.push({ text: stripped, indent: indentOf(stripped), no: i + 1 });
  }
  let idx = 0;

  function parseBlock(indent) {
    if (idx >= lines.length) return null;
    const first = lines[idx];
    if (first.indent < indent) return null;
    if (first.text.trim().startsWith('- ')) return parseList(indent);
    return parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (idx < lines.length) {
      const l = lines[idx];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indent', l.no);
      const body = l.text.slice(indent);
      if (body.startsWith('- ')) break;
      const mKey = body.match(/^([A-Za-z_][A-Za-z0-9_\-]*|"[^"]+"|'[^']+'):\s*(.*)$/);
      if (!mKey) throw new YamlError(`expected key`, l.no);
      let key = mKey[1]; const valStr = mKey[2];
      if (key.startsWith('"') || key.startsWith("'")) key = key.slice(1, -1);
      idx++;
      if (valStr === '' || valStr === undefined) {
        const nested = parseBlock(indent + 2);
        obj[key] = nested === null ? null : nested;
      } else if (valStr === '|') {
        obj[key] = consumeLiteralScalar(indent + 2);
      } else {
        obj[key] = coerceScalar(valStr);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (idx < lines.length) {
      const l = lines[idx];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indent in list', l.no);
      const body = l.text.slice(indent);
      if (!body.startsWith('- ')) break;
      const rest = body.slice(2);
      if (rest.startsWith('{') || rest.startsWith('[')) {
        arr.push(coerceScalar(rest)); idx++;
      } else if (/^[A-Za-z_][A-Za-z0-9_\-]*:\s/.test(rest) || /^[A-Za-z_][A-Za-z0-9_\-]*:$/.test(rest)) {
        const virtualIndent = indent + 2;
        lines[idx] = { text: ' '.repeat(virtualIndent) + rest, indent: virtualIndent, no: l.no };
        arr.push(parseMap(virtualIndent));
      } else {
        arr.push(coerceScalar(rest)); idx++;
      }
    }
    return arr;
  }

  function consumeLiteralScalar(indent) {
    const parts = [];
    while (idx < lines.length && lines[idx].indent >= indent) {
      parts.push(lines[idx].text.slice(indent));
      idx++;
    }
    return parts.join('\n');
  }

  return parseBlock(0) ?? {};
}
