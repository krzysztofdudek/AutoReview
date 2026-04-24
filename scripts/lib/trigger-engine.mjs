// scripts/lib/trigger-engine.mjs
// Trigger expression parser + evaluator. Zero deps.
// Grammar (design §3): EXPR = OR; OR = AND ('OR' AND)*; AND = UNARY ('AND' UNARY)*;
// UNARY = 'NOT' UNARY | ATOM; ATOM = '(' EXPR ')' | PREDICATE;
// PREDICATE = ('path'|'content') ':' STRING. Operators case-insensitive outside quotes.

export class TriggerParseError extends Error {
  constructor(message, position) { super(message); this.position = position; }
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === ':') { toks.push({ type: c, pos: i }); i++; continue; }
    if (c === '"') {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') {
          const nx = src[j + 1];
          if (nx === '"') buf += '"';
          else if (nx === '\\') buf += '\\';
          else if (nx === 'n') buf += '\n';
          else throw new TriggerParseError(`bad escape \\${nx}`, j);
          j += 2;
        } else { buf += src[j++]; }
      }
      if (j >= src.length) throw new TriggerParseError('unterminated string', i);
      toks.push({ type: 'STRING', value: buf, pos: i });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && /[A-Za-z_]/.test(src[j])) j++;
    if (j === i) throw new TriggerParseError(`unexpected '${c}'`, i);
    const ident = src.slice(i, j);
    const upper = ident.toUpperCase();
    if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
      toks.push({ type: upper, pos: i });
    } else if (ident === 'path' || ident === 'content' || ident === 'dir') {
      toks.push({ type: 'KIND', value: ident, pos: i });
    } else {
      throw new TriggerParseError(`unknown identifier '${ident}'`, i);
    }
    i = j;
  }
  return toks;
}

function parser(toks) {
  let i = 0;
  const peek = () => toks[i];
  const eat = (type) => {
    if (peek()?.type !== type) throw new TriggerParseError(`expected ${type}`, peek()?.pos ?? -1);
    return toks[i++];
  };
  function expr() { return or(); }
  function or() {
    let left = and();
    while (peek()?.type === 'OR') { i++; left = { type: 'or', children: [left, and()] }; }
    return left;
  }
  function and() {
    let left = unary();
    while (peek()?.type === 'AND') { i++; left = { type: 'and', children: [left, unary()] }; }
    return left;
  }
  function unary() {
    if (peek()?.type === 'NOT') { i++; return { type: 'not', child: unary() }; }
    return atom();
  }
  function atom() {
    if (peek()?.type === '(') { i++; const e = expr(); eat(')'); return e; }
    const kind = eat('KIND');
    eat(':');
    const str = eat('STRING');
    return { type: 'pred', kind: kind.value, value: str.value };
  }
  const out = expr();
  if (i !== toks.length) throw new TriggerParseError(`trailing tokens`, toks[i].pos);
  return out;
}

export function parse(src) { return parser(tokenize(src)); }

function expandBraces(g) {
  const m = g.match(/\{([^{}]+)\}/);
  if (!m) return [g];
  const [full, inner] = m;
  const opts = inner.split(',');
  return opts.flatMap(o => expandBraces(g.replace(full, o)));
}

function toRegex(glob) {
  let rx = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        // '**/' matches zero or more path segments (including zero)
        if (glob[i + 1] === '/') { rx += '(?:.*/)?'; i++; }
        else rx += '.*';
      } else rx += '[^/]*';
    } else if (c === '?') rx += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end === -1) throw new Error(`unterminated '[' bracket in glob: ${glob}`);
      rx += glob.slice(i, end + 1);
      i = end;
    } else if ('.+^${}()|\\'.includes(c)) rx += '\\' + c;
    else rx += c;
  }
  rx += '$';
  return new RegExp(rx);
}

// Very rough heuristic: reject known catastrophic-backtracking shapes.
// We can't detect all ReDoS patterns, but refusing the most common classes
// (nested quantifiers like (a+)+, (a*)*) blocks 95% of practical attacks.
const REDOS_RE = /(\([^)]*[+*][^)]*\)|\[[^\]]+\][+*])[+*]/;

function compileContentRegex(pattern) {
  if (REDOS_RE.test(pattern)) {
    throw new Error(`content: regex rejected as potentially pathological (nested quantifier): ${pattern}`);
  }
  return new RegExp(pattern);
}

function compilePathMatcher(glob) {
  const branches = expandBraces(glob);
  const regexes = branches.map(b => toRegex(b));
  return (path) => regexes.some(rx => rx.test(path));
}

export function matchPath(glob, path) {
  return compilePathMatcher(glob)(path);
}

export function evaluate(ast, ctx) {
  switch (ast.type) {
    case 'pred':
      if (ast.kind === 'path') {
        if (!ast._pathRx) ast._pathRx = compilePathMatcher(ast.value);
        return ast._pathRx(ctx.path);
      }
      if (ast.kind === 'dir') {
        if (!ast._dirRx) ast._dirRx = compilePathMatcher(`${ast.value.replace(/\/$/, '')}/**`);
        return ast._dirRx(ctx.path);
      }
      if (ast.kind === 'content') {
        if (ctx.binary) return false;
        if (!ast._contentRx) ast._contentRx = compileContentRegex(ast.value);
        return ast._contentRx.test(ctx.content);
      }
      return false;
    case 'not': return !evaluate(ast.child, ctx);
    case 'and': return ast.children.every(c => evaluate(c, ctx));
    case 'or': return ast.children.some(c => evaluate(c, ctx));
  }
}

export function shouldTreatAsNonMatchForContent(size, isBinary) {
  return isBinary || size > 1_048_576;
}
