/**
 * model.js — Strutture dati del workbook/foglio/cella e mutazioni pure.
 *
 * Modulo puro: non dipende dal DOM, dal motore di calcolo o dal browser.
 *
 * Formato del workbook (identico a quello EDN salvato):
 *   { version, name, code, sheets: [ { name, cells: { A1: { r, d, b, bg } } } ] }
 *
 * Campi di una cella:
 *   r  valore grezzo (stringa, numero oppure formula "=...")
 *   d  numero di decimali da mostrare
 *   b  grassetto (true)
 *   bg colore di sfondo
 */

/** Numero di righe della griglia. */
export const ROWS = 100;
/** Numero di colonne della griglia. */
export const COLS = 26;

/**
 * Crea un workbook normalizzato a partire da un oggetto già parsato.
 * @param {object} [src]
 * @returns {object}
 */
export function createWorkbook(src = {}) {
  return {
    version: src.version ?? 1,
    name: src.name ?? 'Foglio di calcolo',
    code: src.code ?? '',
    sheets: (src.sheets ?? [{ name: 'Foglio1', cells: {} }]).map(s => ({
      name: s.name,
      ...(s.widths ? { widths: { ...s.widths } } : {}),
      ...(s.heights ? { heights: { ...s.heights } } : {}),
      cells: Object.fromEntries(Object.entries(s.cells || {}).map(([a, c]) => [a, { ...c }])),
    })),
  };
}

/**
 * Trova un foglio per nome.
 * @param {object} wb
 * @param {string} name
 * @returns {object|undefined}
 */
export function sheetByName(wb, name) {
  return wb.sheets.find(s => s.name === name);
}

/**
 * Cella (oggetto) di un foglio, oppure `undefined`.
 * @param {object} wb
 * @param {string} sheetName
 * @param {string} a indirizzo A1
 */
export function getCell(wb, sheetName, a) {
  const s = sheetByName(wb, sheetName);
  return s ? s.cells[a] : undefined;
}

/**
 * Valore grezzo `:r` di una cella, oppure `undefined`.
 * @param {object} wb
 * @param {string} sheetName
 * @param {string} a
 */
export function getRaw(wb, sheetName, a) {
  const c = getCell(wb, sheetName, a);
  return c ? c.r : undefined;
}

/**
 * Imposta il valore grezzo di una cella (mutazione, senza motore).
 * Se `raw === undefined` rimuove `:r` e, se la cella resta vuota, la elimina.
 * @returns {object|undefined} la cella risultante, oppure `undefined` se rimossa
 */
export function setRaw(wb, sheetName, a, raw) {
  const s = sheetByName(wb, sheetName);
  if (!s) return undefined;
  if (raw === undefined) {
    const c = s.cells[a];
    if (c) {
      delete c.r;
      if (!Object.keys(c).length) delete s.cells[a];
    }
    return s.cells[a];
  }
  const c = (s.cells[a] ??= {});
  c.r = raw;
  return c;
}

/**
 * Aggiunge un foglio vuoto.
 * @returns {object} il foglio creato
 */
export function addSheet(wb, name) {
  const sheet = { name, cells: {} };
  wb.sheets.push(sheet);
  return sheet;
}

/**
 * Rimuove un foglio per indice.
 * @returns {object|undefined} il foglio rimosso
 */
export function removeSheet(wb, index) {
  return wb.sheets.splice(index, 1)[0];
}

/**
 * Nome di foglio univoco del tipo `<base><n>` (es. base "Foglio" -> "Foglio3").
 * @param {object} wb
 * @param {string} base
 * @returns {string}
 */
export function uniqueSheetName(wb, base) {
  let k = wb.sheets.length + 1;
  while (sheetByName(wb, base + k)) k++;
  return base + k;
}

/**
 * Converte il testo digitato dall'utente nel valore grezzo da memorizzare.
 *  - stringa vuota -> `undefined` (cancella la cella)
 *  - inizio `=` -> stringa (formula infissa legacy o formula esplicita)
 *  - letterale numerico -> numero
 *  - altrimenti -> stringa conservata per il motore, che riconosce le forme CLJS
 * @param {string} t
 * @returns {string|number|undefined}
 */
export function parseInput(t) {
  if (t === '') return undefined;
  if (t[0] === '=') return t;
  return /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(t) ? +t : t;
}
