/**
 * cljs.js — Interprete ClojureScript leggero (sottoinsieme, ispirato a SCI).
 *
 * Modulo puro: nessun accesso al DOM, nessuna dipendenza, nessuna JVM. Serve a
 * valutare il codice utente scritto in ClojureScript e a esporne le definizioni
 * (usabili poi dalle formule del foglio).
 *
 * I namespace sono di primo livello: `sheet.core` contiene le funzioni del
 * foglio definite in ClojureScript (SUM, AVG, …) e `user` è il namespace in cui
 * vive il codice dell'utente. Le celle vedono entrambi anche senza prefisso.
 *
 * Sottoinsieme supportato:
 *  - forme speciali: def defonce defn fn let if when when-not cond and or do
 *    -> ->> quote comment ns;
 *  - arità multiple `(defn f ([x] ...) ([x y] ...))` e variadiche `[x & xs]`;
 *  - tipi: numeri, stringhe, booleani, nil, keyword, vettori, mappe, liste;
 *  - funzioni di base (namespace implicito `cljs.core`): aritmetica, confronti,
 *    collezioni (map/filter/reduce/…), stringhe, matematica (`Math`).
 *
 * I nomi ClojureScript con trattino/`?`/`!` sono esposti anche nella forma
 * "munged" (`con-iva` -> `con_iva`) così da poter essere usati nelle formule.
 */

/** Errore dell'interprete, con la riga del sorgente che lo ha generato. */
export class CLJSError extends Error {
  constructor(message, line = 0) {
    super(message);
    this.name = 'CLJSError';
    this.line = line | 0;
  }
}

/* ===== Tipi del lettore ===== */

class Sym { constructor(name, line) { this.name = name; this.line = line; } }
class Kw { constructor(name) { this.name = name; } }
class ListF { constructor(items) { this.items = items; } }
class Vec { constructor(items) { this.items = items; } }
class MapF { constructor(entries) { this.entries = entries; } }

const DISCARD = Symbol('discard');
const OPEN = '([{';
const CLOSE = ')]}';
const DELIM = new Set(['(', ')', '[', ']', '{', '}', '"', ';', ',', "'", '`']);

const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** Converte un token atomico nel valore o nella forma corrispondente. */
function atom(t, line) {
  if (t === 'nil') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t[0] === ':') return new Kw(t.replace(/^:+/, ''));
  if (t[0] === '\\') {
    const n = t.slice(1);
    return n === 'newline' ? '\n' : n === 'space' ? ' ' : n === 'tab' ? '\t' : n === 'return' ? '\r' : n;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  return new Sym(t, line);
}

/** Lettore di forme ClojureScript. */
class Reader {
  constructor(src) { this.src = src; this.i = 0; this.line = 1; }
  atEnd() { return this.i >= this.src.length; }
  peek() { return this.src[this.i]; }
  next() { const c = this.src[this.i++]; if (c === '\n') this.line++; return c; }
  skipBlanks() {
    for (;;) {
      const c = this.peek();
      if (c === undefined) return;
      if (c === ',' || isSpace(c)) { this.next(); continue; }
      if (c === ';') { while (!this.atEnd() && this.peek() !== '\n') this.next(); continue; }
      return;
    }
  }
  /** Legge tutte le forme di primo livello. @returns {Array} */
  readTop() {
    const out = [];
    for (;;) {
      this.skipBlanks();
      if (this.atEnd()) return out;
      const f = this.readForm();
      if (f !== DISCARD) out.push(f);
    }
  }
  readForm() {
    this.skipBlanks();
    const line = this.line, c = this.peek();
    if (c === undefined) throw new CLJSError("fine dell'input inattesa", line);
    if (c === '(') { this.next(); return new ListF(this.readSeq(')', line)); }
    if (c === '[') { this.next(); return new Vec(this.readSeq(']', line)); }
    if (c === '{') { this.next(); return new MapF(this.readSeq('}', line)); }
    if (c === ')' || c === ']' || c === '}') throw new CLJSError('chiusura «' + c + '» inattesa', line);
    if (c === '"') return this.readString();
    if (c === "'" || c === '`') { this.next(); return new ListF([new Sym('quote', line), this.readForm()]); }
    if (c === '#') return this.readDispatch(line);
    return this.readToken(line);
  }
  readSeq(close, line) {
    const items = [];
    for (;;) {
      this.skipBlanks();
      const c = this.peek();
      if (c === undefined) throw new CLJSError('parentesi «' + close + '» non chiusa', line);
      if (c === close) { this.next(); return items; }
      if (c === ')' || c === ']' || c === '}') throw new CLJSError('chiusura «' + c + '» inattesa', this.line);
      const f = this.readForm();
      if (f !== DISCARD) items.push(f);
    }
  }
  readDispatch(line) {
    this.next();
    const c = this.peek();
    if (c === '_') { this.next(); this.readForm(); return DISCARD; }
    if (c === '{') { this.next(); return new Vec(this.readSeq('}', line)); }
    throw new CLJSError('lettore «#' + (c ?? '') + '» non supportato', line);
  }
  readString() {
    const line = this.line;
    this.next();
    let s = '';
    for (;;) {
      if (this.atEnd()) throw new CLJSError('stringa non chiusa', line);
      const c = this.next();
      if (c === '"') return s;
      if (c !== '\\') { s += c; continue; }
      const d = this.next();
      if (d === 'n') s += '\n';
      else if (d === 't') s += '\t';
      else if (d === 'r') s += '\r';
      else if (d === 'u') { s += String.fromCharCode(parseInt(this.src.substr(this.i, 4), 16)); this.i += 4; }
      else s += d;
    }
  }
  readToken(line) {
    let t = '';
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === undefined || isSpace(c) || DELIM.has(c)) break;
      t += this.next();
    }
    if (!t) throw new CLJSError('carattere inatteso «' + this.peek() + '»', line);
    return atom(t, line);
  }
}

/** Legge tutte le forme di primo livello da `code`. @returns {Array} */
export function readForms(code) {
  return new Reader(String(code ?? '')).readTop();
}

/** Errore di lettura (sintassi) oppure `null`. @returns {CLJSError|null} */
export function readError(code) {
  try { readForms(code); return null; }
  catch (e) { return e instanceof CLJSError ? e : new CLJSError(e && e.message ? e.message : String(e), 0); }
}

/** Nome ClojureScript nella forma usabile da JavaScript (Clojure "munge"). */
export function munge(name) {
  return String(name).replace(/-/g, '_').replace(/\?$/, '_QMARK_').replace(/!$/, '_BANG_').replace(/\*$/, '_STAR_');
}


/* ===== Valutatore ===== */

const truthy = v => v !== false && v !== null && v !== undefined;

const symName = (x, what = 'nome') => {
  if (x instanceof Sym || x instanceof Kw) return x.name;
  throw new CLJSError('atteso un ' + what + ' ma trovato ' + describe(x));
};

const describe = v => Array.isArray(v) ? 'vettore' : v instanceof ListF ? 'lista' : v instanceof MapF ? 'mappa' : v instanceof Sym ? 'simbolo «' + v.name + '»' : JSON.stringify(v ?? null);

/** Uguaglianza strutturale usata da `=` e `not=`. */
function equals(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => equals(a[k], b[k]));
  }
  return false;
}

/** Converte una forma in dato puro (per `quote`). */
function data(f) {
  if (f instanceof ListF) return f.items.map(data);
  if (f instanceof Vec) return f.items.map(data);
  if (f instanceof MapF) { const o = {}; for (let i = 0; i + 1 < f.entries.length; i += 2) o[String(data(f.entries[i]))] = data(f.entries[i + 1]); return o; }
  if (f instanceof Sym || f instanceof Kw) return f.name;
  return f;
}

/**
 * Risolve un simbolo: i nomi qualificati `ns/nome` nel registro dei namespace,
 * gli altri lungo la catena degli scope (lessicale + namespace referiti).
 */
function resolveSym(scope, name, line) {
  const slash = name.indexOf('/');
  if (slash > 0 && slash < name.length - 1) {
    const vars = scope.registry.get(name.slice(0, slash));
    const vName = name.slice(slash + 1);
    if (vars && vars.has(vName)) return vars.get(vName);
    throw new CLJSError('#NAME: simbolo non definito «' + name + '»', line);
  }
  for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
  throw new CLJSError('#NAME: simbolo non definito «' + name + '»', line);
}

/** Valuta una forma nell'ambiente `scope`. */
function evalForm(f, scope, defs) {
  if (f instanceof Sym) return resolveSym(scope, f.name, f.line);
  if (f instanceof Kw) return f.name;
  if (f instanceof Vec) return f.items.map(x => evalForm(x, scope, defs));
  if (f instanceof MapF) {
    if (f.entries.length % 2) throw new CLJSError('mappa con un numero dispari di elementi');
    const o = {};
    for (let i = 0; i < f.entries.length; i += 2) o[String(evalForm(f.entries[i], scope, defs))] = evalForm(f.entries[i + 1], scope, defs);
    return o;
  }
  if (f instanceof ListF) return evalList(f, scope, defs);
  return f;
}

/** Valuta il corpo di una funzione/let: tutte le forme, valore dell'ultima. */
function evalBody(forms, scope, defs) {
  let v = null;
  for (const f of forms) v = evalForm(f, scope, defs);
  return v;
}

function evalList(f, scope, defs) {
  const { items } = f;
  if (!items.length) return [];
  const head = items[0];
  if (head instanceof Sym && SPECIALS[head.name]) return SPECIALS[head.name](items, scope, defs);
  const fn = evalForm(head, scope, defs);
  const args = items.slice(1).map(x => evalForm(x, scope, defs));
  if (typeof fn !== 'function') throw new CLJSError('#ERR: «' + describe(head) + '» non è una funzione', head instanceof Sym ? head.line : 0);
  return fn(...args);
}

/** Arità di una funzione: parametri fissi + eventuale parametro variadico. */
function parseParams(vec) {
  const params = [];
  let rest = null;
  for (let i = 0; i < vec.items.length; i++) {
    const s = vec.items[i];
    if (s instanceof Sym && s.name === '&') { rest = symName(vec.items[i + 1], 'parametro'); i++; continue; }
    params.push(symName(s, 'parametro'));
  }
  return { params, rest };
}

/** Elenca le arità di `fn`/`defn` a partire dall'indice `start`. */
function parseArities(items, start) {
  let i = start;
  if (typeof items[i] === 'string') i++;                       // docstring
  const first = items[i];
  if (first instanceof Vec) return [{ ...parseParams(first), body: items.slice(i + 1) }];
  const ars = [];
  for (; i < items.length; i++) {
    const l = items[i];
    if (!(l instanceof ListF) || !(l.items[0] instanceof Vec)) throw new CLJSError('arità non valida in fn/defn');
    ars.push({ ...parseParams(l.items[0]), body: l.items.slice(1) });
  }
  if (!ars.length) throw new CLJSError('fn/defn senza parametri');
  return ars;
}

/** Costruisce una funzione JavaScript a partire dalle arità. */
function makeFn(arities, scope, name, defs) {
  const fn = function (...args) {
    const a = arities.find(x => x.rest ? args.length >= x.params.length : x.params.length === args.length);
    if (!a) throw new CLJSError('#ARITY: «' + name + '» chiamata con ' + args.length + ' argomenti');
    const s = makeScope(scope, null);
    a.params.forEach((p, i) => s.vars.set(p, args[i]));
    if (a.rest) s.vars.set(a.rest, args.slice(a.params.length));
    return evalBody(a.body, s, defs);
  };
  fn.cljsName = name;
  return fn;
}

function makeScope(parent, initial) {
  return {
    vars: new Map(initial ? Object.entries(initial) : []),
    parent,
    registry: parent ? parent.registry : new Map(),
  };
}

/**
 * Definisce una var nello scope, esponendo anche l'alias "munged" del nome
 * (`con-iva` → `con_iva`, `pronto?` → `pronto_QMARK_`) così da poter essere
 * usato sia dal codice ClojureScript sia dalle formule del foglio.
 */
function defineVar(scope, name, value) {
  scope.vars.set(name, value);
  const m = munge(name);
  if (m !== name) scope.vars.set(m, value);
  return value;
}

/** Inserisce il valore della forma precedente come primo/ultimo argomento. */
function threadStep(v, step, scope, defs, last) {
  if (step instanceof ListF) {
    const args = [step.items[0], ...step.items.slice(1)];
    args.splice(last ? args.length : 1, 0, v);
    return evalForm(new ListF(args), scope, defs);
  }
  return evalForm(new ListF([step, v]), scope, defs);
}

/** Forme speciali (dispacciate per nome). */
const SPECIALS = {
  quote: it => data(it[1]),
  def: (it, scope, defs) => { const n = symName(it[1]); const v = it.length > 2 ? evalForm(it[2], scope, defs) : null; defineVar(scope, n, v); defs.add(n); return v; },
  defonce: (it, scope, defs) => { const n = symName(it[1]); if (scope.vars.has(n)) return scope.vars.get(n); const v = it.length > 2 ? evalForm(it[2], scope, defs) : null; defineVar(scope, n, v); defs.add(n); return v; },
  defn: (it, scope, defs) => { const n = symName(it[1]); const fn = makeFn(parseArities(it, 2), scope, n, defs); defineVar(scope, n, fn); defs.add(n); return fn; },
  fn: (it, scope, defs) => { let i = 1; if (it[i] instanceof Sym) i++; return makeFn(parseArities(it, i), scope, 'fn', defs); },
  let: (it, scope, defs) => {
    const binds = it[1];
    if (!(binds instanceof Vec)) throw new CLJSError('«let» richiede un vettore di associazioni');
    const s = makeScope(scope, null);
    for (let i = 0; i + 1 < binds.items.length; i += 2) s.vars.set(symName(binds.items[i]), evalForm(binds.items[i + 1], s, defs));
    return evalBody(it.slice(2), s, defs);
  },
  if: (it, scope, defs) => truthy(evalForm(it[1], scope, defs)) ? evalForm(it[2], scope, defs) : (it.length > 3 ? evalForm(it[3], scope, defs) : null),
  when: (it, scope, defs) => truthy(evalForm(it[1], scope, defs)) ? evalBody(it.slice(2), scope, defs) : null,
  'when-not': (it, scope, defs) => truthy(evalForm(it[1], scope, defs)) ? null : evalBody(it.slice(2), scope, defs),
  cond: (it, scope, defs) => {
    for (let i = 1; i + 1 < it.length; i += 2) {
      const t = it[i], els = (t instanceof Sym && t.name === 'else') || (t instanceof Kw && t.name === 'else');
      if (els || truthy(evalForm(t, scope, defs))) return evalForm(it[i + 1], scope, defs);
    }
    return null;
  },
  and: (it, scope, defs) => { let v = true; for (const x of it.slice(1)) { v = evalForm(x, scope, defs); if (!truthy(v)) return v; } return v; },
  or: (it, scope, defs) => { for (const x of it.slice(1)) { const v = evalForm(x, scope, defs); if (truthy(v)) return v; } return null; },
  do: (it, scope, defs) => evalBody(it.slice(1), scope, defs),
  '->': (it, scope, defs) => { let v = evalForm(it[1], scope, defs); for (const s of it.slice(2)) v = threadStep(v, s, scope, defs, false); return v; },
  '->>': (it, scope, defs) => { let v = evalForm(it[1], scope, defs); for (const s of it.slice(2)) v = threadStep(v, s, scope, defs, true); return v; },
  ns: (it, scope) => { const name = it[1] instanceof Sym ? it[1].name : USER_NS; scope.registry.set(name, scope.vars); return null; },
  comment: () => null,
};

/**
 * Funzioni di base del sottoinsieme ClojureScript (aritmetica, collezioni,
 * stringhe, matematica), il namespace implicito `cljs.core`. Le funzioni del
 * foglio (SUM, AVG, …) sono invece definite in ClojureScript dal sorgente
 * `SHEET_CORE_SOURCE` nel namespace `sheet.core`.
 * @returns {object}
 */
export function coreBuiltins() {
  const B = Object.create(null);
  const chain = (xs, cmp) => { for (let i = 1; i < xs.length; i++) if (!cmp(xs[i - 1], xs[i])) return false; return true; };
  const coll = x => Array.isArray(x) ? x : x == null ? [] : Array.from(x);
  const size = x => x == null ? 0 : Array.isArray(x) || typeof x === 'string' ? x.length : typeof x === 'object' ? Object.keys(x).length : 0;
  const num = (...a) => a.flat(Infinity).filter(v => typeof v === 'number');
  Object.assign(B, {
    '+': (...xs) => xs.reduce((a, b) => a + b, 0),
    '-': (...xs) => xs.length === 1 ? -xs[0] : xs.slice(1).reduce((a, b) => a - b, xs[0]),
    '*': (...xs) => xs.reduce((a, b) => a * b, 1),
    '/': (...xs) => xs.length === 1 ? 1 / xs[0] : xs.slice(1).reduce((a, b) => a / b, xs[0]),
    'mod': (a, b) => ((a % b) + b) % b,
    'rem': (a, b) => a % b,
    'inc': x => x + 1,
    'dec': x => x - 1,
    'min': (...a) => Math.min(...num(a)),
    'max': (...a) => Math.max(...num(a)),
    '=': (...xs) => xs.every(x => equals(x, xs[0])),
    'not=': (...xs) => !xs.every(x => equals(x, xs[0])),
    '<': (...xs) => chain(xs, (a, b) => a < b),
    '<=': (...xs) => chain(xs, (a, b) => a <= b),
    '>': (...xs) => chain(xs, (a, b) => a > b),
    '>=': (...xs) => chain(xs, (a, b) => a >= b),
    'not': x => !truthy(x),
    'nil?': x => x == null,
    'some?': x => x != null,
    'true?': x => x === true,
    'false?': x => x === false,
    'number?': x => typeof x === 'number',
    'string?': x => typeof x === 'string',
    'boolean?': x => typeof x === 'boolean',
    'fn?': x => typeof x === 'function',
    'vector?': x => Array.isArray(x),
    'map?': x => !!x && typeof x === 'object' && !Array.isArray(x),
    'empty?': x => size(x) === 0,
    'zero?': x => x === 0,
    'pos?': x => x > 0,
    'neg?': x => x < 0,
    'even?': x => x % 2 === 0,
    'odd?': x => Math.abs(x % 2) === 1,
    'str': (...xs) => xs.map(s => s == null ? '' : Array.isArray(s) ? s.join(' ') : String(s)).join(''),
    'count': size,
    'get': (m, k, d = null) => { const v = m == null ? undefined : Array.isArray(m) ? m[k] : m[String(k)]; return v === undefined ? d : v; },
    'nth': (c, i, d) => { if (c == null || i < 0 || i >= size(c)) { if (d !== undefined) return d; throw new CLJSError('#INDEX: indice ' + i + ' fuori intervallo'); } return c[i]; },
    'first': c => c == null || !size(c) ? null : c[0],
    'second': c => c == null || size(c) < 2 ? null : c[1],
    'last': c => c == null || !size(c) ? null : c[size(c) - 1],
    'rest': c => c == null ? [] : Array.prototype.slice.call(c, 1),
    'next': c => { const r = c == null ? [] : Array.prototype.slice.call(c, 1); return r.length ? r : null; },
    'vec': c => coll(c).slice(),
    'vector': (...xs) => xs,
    'list': (...xs) => xs,
    'hash-map': (...xs) => { const o = {}; for (let i = 0; i + 1 < xs.length; i += 2) o[String(xs[i])] = xs[i + 1]; return o; },
    'conj': (c, ...xs) => { if (c == null) return xs; if (Array.isArray(c)) return [...c, ...xs]; const o = { ...c }; xs.forEach(x => Object.entries(x || {}).forEach(([k, v]) => { o[k] = v; })); return o; },
    'assoc': (m, ...kvs) => { const o = { ...(m || {}) }; for (let i = 0; i + 1 < kvs.length; i += 2) o[String(kvs[i])] = kvs[i + 1]; return o; },
    'dissoc': (m, ...ks) => { const o = { ...(m || {}) }; ks.forEach(k => delete o[String(k)]); return o; },
    'merge': (...ms) => Object.assign({}, ...ms.filter(Boolean)),
    'keys': m => Object.keys(m || {}),
    'vals': m => Object.values(m || {}),
    'contains?': (c, k) => c == null ? false : Array.isArray(c) ? k >= 0 && k < c.length : Object.prototype.hasOwnProperty.call(c, String(k)),
    'into': (to, from) => Array.isArray(to) ? [...to, ...coll(from)] : Object.assign({}, to, from),
    'concat': (...cs) => cs.reduce((a, c) => a.concat(coll(c)), []),
    'flatten': c => coll(c).flat(Infinity),
    'map': (f, ...cs) => {
      if (!cs.length) return [];
      if (cs.length === 1) return coll(cs[0]).map(x => f(x));
      const n = Math.min(...cs.map(c => size(c)));
      return Array.from({ length: n }, (_, i) => f(...cs.map(c => c[i])));
    },
    'filter': (f, c) => coll(c).filter(x => truthy(f(x))),
    'remove': (f, c) => coll(c).filter(x => !truthy(f(x))),
    'reduce': (f, a, b) => b === undefined ? coll(a).reduce((x, y) => f(x, y)) : coll(b).reduce((x, y) => f(x, y), a),
    'apply': (f, ...rest) => { const last = rest.pop(); return f(...rest, ...coll(last)); },
    'range': (a, b, step) => {
      if (b === undefined) { b = a ?? 0; a = 0; }
      const st = step || 1, out = [];
      if (st > 0) for (let v = a; v < b; v += st) out.push(v);
      else for (let v = a; v > b; v += st) out.push(v);
      return out;
    },
    'sort': c => coll(c).slice().sort((x, y) => x < y ? -1 : x > y ? 1 : 0),
    'sort-by': (f, c) => coll(c).slice().sort((x, y) => { const a = f(x), b = f(y); return a < b ? -1 : a > b ? 1 : 0; }),
    'reverse': c => coll(c).slice().reverse(),
    'take': (n, c) => coll(c).slice(0, Math.max(0, n)),
    'drop': (n, c) => coll(c).slice(Math.max(0, n)),
    'some': (f, c) => { for (const x of coll(c)) { const v = f(x); if (truthy(v)) return v; } return null; },
    'every?': (f, c) => coll(c).every(x => truthy(f(x))),
    'upper-case': s => String(s).toUpperCase(),
    'lower-case': s => String(s).toLowerCase(),
    'trim': s => String(s).trim(),
    'subs': (s, a, b) => String(s).slice(a, b),
    'split': (s, re) => String(s).split(re),
    'join': (sep, c) => coll(c).join(sep),
    'replace': (s, a, b) => String(s).split(a).join(b),
    'abs': Math.abs, 'sqrt': Math.sqrt, 'pow': Math.pow, 'floor': Math.floor, 'ceil': Math.ceil,
    'round': Math.round, 'trunc': Math.trunc, 'exp': Math.exp, 'log': Math.log, 'log10': Math.log10,
    'sin': Math.sin, 'cos': Math.cos, 'tan': Math.tan,
    'asin': Math.asin, 'acos': Math.acos, 'atan': Math.atan, 'atan2': Math.atan2,
    'sign': Math.sign, 'cbrt': Math.cbrt, 'hypot': Math.hypot, 'log2': Math.log2, 'random': Math.random,
    'PI': Math.PI, 'E': Math.E,
    'println': () => null, 'prn': () => null, 'print': () => null,
  });
  return B;
}


/* ===== Namespace del foglio ===== */

/** Namespace in cui sono definite le funzioni del foglio (SUM, AVG, …). */
export const SHEET_CORE_NS = 'sheet.core';
/** Namespace in cui è definito il codice dell'utente (visibile nelle celle). */
export const USER_NS = 'user';

/**
 * Le funzioni del foglio sono scritte in ClojureScript e definite nel namespace
 * `sheet.core`: usano solo le primitive del sottoconjunto (più i riferimenti a
 * `$`/`$$` forniti dal motore). Le celle vedono `sheet.core` e `user` senza
 * prefisso, quindi `SUM`, `AVG`, … funzionano direttamente.
 */
export const SHEET_CORE_SOURCE = `(ns sheet.core)

; Le funzioni del foglio ricevono scalari oppure matrici (vettori di righe):
; appiattiscono sempre gli argomenti con (flatten …) e tengono solo i numeri.

(defn SUM [& xs] (reduce + 0 (filter number? (flatten xs))))

(defn COUNT [& xs] (count (filter number? (flatten xs))))

(defn MIN [& xs] (apply min (filter number? (flatten xs))))

(defn MAX [& xs] (apply max (filter number? (flatten xs))))

(defn AVG [& xs]
  (let [n (filter number? (flatten xs))]
    (if (empty? n) 0 (/ (reduce + 0 n) (count n)))))

(def AVERAGE AVG)

(defn ROUND
  ([x] (ROUND x 0))
  ([x d] (let [p (pow 10 d)] (/ (round (* x p)) p))))

(defn IF [c a b] (if c a b))
`;

/** Scope di un namespace: le sue var sono registrate col nome del namespace. */
function makeNsScope(name, parent) {
  const s = makeScope(parent, null);
  s.registry.set(name, s.vars);
  return s;
}

/** Scope del namespace `sheet.core` (funzioni del foglio). */
function makeSheetCoreScope(extra) {
  const base = makeScope(null, Object.assign(Object.create(null), coreBuiltins(), extra || {}));
  const sheetCore = makeNsScope(SHEET_CORE_NS, base);
  const defs = new Set();
  for (const f of readForms(SHEET_CORE_SOURCE)) evalForm(f, sheetCore, defs);
  return sheetCore;
}

/** Scope del programma utente: `user` che vede `sheet.core` e `cljs.core`. */
function makeProgramScope(extra) {
  return makeNsScope(USER_NS, makeSheetCoreScope(extra));
}

/**
 * Tutte le variabili visibili in uno scope (attraversando la catena dei
 * namespace), con l'aggiunta dell'alias "munged" dei nomi con trattino/`?`/`!`.
 * @param {object} scope
 * @returns {object}
 */
export function visibleVars(scope) {
  const chain = [];
  for (let s = scope; s; s = s.parent) chain.push(s);
  const out = Object.create(null);
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [name, value] of chain[i].vars) {
      out[name] = value;
      const m = munge(name);
      if (m !== name) out[m] = value;
    }
  }
  return out;
}

/**
 * Funzioni del foglio (namespace `sheet.core`) come oggetto piatto: usato dal
 * percorso JavaScript delle formule e dai test.
 * @param {object} [extra]
 * @returns {object}
 */
export function sheetCoreVars(extra = null) { return visibleVars(makeSheetCoreScope(extra)); }


/* ===== API ===== */

/**
 * Interpreta un programma ClojureScript.
 * @param {string} code sorgente utente
 * @param {object} [extra] funzioni aggiuntive (es. le funzioni del foglio)
 * @param {object} [root] scope di primo livello da riusare (valutazioni
 *   incrementali: le ridefinizioni restano visibili alle funzioni già create).
 *   Se assente ne viene creato uno nuovo a partire da `extra`.
 * @returns {{error:CLJSError|null, value:*, defs:object, scope:object}}
 *   `defs` contiene i nomi definiti dall'utente (anche nella forma "munged").
 */
export function interpret(code, extra = null, root = null) {
  const defs = new Set();
  const scope = root || makeProgramScope(extra);
  let error = null, value = null;
  try {
    for (const f of readForms(code)) value = evalForm(f, scope, defs);
  } catch (e) {
    error = e instanceof CLJSError ? e : new CLJSError(e && e.message ? e.message : String(e), 0);
  }
  const userDefs = {};
  for (const n of defs) {
    const v = scope.vars.get(n);
    userDefs[n] = v;
    const m = munge(n);
    if (m !== n && !(m in userDefs)) userDefs[m] = v;
  }
  return { error, value, defs: userDefs, scope, vars: visibleVars(scope) };
}

/**
 * Valuta del codice in uno scope già costruito, senza riesaminarne le
 * definizioni: usato dal motore per le formule scritte in ClojureScript.
 * @param {object} scope
 * @param {string} code
 * @returns {*} valore dell'ultima forma (lancia `CLJSError` in caso di errore)
 */
export function evaluateIn(scope, code) {
  let value = null;
  const defs = new Set();
  for (const f of readForms(code)) value = evalForm(f, scope, defs);
  return value;
}

/**
 * Valuta un programma e restituisce il valore dell'ultima forma.
 * @param {string} code
 * @param {object} [extra]
 * @returns {*} valore (lancia `CLJSError` in caso di errore)
 */
export function evaluate(code, extra = null) {
  const r = interpret(code, extra);
  if (r.error) throw r.error;
  return r.value;
}

/**
 * Elenca le dichiarazioni di primo livello (`def`, `defonce`, `defn`) presenti
 * nel codice, tollerando eventuali errori di lettura (utile per l'editor).
 * @param {string} code
 * @returns {{n:string,d:string,f:boolean,u:boolean}[]}
 */
export function declarations(code) {
  let forms;
  try { forms = readForms(code); } catch { return []; }
  const out = [];
  for (const f of forms) {
    if (!(f instanceof ListF) || !(f.items[0] instanceof Sym)) continue;
    const head = f.items[0].name;
    const name = f.items[1] instanceof Sym ? f.items[1].name : null;
    if (!name) continue;
    if (head === 'def' || head === 'defonce') out.push({ n: name, d: 'valore', f: false, u: true });
    else if (head === 'defn' || head === 'defn-') out.push({ n: name, d: paramsSummary(f.items, 2), f: true, u: true });
  }
  return out;
}

/** Riepilogo leggibile dei parametri di un `defn` (singola o più arità). */
function paramsSummary(items, start) {
  const one = v => '[' + v.items.map(x => (x instanceof Sym ? x.name : '?')).join(' ') + ']';
  let i = start;
  if (typeof items[i] === 'string') i++;
  if (items[i] instanceof Vec) return one(items[i]);
  return items.slice(i).filter(x => x instanceof ListF && x.items[0] instanceof Vec).map(x => one(x.items[0])).join(' ');
}

