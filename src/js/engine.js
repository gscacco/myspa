/**
 * engine.js — Valutazione delle formule, grafo delle dipendenze e ricalcolo.
 *
 * Modulo senza DOM: può essere usato da Node senza interfaccia utente. Non
 * tocca il rendering; `recalculate()` restituisce l'elenco dei nodi cambiati
 * perché la vista decida cosa ridisegnare.
 *
 * Le dipendenze sono "dinamiche": vengono scoperte durante la valutazione,
 * quando una formula legge altre celle tramite `$` / `$$`.
 *
 * Le forme ClojureScript sono valutate da Scittle/SCI:
 *  - `(pippo A2)` è una forma ClojureScript, senza prefisso `=`;
 *  - `:keyword`, `[1 2 3]` e `{:key 12}` sono valori ClojureScript;
 *  - `pippo(A2)` è zucchero sintattico per `(pippo A2)`;
 *  - i riferimenti `A1`, `A1:B5`, `Foglio2!B3` sono risolti verso `$` / `$$`.
 * Le definizioni del namespace `user` (il codice dell'utente) e quelle del
 * namespace `sheet.core` (le funzioni del foglio, SUM/AVG/…) sono visibili
 * senza prefisso. Le formule infisse di tipo JavaScript (`=B2*C2`) restano
 * supportate come percorso di compatibilità.
 */

import { colName, colIndex, addr, parseRef, mapRefs } from './references.js';
import { sheetByName, setRaw } from './model.js';
import { declarations, munge } from './cljs.js';
import {
  ensureSheetCore, enterUserNamespace, evaluateInNamespace,
  getNamespaceValue, getNamespaceCallable, scittleEval, withCellBridge, qualifyUserRefs,
} from './scittle-runtime.js';

let nextEngineId = 1;
const SHEET_VARS = ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG', 'AVERAGE', 'ROUND', 'IF', '$', '$$'];
const CORE_VARS = [
  '+', '-', '*', '/', 'mod', 'rem', 'inc', 'dec', 'min', 'max', '=', 'not=', '<', '<=', '>', '>=',
  'not', 'nil?', 'some?', 'number?', 'string?', 'boolean?', 'fn?', 'vector?', 'map?', 'empty?', 'zero?',
  'pos?', 'neg?', 'even?', 'odd?', 'str', 'count', 'get', 'nth', 'first', 'second', 'last', 'rest', 'next',
  'vec', 'vector', 'list', 'hash-map', 'conj', 'assoc', 'dissoc', 'merge', 'keys', 'vals', 'contains?',
  'into', 'concat', 'flatten', 'map', 'filter', 'remove', 'reduce', 'apply', 'range', 'sort', 'sort-by',
  'reverse', 'take', 'drop', 'some', 'every?', 'upper-case', 'lower-case', 'trim', 'subs', 'split', 'join',
  'replace', 'abs', 'sqrt', 'pow', 'floor', 'ceil', 'round', 'trunc', 'exp', 'log', 'log10', 'sin', 'cos',
  'tan', 'asin', 'acos', 'atan', 'atan2', 'sign', 'cbrt', 'hypot', 'log2', 'random', 'PI', 'E',
];

/** Funzioni del namespace `sheet.core`, restituite come oggetto per formule JS. */
export function buildBuiltins() {
  ensureSheetCore();
  const fields = SHEET_VARS.filter(name => name !== '$' && name !== '$$').map(name => `"${name}" ${name}`).join(' ');
  const builtins = scittleEval(`(ns sheet.core) (clj->js {${fields} "PI" js/Math.PI "E" js/Math.E})`);
  for (const name of SHEET_VARS.filter(name => name !== '$' && name !== '$$')) builtins[name] = getNamespaceCallable('sheet.core', name);
  return builtins;
}

function toError(error, source = '') {
  let message = error?.message || String(error);
  const unresolved = /(?:Could not|Unable to) resolve symbol:?\s*([^\s,]+)/i.exec(message);
  if (unresolved) message = '#NAME: simbolo non definito «' + unresolved[1].replace(/["']/g, '') + '»';
  const result = error instanceof Error ? error : new Error(message);
  result.message = message;
  if (!Number.isInteger(result.line)) {
    const line = /(?:line|riga)\s+(\d+)/i.exec(message);
    if (line) result.line = Math.max(1, Number(line[1]) - (source.startsWith('(ns ') ? 1 : 0));
  }
  return result;
}

/**
 * Crea un motore di calcolo per un workbook.
 *
 * @param {object} workbook
 */
export function createEngine(workbook) {
  let wb = workbook;
  ensureSheetCore();
  const engineId = nextEngineId++;
  let userNsVersion = 0;
  let userNs = `foglio.user${engineId}_v${++userNsVersion}`;
  let userNames = [];
  let envNames = makeEnvNames();
  let ENV = makeEnvironment();          // nomi CLJS risolti dal percorso delle formule JS
  let ctx = null;                       // nodo in corso di valutazione
  const nodes = new Map();              // id "Foglio!A1" -> nodo
  const changed = new Set();            // nodi da ridisegnare

  const nodeId = (sheetName, a) => sheetName + '!' + a;

  /** Nodo del grafo per un id, creato (e collegato al valore grezzo) al bisogno. */
  function nd(id) {
    let n = nodes.get(id);
    if (!n) {
      const [sh, a] = id.split('!');
      const s = sheetByName(wb, sh);
      if (!s) throw Error('#REF: foglio «' + sh + '» inesistente');
      n = { id, sh, a, deps: new Set(), rd: new Set(), st: 0, val: null, err: null, fn: null, cljs: null, raw: undefined };
      nodes.set(id, n);
      setNode(n, s.cells[a]?.r);
    }
    return n;
  }

  /**
   * (Ri)compila il valore grezzo di un nodo. Le forme ClojureScript vengono
   * valutate senza `=`; il prefisso resta supportato per formule infisse.
   */
  function setNode(n, raw) {
    n.deps.forEach(d => d.rd.delete(n));
    n.deps.clear();
    n.raw = raw; n.fn = null; n.cljs = null; n.err = null; n.st = 0; n.val = null;
    if (typeof raw === 'string') {
      try {
        const hasPrefix = raw[0] === '=';
        const body = hasPrefix ? raw.slice(1) : raw;
        const cljs = toCljsSource(body) ?? (!hasPrefix ? implicitCljsSource(body, ENV) : null);
        if (cljs != null) {
          const src = mapRefs(cljs, x => x.b
            ? `($$ "${x.sh || n.sh}!${x.c}${x.r}:${x.b.c}${x.b.r}")`
            : `($ "${x.sh || n.sh}!${x.c}${x.r}")`);
          n.cljs = src;
          n.st = 1;
        } else if (hasPrefix) {
          const js = mapRefs(body, x => x.b
            ? `$$("${x.sh || n.sh}!${x.c}${x.r}:${x.b.c}${x.b.r}")`
            : `$("${x.sh || n.sh}!${x.c}${x.r}")`);
          n.fn = new Function('$', '$$', 'ENV', /\breturn\b|;/.test(js) ? 'with(ENV){' + js + '}' : 'with(ENV){return (' + js + ')}');
          n.st = 1;
        } else {
          n.val = raw;
        }
      } catch (e) { n.err = e; }
    } else n.val = raw === undefined ? null : raw;
  }

  /** Valuta un nodo in modo lazy, registrando la dipendenza dal nodo in corso. */
  function val(n) {
    if (ctx) { ctx.deps.add(n); n.rd.add(ctx); }
    if (n.st === 2) throw new Error('#CIRC: riferimento circolare');
    if (n.st === 1) ev(n);
    if (n.err) throw n.err;
    return n.val;
  }

  /** Esegue una formula di un nodo (ClojureScript oppure JavaScript). */
  function ev(n) {
    n.st = 2;
    n.deps.forEach(d => d.rd.delete(n));
    n.deps.clear();
    const p = ctx; ctx = n;
    try {
      const v = withCellBridge({ read: $, range: $$ }, () => n.cljs != null
        ? evaluateInNamespace(userNs, qualifyUserRefs(restoreMungedNames(n.cljs), userNs))
        : n.fn($, $$, ENV));
      n.val = v === undefined ? null : v; n.err = null;
    }
    catch (e) { n.err = toError(e, n.cljs || ''); n.val = null; }
    ctx = p; n.st = 0; changed.add(n);
  }

  /** Accesso a una cella: `$("Foglio!A1")`. */
  const $ = id => val(nd(id));

  /** Accesso a un intervallo come matrice: `$$("Foglio!A1:B5")`. */
  const $$ = rg => {
    const [sh, x] = rg.split('!');
    const [p, q] = x.split(':').map(parseRef);
    const out = [];
    for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) {
      const row = [];
      for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) row.push(val(nd(sh + '!' + addr(r, c))));
      out.push(row);
    }
    return out;
  };

  /** Crea un ENV JavaScript che espone le var ClojureScript del workbook. */
  function makeEnvironment() {
    return new Proxy(Object.create(null), {
      has(_target, key) { return typeof key === 'string' && envNames.has(key); },
      get(_target, key) {
        if (key === Symbol.unscopables) return undefined;
        if (typeof key !== 'string' || !envNames.has(key)) return undefined;
        try { return withCellBridge({ read: $, range: $$ }, () => getNamespaceValue(userNs, restoreMungedNames(key))); }
        catch { return undefined; }
      },
      ownKeys() { return [...envNames]; },
      getOwnPropertyDescriptor(_target, key) {
        return typeof key === 'string' && envNames.has(key) ? { configurable: true, enumerable: true } : undefined;
      },
    });
  }

  function refreshEnvironment(code) {
    envNames = makeEnvNames();
    userNames = declarations(code).map(({ n }) => n);
    for (const n of userNames) {
      envNames.add(n);
      envNames.add(munge(n));
    }
  }

  function makeEnvNames() {
    const names = new Set([...SHEET_VARS, ...CORE_VARS, 'true', 'false', 'nil']);
    for (const name of [...names]) names.add(munge(name));
    return names;
  }

  function restoreMungedNames(source) {
    let result = source;
    for (const name of envNames) {
      const original = [...envNames].find(candidate => candidate !== name && munge(candidate) === name);
      if (original) result = result.replace(new RegExp('(?<![\\w-])' + escapeRegExp(name) + '(?![\\w-])', 'g'), original);
    }
    return result;
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function freshUserNamespace() {
    userNs = `foglio.user${engineId}_v${++userNsVersion}`;
    enterUserNamespace(userNs);
  }

  function scopedCode(code) {
    const nsForm = `(ns ${userNs} (:require [sheet.core :refer :all]))`;
    const body = qualifyUserRefs(String(code || ''), userNs).replace(/\(\s*ns\s+user\s*\)/g, nsForm);
    return nsForm + '\n' + body;
  }

  // Namespace iniziale: il motore valuta formule anche prima di caricare codice utente.
  enterUserNamespace(userNs);

  /** Propaga lo stato "da ricalcolare" lungo il grafo. */
  function dd(n) { if (n.st === 1) return; if (n.fn || n.cljs) n.st = 1; n.rd.forEach(dd); }

  /**
   * Scrive un valore grezzo nel modello e aggiorna il grafo.
   * @returns {object} il nodo aggiornato
   */
  function put(sheetName, a, raw) {
    setRaw(wb, sheetName, a, raw);
    const n = nd(nodeId(sheetName, a));
    setNode(n, raw);
    n.rd.forEach(dd);
    if (!n.st) changed.add(n);
    return n;
  }

  /** Svuota il grafo (dopo un cambio di workbook). */
  function reset() { nodes.clear(); changed.clear(); }

  /** Ricrea i nodi per tutte le celle del workbook corrente. */
  function loadAll() {
    for (const s of wb.sheets) for (const a of Object.keys(s.cells)) nd(nodeId(s.name, a));
  }

  /**
   * Valuta i nodi marcati da ricalcolare.
   * @returns {object[]} nodi cambiati (per il ridisegno)
   */
  function recalculate() {
    for (const n of nodes.values()) if (n.st === 1) ev(n);
    const out = [...changed];
    changed.clear();
    return out;
  }

  /**
   * Imposta il codice utente nel namespace isolato del workbook e aggiorna
   * l'ambiente usato dalle formule infisse. In
   * caso di errore lo scope resta utilizzabile con le sole funzioni del foglio.
   * @returns {Error|null} errore di lettura/valutazione, oppure null
   */
  function setCode(code) {
    freshUserNamespace();
    refreshEnvironment(code || '');
    try {
      withCellBridge({ read: $, range: $$ }, () => scittleEval(scopedCode(code || '')));
      return null;
    } catch (error) {
      return toError(error, code || '');
    }
  }

  /**
   * Valuta una singola forma ClojureScript fondendone le definizioni
   * nell'ambiente corrente, senza toccare le altre (come `C-x C-e` di Emacs):
   * un `defn` ridefinisce la funzione, un `def` la costante. Lo scope di primo
   * livello viene riusato, quindi una costante ridefinita è vista anche dalle
   * funzioni definite in precedenza.
   * @param {string} code
   * @returns {{value:*, error:Error|null, defs:object}}
   */
  function evalForm(code) {
    try {
      let value = withCellBridge({ read: $, range: $$ }, () => evaluateInNamespace(userNs, scopedCode(restoreMungedNames(code))));
      const found = declarations(code);
      const definition = found[found.length - 1];
      const defs = {};
      if (definition) {
        value = withCellBridge({ read: $, range: $$ }, () => getNamespaceValue(userNs, definition.n));
        if (typeof value === 'function') value.cljsName = definition.n;
        defs[definition.n] = value;
        defs[munge(definition.n)] = value;
      }
      userNames.push(...found.map(x => x.n).filter(name => !userNames.includes(name)));
      refreshEnvironment(userNames.map(name => `(def ${name})`).join('\n'));
      return { value, error: null, defs };
    } catch (error) {
      return { value: null, error: toError(error, code), defs: {} };
    }
  }

  /** Marca tutte le formule come da ricalcolare. */
  function invalidateFormulas() { nodes.forEach(n => { if (n.fn || n.cljs) n.st = 1; }); }

  /** Cambia il workbook di riferimento (usato da apri/annulla/ripristina). */
  function setWorkbook(next) { wb = next; reset(); }

  /** Nodo esistente (senza crearlo) o `null`. */
  const getNode = id => nodes.get(id);

  /** Registra un nodo per il ridisegno (usato dopo la formattazione). */
  function touch(sheetName, a) { const n = nd(nodeId(sheetName, a)); changed.add(n); return n; }

  /** Valuta un id e ne restituisce il valore (utile nei test). */
  const evaluate = id => val(nd(id));

  return {
    get workbook() { return wb; },
    get ENV() { return ENV; },
    nodeId, nd, put, dd, reset, loadAll, recalculate, setCode, evalForm, invalidateFormulas,
    setWorkbook, getNode, touch, evaluate,
  };
}

// Riesportati per comodità di chi usa il motore insieme alle utilità sui riferimenti.
export { colName, colIndex };

/**
 * Recognize an explicit ClojureScript form, or normalize function-call
 * shorthand such as `name(args…)` to `(name args…)`.
 * @param {string} body raw cell text, optionally after a legacy `=` prefix
 * @returns {string|null} ClojureScript source, or `null`
 */
function toCljsSource(body) {
  const s = body.trim();
  if (['(', '[', '{', ':', '"', "'", '`', '\\'].includes(s[0])
    || s.startsWith('#{') || s.startsWith('#_')
    || /^(?:true|false|nil)$/.test(s)) return s;
  const m = /^([^\s()]+)\s*\(/.exec(s);
  if (!m) return null;
  const open = m[0].length - 1;
  if (closingParen(s, open) !== s.length - 1) return null;   // la chiamata non è tutta l'espressione
  return '(' + m[1] + ' ' + s.slice(open + 1, -1) + ')';
}

/** Recognize unambiguous CLJS atoms while leaving ordinary cell text intact. */
function implicitCljsSource(source, env) {
  const s = source.trim();
  if (['(', '[', '{', ':', '"', "'", '`', '\\'].includes(s[0])
    || s.startsWith('#{') || s.startsWith('#_')
    || /^(?:true|false|nil)$/.test(s)) return s;
  if (!/^[A-Za-z_*+!?<>=./-][\w*+!?<>=./-]*$/.test(s)) return null;
  const isCellRef = /^(?:[A-Za-z_]\w*!)?\$?[A-Z]{1,2}\$?\d+$/.test(s);
  return isCellRef || s.includes('/') || Object.prototype.hasOwnProperty.call(env, s) ? s : null;
}

/** Indice della `)` che chiude la `(` in posizione `open`, ignorando le stringhe. */
function closingParen(s, open) {
  let depth = 0, quote = '', esc = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

