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
  evaluateInNamespaceWithRaw, getNamespaceValue, getNamespaceCallable, scittleEval, withCellBridge, qualifyUserRefs,
  invokeCljsHook,
} from './scittle-runtime.js';

let nextEngineId = 1;
const SHEET_VARS = ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG', 'AVERAGE', 'ROUND', 'IF', '$', '$$', 'style-range!', 'clear-range-style!'];
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
export function createEngine(workbook, { log = null, hooks = null, styleRange: applyStyleRange = null, setStatus = null } = {}) {
  let wb = workbook;
  const report = (level, message, metadata) => {
    try { if (typeof log === 'function') log(level, message, metadata); }
    catch { /* Diagnostics must not alter evaluation behavior. */ }
  };
  const reportedErrors = new WeakSet();
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
  const pendingSourceChanges = new Map();
  const pendingCellErrors = [];

  const nodeId = (sheetName, a) => sheetName + '!' + a;

  function queueCellError(n, error) {
    const errorInfo = {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || 'Cell evaluation failed'),
    };
    if (Number.isInteger(error?.line)) errorInfo.line = error.line;
    if (typeof error?.stack === 'string' && error.stack) errorInfo.stack = error.stack.slice(0, 8000);
    pendingCellErrors.push({
      node: n,
      error,
      event: 'on-cell-evaluation-error',
      data: {
        cell: n.id,
        ...(typeof n.raw === 'string' ? { expression: n.raw } : {}),
        error: errorInfo,
      },
    });
  }

  /** Compare evaluated values with ClojureScript equality on the original SCI values. */
  function cljsEquals(left, right) {
    if (left === right) return true;
    if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false;
    const key = `__foglioCellEquality${engineId}`;
    globalThis[key] = { left, right };
    try {
      return !!evaluateInNamespace(userNs,
        `(= (.-left js/globalThis.${key}) (.-right js/globalThis.${key}))`);
    } catch {
      return Object.is(left, right);
    } finally {
      delete globalThis[key];
    }
  }

  function dispatchHook(eventName, data, cljsValues = null, source = 'cell') {
    if (!hooks) return 0;
    const payload = { event: eventName, timestamp: new Date().toISOString(), source, data };
    return hooks.run(eventName, payload,
      (callback, value) => withCellBridge(cellBridge(), () => invokeCljsHook(callback, value, cljsValues)),
      (error, context) => report('error', `Hook for :${context.event} failed: ${error?.message || String(error)}`, {
        category: 'hooks', source: { event: context.event },
        details: { hook: context.callback?.cljsName || context.callback?.name || 'anonymous' }, exception: error,
      }));
  }

  /** Deliver accumulated cell events only after the current recalculation settles. */
  function settleCellEvents() {
    const events = [];
    const observeValues = typeof hooks?.list === 'function' && hooks.list('on-cell-value-change').length > 0;
    for (const [id, change] of pendingSourceChanges) {
      if (!Object.is(change.oldSource, change.newSource)) {
        events.push({
          event: 'on-cell-source-change',
          data: { cell: id, 'old-source': null, 'new-source': null },
          cljsValues: { 'old-source': change.oldSource ?? null, 'new-source': change.newSource ?? null },
        });
      }
    }
    pendingSourceChanges.clear();
    events.push(...pendingCellErrors.splice(0)
      .filter(item => item.node.err === item.error && item.node.errorOrigin === item.node)
      .map(({ event, data }) => ({ event, data })));

    for (const n of changed) {
      if (n.err || (n.raw === undefined && !n.hasSuccessfulValue)) continue;
      const hasPrevious = n.hasSuccessfulValue;
      const nextValue = n.cljVal;
      if (observeValues && (!hasPrevious || !cljsEquals(n.lastSuccessfulCljVal, nextValue))) {
        events.push({
          event: 'on-cell-value-change',
          data: {
            cell: n.id,
            'previous-value-available?': hasPrevious,
            ...(hasPrevious ? { 'old-value': null } : {}),
            'new-value': null,
          },
          cljsValues: {
            ...(hasPrevious ? { 'old-value': n.lastSuccessfulCljVal } : {}),
            'new-value': nextValue,
          },
        });
      }
      n.lastSuccessfulCljVal = nextValue;
      n.hasSuccessfulValue = true;
    }

    for (const item of events) dispatchHook(item.event, item.data, item.cljsValues || null);
  }

  /** Nodo del grafo per un id, creato (e collegato al valore grezzo) al bisogno. */
  function nd(id) {
    let n = nodes.get(id);
    if (!n) {
      const [sh, a] = id.split('!');
      const s = sheetByName(wb, sh);
      if (!s) throw Error('#REF: foglio «' + sh + '» inesistente');
      n = { id, sh, a, deps: new Set(), rd: new Set(), st: 0, val: null, cljVal: null, display: null, err: null, fn: null, cljs: null, raw: undefined, lastLoggedError: null, loggedMessages: new Set(), errorOrigin: null, propagatedError: null, hasSuccessfulValue: false, lastSuccessfulCljVal: undefined };
      nodes.set(id, n);
      setNode(n, s.cells[a]?.r);
      if (!n.err && n.st === 0 && n.raw !== undefined) {
        n.lastSuccessfulCljVal = n.cljVal;
        n.hasSuccessfulValue = true;
      }
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
    n.raw = raw; n.fn = null; n.cljs = null; n.err = null; n.st = 0; n.val = null; n.cljVal = raw === undefined ? null : raw; n.display = null; n.lastLoggedError = null; n.loggedMessages.clear(); n.errorOrigin = null; n.propagatedError = null;
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
      } catch (e) {
        n.err = toError(e, String(raw));
        n.errorOrigin = n;
        queueCellError(n, n.err);
        n.lastLoggedError = `${n.err.name}:${n.err.message}`;
        report('error', n.err.message, {
          category: 'exec', source: { cell: `${n.sh}!${n.a}` }, details: { expression: String(raw) }, exception: n.err,
        });
        reportedErrors.add(n.err);
      }
    } else n.val = raw === undefined ? null : raw;
  }

  /** Valuta un nodo in modo lazy, registrando la dipendenza dal nodo in corso. */
  function val(n) {
    if (ctx) { ctx.deps.add(n); n.rd.add(ctx); }
    if (n.st === 2) throw new Error('#CIRC: riferimento circolare');
    if (n.st === 1) ev(n);
    if (n.err) {
      if (ctx && ctx !== n) ctx.propagatedError = n.errorOrigin || n;
      throw n.err;
    }
    return n.val;
  }

  /** Esegue una formula di un nodo (ClojureScript oppure JavaScript). */
  function ev(n) {
    n.st = 2;
    n.deps.forEach(d => d.rd.delete(n));
    n.deps.clear();
    n.propagatedError = null;
    const p = ctx; ctx = n;
    try {
      const result = withCellBridge(cellBridge(), () => n.cljs != null
        ? { cljs: true, ...evaluateInNamespaceWithRaw(userNs, qualifyUserRefs(restoreMungedNames(n.cljs), userNs)) }
        : { cljs: false, value: n.fn($, $$, ENV) });
      n.val = result.value === undefined ? null : result.value;
      n.cljVal = result.cljs ? result.raw : n.val;
      n.display = result.cljs ? result.display : null;
      n.err = null;
      n.lastLoggedError = null;
      n.errorOrigin = null;
    }
    catch (e) {
      n.err = toError(e, n.cljs || '');
      n.val = null; n.cljVal = null; n.display = null;
      const signature = `${n.err.name}:${n.err.message}`;
      const propagatedFrom = n.propagatedError;
      if (!propagatedFrom) queueCellError(n, n.err);
      if (!propagatedFrom && !reportedErrors.has(n.err) && n.lastLoggedError !== signature) {
        report('error', n.err.message, {
          category: 'exec', source: { cell: `${n.sh}!${n.a}` },
          details: { expression: typeof n.raw === 'string' ? n.raw : undefined }, exception: n.err,
        });
        reportedErrors.add(n.err);
        n.lastLoggedError = signature;
      }
      n.errorOrigin = propagatedFrom || n;
      n.propagatedError = null;
    }
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

  /** Lettura interna ClojureScript, che conserva keyword e collezioni. */
  const $clj = id => { const n = nd(id); val(n); return n.cljVal; };

  /** Intervallo interno ClojureScript come matrice di valori originali. */
  const $$clj = rg => {
    const [sh, x] = rg.split('!');
    const [p, q] = x.split(':').map(parseRef);
    const out = [];
    for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) {
      const row = [];
      for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) row.push($clj(sh + '!' + addr(r, c)));
      out.push(row);
    }
    return out;
  };

  const cellBridge = () => ({
    read: $, range: $$, readClj: $clj, rangeClj: $$clj,
    setStatus(message) {
      if (typeof setStatus !== 'function') return false;
      setStatus(String(message ?? ''));
      return true;
    },
    clearStatus() {
      if (typeof setStatus !== 'function') return false;
      setStatus('');
      return true;
    },
    styleRange(reference, style) {
      if (typeof applyStyleRange !== 'function') throw new Error('Cell styling is unavailable in this evaluation context');
      return applyStyleRange(reference, style, ctx?.sh);
    },
    addHook(event, callback) { return hooks?.add(event, callback) ?? false; },
    removeHook(event, callback) { return hooks?.remove(event, callback) ?? false; },
    clearHook(event) { return hooks?.clear(event) ?? 0; },
    listHooks(event) { return hooks?.list(event) ?? []; },
    runHook(event, payload = null) {
      if (!hooks) return 0;
      const eventName = String(event ?? '').replace(/^:/, '');
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
      const eventPayload = {
        event: eventName,
        timestamp: payload?.timestamp || new Date().toISOString(),
        source: payload?.source || 'manual',
        data,
      };
      return hooks.run(eventName, eventPayload,
        (callback, value) => withCellBridge(cellBridge(), () => invokeCljsHook(callback, value)),
        (error, context) => report('error', `Hook for :${context.event} failed: ${error?.message || String(error)}`, {
          category: 'hooks', source: { event: context.event },
          details: { hook: context.callback?.cljsName || context.callback?.name || 'anonymous' }, exception: error,
        }));
    },
    log(level, message, metadata) {
      const options = metadata && typeof metadata === 'object' ? metadata : {};
      const source = options.source ?? (ctx ? { cell: `${ctx.sh}!${ctx.a}` } : undefined);
      if (ctx) {
        const key = `${level}\u0000${options.category || 'exec'}\u0000${message}`;
        if (ctx.loggedMessages.has(key)) return;
        ctx.loggedMessages.add(key);
        if (ctx.loggedMessages.size > 32) ctx.loggedMessages.delete(ctx.loggedMessages.values().next().value);
      }
      report(level, message, {
        ...options,
        category: options.category || 'exec',
        ...(source ? { source } : {}),
      });
    },
  });

  /** Crea un ENV JavaScript che espone le var ClojureScript del workbook. */
  function makeEnvironment() {
    return new Proxy(Object.create(null), {
      has(_target, key) { return typeof key === 'string' && envNames.has(key); },
      get(_target, key) {
        if (key === Symbol.unscopables) return undefined;
        if (typeof key !== 'string' || !envNames.has(key)) return undefined;
        try { return withCellBridge(cellBridge(), () => getNamespaceValue(userNs, restoreMungedNames(key))); }
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
    const n = nd(nodeId(sheetName, a));
    const oldSource = n.raw;
    setRaw(wb, sheetName, a, raw);
    if (!Object.is(oldSource, raw)) {
      const pending = pendingSourceChanges.get(n.id);
      if (pending) pending.newSource = raw;
      else pendingSourceChanges.set(n.id, { oldSource, newSource: raw });
    }
    setNode(n, raw);
    n.rd.forEach(dd);
    if (!n.st) changed.add(n);
    return n;
  }

  /** Svuota il grafo (dopo un cambio di workbook). */
  function reset() {
    nodes.clear();
    changed.clear();
    pendingSourceChanges.clear();
    pendingCellErrors.length = 0;
  }

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
    settleCellEvents();
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
      withCellBridge(cellBridge(), () => scittleEval(scopedCode(code || '')));
      return null;
    } catch (error) {
      const normalized = toError(error, code || '');
      report('error', normalized.message, {
        category: 'exec', source: { operation: 'user-code' },
        details: { context: 'Applying the ClojureScript editor' }, exception: normalized,
      });
      return normalized;
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
      let value = withCellBridge(cellBridge(), () => evaluateInNamespace(userNs, scopedCode(restoreMungedNames(code))));
      const found = declarations(code);
      const definition = found[found.length - 1];
      const defs = {};
      if (definition) {
        value = withCellBridge(cellBridge(), () => getNamespaceValue(userNs, definition.n));
        if (typeof value === 'function') value.cljsName = definition.n;
        defs[definition.n] = value;
        defs[munge(definition.n)] = value;
      }
      userNames.push(...found.map(x => x.n).filter(name => !userNames.includes(name)));
      refreshEnvironment(userNames.map(name => `(def ${name})`).join('\n'));
      return { value, error: null, defs };
    } catch (error) {
      const normalized = toError(error, code);
      report('error', normalized.message, {
        category: 'exec', source: { operation: 'evaluate-form' },
        details: { expression: code }, exception: normalized,
      });
      return { value: null, error: normalized, defs: {} };
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
  const evaluate = id => {
    try { return val(nd(id)); }
    finally { settleCellEvents(); }
  };

  /**
   * Returns the evaluated SCI value for a populated cell without converting it
   * to JavaScript. `available` distinguishes an empty cell from an explicit nil.
   */
  function evaluatedCell(sheetName, a) {
    const sheet = sheetByName(wb, sheetName);
    if (!sheet) return { available: false, error: new Error('#REF: foglio «' + sheetName + '» inesistente') };
    if (!Object.hasOwn(sheet.cells, a) || sheet.cells[a]?.r === undefined) return { available: false };
    const n = nd(nodeId(sheetName, a));
    try {
      val(n);
      if (n.err) return { available: false, error: n.err };
      return { available: true, value: n.cljVal, display: n.display };
    } catch (error) {
      return { available: false, error };
    } finally {
      settleCellEvents();
    }
  }

  return {
    get workbook() { return wb; },
    get ENV() { return ENV; },
    nodeId, nd, put, dd, reset, loadAll, recalculate, setCode, evalForm, invalidateFormulas,
    setWorkbook, getNode, touch, evaluate, evaluatedCell,
    runHook(event, payload = null) { return cellBridge().runHook(event, payload); },
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
  // Keep prose such as `pippo/pluto (asdasd)` as text; shorthand calls have
  // the opening parenthesis immediately after the function name.
  const m = /^([^\s()]+)\(/.exec(s);
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
  return isCellRef || Object.prototype.hasOwnProperty.call(env, s) ? s : null;
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

