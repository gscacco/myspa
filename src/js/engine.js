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
 * Il codice utente è scritto in ClojureScript e viene valutato da `cljs.js`;
 * le funzioni/variabili definite diventano disponibili alle formule (che
 * restano espressioni del foglio) tramite l'ambiente `ENV`.
 */

import { colName, colIndex, addr, parseRef, mapRefs } from './references.js';
import { sheetByName, setRaw } from './model.js';
import { interpret } from './cljs.js';

/**
 * Costruisce l'ambiente con le funzioni incorporate: tutto `Math` più
 * SUM, COUNT, MIN, MAX, AVG/AVERAGE, ROUND, IF.
 * @returns {object}
 */
export function buildBuiltins() {
  const B = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) B[k] = Math[k];
  const num = a => a.flat(Infinity).filter(v => typeof v === 'number');
  Object.assign(B, {
    SUM: (...a) => num(a).reduce((x, y) => x + y, 0),
    COUNT: (...a) => num(a).length,
    MIN: (...a) => Math.min(...num(a)),
    MAX: (...a) => Math.max(...num(a)),
    AVG: (...a) => { const n = num(a); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; },
    ROUND: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
    IF: (c, a, b) => c ? a : b,
  });
  B.AVERAGE = B.AVG;
  return B;
}

/**
 * Crea un motore di calcolo per un workbook.
 *
 * @param {object} workbook
 */
export function createEngine(workbook) {
  let wb = workbook;
  let ENV = buildBuiltins();
  let rootScope = null;                 // scope di primo livello riusato da evalForm
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
      n = { id, sh, a, deps: new Set(), rd: new Set(), st: 0, val: null, err: null, fn: null, raw: undefined };
      nodes.set(id, n);
      setNode(n, s.cells[a]?.r);
    }
    return n;
  }

  /** (Ri)compila il valore grezzo di un nodo in una funzione, o memorizza il valore. */
  function setNode(n, raw) {
    n.deps.forEach(d => d.rd.delete(n));
    n.deps.clear();
    n.raw = raw; n.fn = null; n.err = null; n.st = 0; n.val = null;
    if (typeof raw === 'string' && raw[0] === '=') {
      try {
        const js = mapRefs(raw.slice(1), x => x.b
          ? `$$("${x.sh || n.sh}!${x.c}${x.r}:${x.b.c}${x.b.r}")`
          : `$("${x.sh || n.sh}!${x.c}${x.r}")`);
        n.fn = new Function('$', '$$', 'ENV', /\breturn\b|;/.test(js) ? 'with(ENV){' + js + '}' : 'with(ENV){return (' + js + ')}');
        n.st = 1;
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

  /** Esegue la funzione di un nodo. */
  function ev(n) {
    n.st = 2;
    n.deps.forEach(d => d.rd.delete(n));
    n.deps.clear();
    const p = ctx; ctx = n;
    try { const v = n.fn($, $$, ENV); n.val = v === undefined ? null : v; n.err = null; }
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

  /** Propaga lo stato "da ricalcolare" lungo il grafo. */
  function dd(n) { if (n.st === 1) return; if (n.fn) n.st = 1; n.rd.forEach(dd); }

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
   * Imposta il codice utente (ClojureScript) e ricostruisce l'ambiente delle
   * formule con le definizioni esposte dall'interprete.
   * @returns {Error|null} errore di lettura/valutazione, oppure null
   */
  function setCode(code) {
    const B = buildBuiltins();
    const r = interpret(code || '', B);
    rootScope = r.scope;
    ENV = Object.assign(Object.create(null), B, r.defs);
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
    const r = interpret(code, ENV, rootScope);
    if (r.error) return { value: null, error: r.error, defs: {} };
    rootScope = r.scope;
    ENV = Object.assign(Object.create(null), ENV, r.defs);
    return { value: r.value, error: null, defs: r.defs };
  }

  /** Marca tutte le formule come da ricalcolare. */
  function invalidateFormulas() { nodes.forEach(n => { if (n.fn) n.st = 1; }); }

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

