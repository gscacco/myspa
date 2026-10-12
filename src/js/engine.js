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
 * Le formule sono ClojureScript e vengono valutate da `cljs.js`:
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
import { interpret, evaluateIn, readError, sheetCoreVars } from './cljs.js';

/**
 * Funzioni del foglio (namespace ClojureScript `sheet.core`) come oggetto
 * piatto. Usato dal percorso JavaScript delle formule e dai test; la
 * definizione delle funzioni vive in `cljs.js` (`SHEET_CORE_SOURCE`).
 * @returns {object}
 */
export function buildBuiltins() { return sheetCoreVars(); }

/**
 * Crea un motore di calcolo per un workbook.
 *
 * @param {object} workbook
 */
export function createEngine(workbook) {
  let wb = workbook;
  let ENV = null;                       // variabili visibili (namespace uniti), per le formule JS
  let rootScope = null;                 // scope del namespace `user`, riusato da evalForm
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
          const e = readError(src);
          if (e) throw e;
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
      const v = n.cljs != null ? evaluateIn(rootScope, n.cljs) : n.fn($, $$, ENV);
      n.val = v === undefined ? null : v; n.err = null;
    }
    catch (e) { n.err = e instanceof Error ? e : new Error(String(e)); n.val = null; }
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

  /** Ponte tra il motore e l'interprete ClojureScript (accesso alle celle). */
  function bridge() { return { '$': $, '$$': $$ }; }

  /** Installa scope (namespace) ed ENV restituiti da `interpret`. */
  function installScope(r) { rootScope = r.scope; ENV = r.vars; }

  // Scope iniziale (sheet.core + user vuoto): le formule sono valutabili anche
  // senza aver mai chiamato `setCode`.
  installScope(interpret('', bridge()));

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
   * Imposta il codice utente (ClojureScript, namespace `user`) e ricostruisce
   * l'ambiente delle formule con le definizioni esposte dall'interprete. In
   * caso di errore lo scope resta utilizzabile con le sole funzioni del foglio.
   * @returns {Error|null} errore di lettura/valutazione, oppure null
   */
  function setCode(code) {
    const r = interpret(code || '', bridge());
    installScope(r);
    return r.error;
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
    const r = interpret(code, null, rootScope);
    if (r.error) return { value: null, error: r.error, defs: {} };
    installScope(r);
    return { value: r.value, error: null, defs: r.defs };
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

