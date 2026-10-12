/**
 * cljs.js — Lettore leggero usato solo dagli aiuti dell'editor.
 *
 * L'engine usa Scittle/SCI per la valutazione. Qui resta il lettore leggero
 * impiegato dagli aiuti dell'editor; le API compatibili in fondo al modulo
 * inoltrano l'esecuzione a Scittle e non contengono un valutatore locale.
 */

import { ensureSheetCore, scittleEval } from './scittle-runtime.js';

export class CLJSError extends Error {
  constructor(message, line = 0) {
    super(message);
    this.name = 'CLJSError';
    this.line = line | 0;
  }
}

class Sym { constructor(name, line) { this.name = name; this.line = line; } }
class ListF { constructor(items) { this.items = items; } }
class Vec { constructor(items) { this.items = items; } }
class MapF { constructor(items) { this.items = items; } }

const DISCARD = Symbol('discard');
const OPEN = '([{';
const CLOSE = ')]}';
const DELIM = new Set(['(', ')', '[', ']', '{', '}', '"', ';', ',', "'", '`']);
const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

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
  readTop() {
    const out = [];
    for (;;) {
      this.skipBlanks();
      if (this.atEnd()) return out;
      const form = this.readForm();
      if (form !== DISCARD) out.push(form);
    }
  }
  readForm() {
    this.skipBlanks();
    const line = this.line, c = this.peek();
    if (c === undefined) throw new CLJSError('fine dell’input inattesa', line);
    if (c === '(') { this.next(); return new ListF(this.readSeq(')', line)); }
    if (c === '[') { this.next(); return new Vec(this.readSeq(']', line)); }
    if (c === '{') { this.next(); return new MapF(this.readSeq('}', line)); }
    if (CLOSE.includes(c)) throw new CLJSError('chiusura «' + c + '» inattesa', line);
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
      if (CLOSE.includes(c)) throw new CLJSError('chiusura «' + c + '» inattesa', this.line);
      const form = this.readForm();
      if (form !== DISCARD) items.push(form);
    }
  }
  readDispatch(line) {
    this.next();
    const c = this.peek();
    if (c === '_') { this.next(); this.readForm(); return DISCARD; }
    if (c === '{') { this.next(); return new Vec(this.readSeq('}', line)); }
    if (c === '"') return this.readString();
    if (c === undefined) throw new CLJSError('lettore incompleto «#»', line);
    this.readToken(line); // tag del lettore, ad esempio js/inst/uuid; il contenuto resta da ispezionare.
    return this.readForm();
  }
  readString() {
    const line = this.line;
    this.next();
    let value = '';
    for (;;) {
      if (this.atEnd()) throw new CLJSError('stringa non chiusa', line);
      const c = this.next();
      if (c === '"') return value;
      if (c !== '\\') { value += c; continue; }
      const d = this.next();
      if (d === 'n') value += '\n';
      else if (d === 't') value += '\t';
      else if (d === 'r') value += '\r';
      else if (d === 'u') { value += String.fromCharCode(parseInt(this.src.substr(this.i, 4), 16)); this.i += 4; }
      else value += d;
    }
  }
  readToken(line) {
    let token = '';
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === undefined || isSpace(c) || DELIM.has(c)) break;
      token += this.next();
    }
    if (!token) throw new CLJSError('carattere inatteso «' + this.peek() + '»', line);
    return new Sym(token, line);
  }
}

/** Legge le forme per l'analisi dell'editor; non valuta il contenuto. */
export function readForms(code) { return new Reader(String(code ?? '')).readTop(); }

/** Diagnostica strutturale prudente, senza eseguire il codice dell'utente. */
export function readError(code) {
  try { readForms(code); return null; }
  catch (error) { return error instanceof CLJSError ? error : new CLJSError(String(error), 0); }
}

export function munge(name) {
  return String(name).replace(/-/g, '_').replace(/\?$/, '_QMARK_').replace(/!$/, '_BANG_').replace(/\*$/, '_STAR_');
}

export function declarations(code) {
  let forms;
  try { forms = readForms(code); } catch { return []; }
  const out = [];
  for (const form of forms) {
    if (!(form instanceof ListF) || !(form.items[0] instanceof Sym)) continue;
    const head = form.items[0].name;
    const name = form.items[1] instanceof Sym ? form.items[1].name : null;
    if (!name) continue;
    if (head === 'def' || head === 'defonce') out.push({ n: name, d: 'valore', f: false, u: true });
    else if (head === 'defn' || head === 'defn-') out.push({ n: name, d: paramsSummary(form.items, 2), f: true, u: true });
  }
  return out;
}

function paramsSummary(items, start) {
  const one = form => '[' + form.items.map(x => x instanceof Sym ? x.name : '?').join(' ') + ']';
  let i = start;
  if (typeof items[i] === 'string') i++;
  if (items[i] instanceof Vec) return one(items[i]);
  return items.slice(i).filter(x => x instanceof ListF && x.items[0] instanceof Vec).map(x => one(x.items[0])).join(' ');
}

// Queste API mantengono le utilità storiche del modulo, ma delegano tutta
// l'esecuzione a Scittle; non implementano un valutatore locale.
export const SHEET_CORE_NS = 'sheet.core';
export const USER_NS = 'user';

let compatId = 0;

function jsObjectIn(namespace, names) {
  const fields = names.map(name => `"${name}" ${name}`).join(' ');
  return scittleEval(`(ns ${namespace}) (clj->js {${fields}})`);
}

function jsCallable(namespace, name) {
  return (...args) => {
    const key = `__foglioCall${++compatId}`;
    globalThis[key] = { args };
    try {
      return scittleEval(`(clj->js (apply ${namespace}/${name} (js->clj (.-args js/globalThis.${key}))))`);
    } finally {
      delete globalThis[key];
    }
  };
}

export function coreBuiltins() {
  ensureSheetCore();
  const names = ['+', '-', '*', '/', 'mod', 'rem', 'inc', 'dec', 'min', 'max', '=', 'not=', '<', '<=', '>', '>=',
    'not', 'nil?', 'some?', 'number?', 'string?', 'boolean?', 'fn?', 'vector?', 'map?', 'empty?', 'zero?', 'pos?',
    'neg?', 'even?', 'odd?', 'str', 'count', 'get', 'nth', 'first', 'second', 'last', 'rest', 'next', 'vec',
    'vector', 'list', 'hash-map', 'conj', 'assoc', 'dissoc', 'merge', 'keys', 'vals', 'contains?', 'into', 'concat',
    'flatten', 'map', 'filter', 'remove', 'reduce', 'apply', 'range', 'sort', 'sort-by', 'reverse', 'take', 'drop',
    'some', 'every?'];
  const math = { abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    trunc: Math.trunc, exp: Math.exp, log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sign: Math.sign, cbrt: Math.cbrt,
    hypot: Math.hypot, log2: Math.log2, PI: Math.PI, E: Math.E };
  const builtins = Object.assign(jsObjectIn('cljs.user', names), math);
  // API storica del modulo: accetta array JS e restituisce un array JS.
  builtins.flatten = function flatten(values) {
    return values.flat(Infinity);
  };
  return builtins;
}

export function sheetCoreVars(extra = null) {
  ensureSheetCore();
  const names = ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG', 'AVERAGE', 'ROUND', 'IF'];
  const vars = Object.fromEntries(names.map(name => [name, jsCallable('sheet.core', name)]));
  return Object.assign(Object.create(null), vars, extra || {});
}

function unresolvedCallNames(code, extra) {
  const builtins = new Set([
    '+', '-', '*', '/', 'mod', 'rem', 'inc', 'dec', 'min', 'max', '=', 'not=', '<', '<=', '>', '>=',
    'not', 'nil?', 'some?', 'number?', 'string?', 'boolean?', 'fn?', 'vector?', 'map?', 'empty?', 'zero?',
    'pos?', 'neg?', 'even?', 'odd?', 'str', 'count', 'get', 'nth', 'first', 'second', 'last', 'rest', 'next',
    'vec', 'vector', 'list', 'hash-map', 'conj', 'assoc', 'dissoc', 'merge', 'keys', 'vals', 'contains?',
    'into', 'concat', 'flatten', 'map', 'filter', 'remove', 'reduce', 'apply', 'range', 'sort', 'sort-by',
    'reverse', 'take', 'drop', 'some', 'every?', 'upper-case', 'lower-case', 'trim', 'subs', 'split', 'join',
    'replace', 'abs', 'sqrt', 'pow', 'floor', 'ceil', 'round', 'trunc', 'exp', 'log', 'log10', 'sin', 'cos',
    'tan', 'asin', 'acos', 'atan', 'atan2', 'sign', 'cbrt', 'hypot', 'log2', 'random', 'PI', 'E',
    'def', 'defn', 'defn-', 'defonce', 'if', 'when', 'when-not', 'cond', 'case', 'let', 'loop', 'recur',
    'do', 'quote', 'comment', 'fn', 'and', 'or', '->', '->>', 'as->', 'throw', 'try', 'catch', 'finally',
    'new', '.', 'ns', 'in-ns', ...Object.keys(sheetCoreVars()), ...Object.keys(extra || {}),
  ]);
  let forms;
  try { forms = readForms(code); } catch { return []; }
  for (const declaration of declarations(code)) builtins.add(declaration.n);
  const locals = new Set();
  const collectLocals = form => {
    if (form instanceof Vec) for (const item of form.items) if (item instanceof Sym) locals.add(item.name);
    if (form instanceof ListF || form instanceof Vec || form instanceof MapF) {
      const items = form instanceof MapF ? form.items.flat() : form.items;
      items.forEach(collectLocals);
    }
  };
  forms.forEach(collectLocals);
  const missing = new Set();
  const walk = form => {
    if (form instanceof ListF) {
      const head = form.items[0];
      if (head instanceof Sym && !head.name.startsWith(':') && !builtins.has(head.name) && !locals.has(head.name) && !head.name.includes('/') && !head.name.startsWith('.')) {
        missing.add(head.name);
      }
      form.items.forEach(walk);
    } else if (form instanceof Vec || form instanceof MapF) {
      form.items.forEach(walk);
    }
  };
  forms.forEach(walk);
  return [...missing];
}

export function interpret(code, extra = null, root = null) {
  ensureSheetCore();
  const namespace = root?.namespace || `foglio.compat${++compatId}`;
  const extraKey = `__foglioCompat${compatId}`;
  if (extra) globalThis[extraKey] = extra;
  const sheetNames = Object.keys(sheetCoreVars()).filter(name => !Object.hasOwn(extra || {}, name));
  const referSheet = sheetNames.length ? `:refer [${sheetNames.join(' ')}]` : ':refer []';
  const requireSheet = `(ns ${namespace} (:require [sheet.core ${referSheet}]))`;
  let source = String(code ?? '').replace(/\(\s*ns\s+user\s*\)/g, '').replace(/\buser\//g, namespace + '/');
  const extraDefs = extra ? Object.keys(extra).map(name =>
    `(def ${name} (fn [& args] (.apply (.-${name} js/globalThis.${extraKey}) js/globalThis.${extraKey} (clj->js args))))`
  ).join('\n') : '';
  const unresolvedDefs = unresolvedCallNames(source, extra)
    .map(name => `(def ${name} (fn [& _args] (throw (js/Error. ${JSON.stringify('#NAME: simbolo non definito «' + name + '»')}))))`)
    .join('\n');
  let value = null, error = null;
  try {
    value = scittleEval(`${requireSheet}\n${extraDefs}\n${unresolvedDefs}\n(clj->js (do ${source}))`);
  } catch (caught) { error = caught; }

  const defs = Object.create(null), userVars = new Map();
  for (const { n } of declarations(source)) {
    try {
      const result = scittleEval(`${requireSheet}\n${n}`);
      const value = typeof result === 'function' ? jsCallable(namespace, n) : result;
      defs[n] = value;
      const alias = munge(n);
      defs[alias] = value;
      userVars.set(n, value);
      if (typeof value === 'function') value.cljsName = n;
    } catch { /* una definizione fallita resta segnalata in error */ }
  }
  const sheetVars = new Map(Object.entries(sheetCoreVars()));
  const registry = new Map([['user', userVars], ['sheet.core', sheetVars]]);
  const vars = Object.assign(Object.create(null), Object.fromEntries(sheetVars), defs, extra || {});
  const scope = root || { namespace, registry };
  scope.namespace = namespace;
  scope.registry = registry;
  return { error, value, defs, scope, vars };
}

export function evaluate(code, extra = null) {
  // Mantiene l'accettazione storica di una collezione singola per min/max.
  const normalized = String(code ?? '').replace(/\((min|max)\s+(\[[^\[\]]*\])\)/g, '(apply $1 $2)');
  const result = interpret(normalized, extra);
  if (result.error) throw result.error;
  return result.value;
}

export function evaluateIn(scope, code) {
  const result = interpret(code, null, scope);
  if (result.error) throw result.error;
  return result.value;
}
