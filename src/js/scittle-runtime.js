/** Integrazione runtime con Scittle/SCI, caricato come bundle globale. */

const BRIDGE_KEY = '__foglioScittleBridge';
let sheetCoreReady = false;

export const SHEET_CORE_SOURCE = `(ns sheet.core)
(def $ (fn [id]
  (let [bridge js/globalThis.__foglioScittleBridge]
    (if (.-readClj bridge)
      (js->clj ((.-readClj bridge) id) :keywordize-keys true)
      (js->clj ((.-read bridge) id) :keywordize-keys true)))))
(def $$ (fn [id]
  (let [bridge js/globalThis.__foglioScittleBridge]
    (if (.-rangeClj bridge)
      (js->clj ((.-rangeClj bridge) id) :keywordize-keys true)
      (js->clj ((.-range bridge) id) :keywordize-keys true)))))
(def log! (fn
  ([level message] (log! level message nil))
  ([level message metadata]
   (let [bridge js/globalThis.__foglioScittleBridge
         options (when metadata (clj->js metadata))]
     (when (.-log bridge)
       ((.-log bridge) (if (keyword? level) (name level) (str level)) (str message) options))
     nil))))
(def add-hook (fn [event callback]
  (let [bridge js/globalThis.__foglioScittleBridge]
    (if (.-addHook bridge)
      ((.-addHook bridge) (if (keyword? event) (name event) (str event)) callback)
      false))))
(def remove-hook (fn [event callback]
  (let [bridge js/globalThis.__foglioScittleBridge]
    (if (.-removeHook bridge)
      ((.-removeHook bridge) (if (keyword? event) (name event) (str event)) callback)
      false))))
(def run-hook (fn
  ([event] (run-hook event nil))
  ([event payload]
   (let [bridge js/globalThis.__foglioScittleBridge]
     (if (.-runHook bridge)
       ((.-runHook bridge) (if (keyword? event) (name event) (str event)) (when payload (clj->js payload)))
       0)))))
(def clear-hook (fn [event]
  (let [bridge js/globalThis.__foglioScittleBridge]
    (if (.-clearHook bridge)
      ((.-clearHook bridge) (if (keyword? event) (name event) (str event)))
      0))))
(def list-hooks (fn
  ([] (list-hooks :on-selection-change))
  ([event]
   (let [bridge js/globalThis.__foglioScittleBridge]
     (if (.-listHooks bridge)
       (vec (array-seq ((.-listHooks bridge) (if (keyword? event) (name event) (str event)))))
       [])))))
(def PI js/Math.PI)
(def E js/Math.E)
(def abs js/Math.abs)
(def sqrt js/Math.sqrt)
(def pow js/Math.pow)
(def floor js/Math.floor)
(def ceil js/Math.ceil)
(def round js/Math.round)
(def trunc js/Math.trunc)
(def exp js/Math.exp)
(def log js/Math.log)
(def log10 js/Math.log10)
(def sin js/Math.sin)
(def cos js/Math.cos)
(def tan js/Math.tan)
(def asin js/Math.asin)
(def acos js/Math.acos)
(def atan js/Math.atan)
(def atan2 js/Math.atan2)
(def sign js/Math.sign)
(def cbrt js/Math.cbrt)
(def hypot js/Math.hypot)
(def log2 js/Math.log2)
(def upper-case (fn [s] (.toUpperCase (str s))))
(def lower-case (fn [s] (.toLowerCase (str s))))
(def trim (fn [s] (.trim (str s))))
(defn subs
  ([s start] (.slice (str s) start))
  ([s start end] (.slice (str s) start end)))
(def split (fn [s pattern] (vec (.split (str s) pattern))))
(def join (fn [separator values] (.join (clj->js values) separator)))
(def replace (fn [s pattern replacement] (.replace (str s) pattern replacement)))
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
(defn IF [c a b] (if c a b))`;

function evaluator() {
  const fn = globalThis.scittle?.core?.eval_string;
  if (typeof fn !== 'function') throw new Error('Scittle non è stato caricato prima del motore');
  return fn;
}

/** Esegue sorgente nel contesto persistente di Scittle. */
export function scittleEval(source) { return evaluator()(source); }

let nextHookCallId = 1;

/** Invoke an SCI function with an event converted back into ClojureScript data. */
export function invokeCljsHook(callback, event) {
  const key = `__foglioHookCall${nextHookCallId++}`;
  globalThis[key] = { callback, event };
  try {
    return scittleEval(`(let [call js/globalThis.${key}
                              raw-event (.-event call)
                              event-data (js->clj raw-event :keywordize-keys true)
                              event-data (assoc event-data
                                                :event (keyword (.-event raw-event))
                                                :source (keyword (.-source raw-event)))]
                        ((.-callback call) event-data))`);
  } finally {
    delete globalThis[key];
  }
}

/** Inizializza una sola volta il namespace condiviso con le funzioni del foglio. */
export function ensureSheetCore() {
  if (sheetCoreReady) return;
  if (!globalThis[BRIDGE_KEY]) {
    const bridgeState = {
      active: null,
      read(id) {
        if (!bridgeState.active) throw new Error('accesso a cella fuori da una valutazione');
        return bridgeState.active.read(id);
      },
      range(id) {
        if (!bridgeState.active) throw new Error('accesso a intervallo fuori da una valutazione');
        return bridgeState.active.range(id);
      },
      readClj(id) {
        if (!bridgeState.active) throw new Error('accesso a cella fuori da una valutazione');
        return (bridgeState.active.readClj || bridgeState.active.read)(id);
      },
      rangeClj(id) {
        if (!bridgeState.active) throw new Error('accesso a intervallo fuori da una valutazione');
        return (bridgeState.active.rangeClj || bridgeState.active.range)(id);
      },
      log(level, message, metadata) {
        if (!bridgeState.active?.log) return null;
        return bridgeState.active.log(level, message, metadata);
      },
      addHook(event, callback) { return bridgeState.active?.addHook?.(event, callback) ?? false; },
      removeHook(event, callback) { return bridgeState.active?.removeHook?.(event, callback) ?? false; },
      runHook(event, payload) { return bridgeState.active?.runHook?.(event, payload) ?? 0; },
      clearHook(event) { return bridgeState.active?.clearHook?.(event) ?? 0; },
      listHooks(event) { return bridgeState.active?.listHooks?.(event) ?? []; },
    };
    globalThis[BRIDGE_KEY] = bridgeState;
  }
  scittleEval(SHEET_CORE_SOURCE);
  sheetCoreReady = true;
}

/** Esegue una callback rendendo disponibili a `$` e `$$` le letture di un engine. */
export function withCellBridge(bridge, callback) {
  ensureSheetCore();
  const state = globalThis[BRIDGE_KEY];
  const previous = state.active;
  state.active = bridge;
  try { return callback(); }
  finally { state.active = previous; }
}

/** Crea o seleziona il namespace di un workbook, importando le funzioni del foglio. */
export function enterUserNamespace(namespace) {
  ensureSheetCore();
  scittleEval(`(ns ${namespace} (:require [sheet.core :refer :all]))`);
}

/** Valuta forme nel namespace dell'engine e converte collezioni in valori JS. */
export function evaluateInNamespace(namespace, source) {
  enterUserNamespace(namespace);
  return scittleEval(`(clj->js (do ${source}))`);
}

/** Valuta una forma conservando sia il dato JavaScript sia il valore SCI originale. */
export function evaluateInNamespaceWithRaw(namespace, source) {
  enterUserNamespace(namespace);
  const raw = scittleEval(`(do ${source})`);
  const key = '__foglioScittleRawResult';
  globalThis[key] = { value: raw };
  try {
    const value = scittleEval(`(clj->js (.-value js/globalThis.${key}))`);
    const display = scittleEval(`(let [v (.-value js/globalThis.${key})] (when (or (keyword? v) (coll? v)) (pr-str v)))`);
    return { value, raw, display };
  } finally {
    delete globalThis[key];
  }
}

/** Stampa un valore SCI come una forma ClojureScript leggibile e persistibile. */
export function printCljsValue(value) {
  const key = '__foglioScittleClipboardValue';
  globalThis[key] = { value };
  try { return scittleEval(`(pr-str (.-value js/globalThis.${key}))`); }
  finally { delete globalThis[key]; }
}

/** Recupera una var dal namespace, restituendone la rappresentazione JS. */
export function getNamespaceValue(namespace, name) {
  enterUserNamespace(namespace);
  return scittleEval(`(clj->js ${name})`);
}

/** Adatta le chiamate JavaScript alle funzioni SCI convertendo array e mappe. */
export function getNamespaceCallable(namespace, name) {
  return (...args) => {
    const key = '__foglioScittleArgs';
    globalThis[key] = { args };
    try {
      return scittleEval(`(clj->js (apply ${namespace}/${name} (js->clj (.-args js/globalThis.${key}))))`);
    } finally {
      delete globalThis[key];
    }
  };
}

/** Trasforma i riferimenti espliciti al namespace user nel namespace isolato dell'engine. */
export function qualifyUserRefs(source, namespace) {
  return source.replace(/\buser\//g, namespace + '/');
}
