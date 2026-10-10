/**
 * workbook.js — Operazioni su workbook/fogli e comandi di dominio.
 *
 * Riunisce modello e motore in una "sessione" senza DOM: gestisce cronologia
 * (annulla/ripristina), scrittura celle, formattazione, riempimento, copia di
 * intervalli, gestione fogli e applicazione del codice utente.
 *
 * Le operazioni che modificano i valori restituiscono i nodi cambiati così la
 * vista può ridisegnare solo il necessario.
 */

import { createEngine } from './engine.js';
import { addr, shiftRefs } from './references.js';
import { ROWS, COLS, sheetByName, getRaw, parseInput, addSheet, removeSheet, uniqueSheetName } from './model.js';

/** Numero massimo di passi conservati nella cronologia "annulla". */
const HISTORY_LIMIT = 100;

/**
 * Crea una sessione di lavoro su un workbook.
 * @param {object} workbook
 */
export function createSession(workbook) {
  let wb = workbook;
  const engine = createEngine(wb);
  const undoStack = [];
  const redoStack = [];
  let modified = false;

  /** Fotografia dello stato corrente per l'annulla (come l'originale `snap`). */
  function snapshot() {
    undoStack.push(JSON.stringify(wb));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    modified = true;
  }

  /** Applica un codice funzioni utente al workbook (senza invalidare i nodi). */
  function loadCode() { return engine.setCode(wb.code || ''); }

  /** Ricostruisce il grafo e ricalcola tutto. */
  function rebuild() {
    engine.reset();
    engine.loadAll();
    return engine.recalculate();
  }

  /** Scrive una cella (come l'originale `setCell`). @returns {object[]} nodi cambiati */
  function setCell(sheetName, r, c, text) {
    snapshot();
    engine.put(sheetName, addr(r, c), parseInput(text));
    return engine.recalculate();
  }

  /** Cancella un intervallo. */
  function clearRange(sheetName, rect) {
    snapshot();
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) engine.put(sheetName, addr(r, c), undefined);
    return engine.recalculate();
  }

  /** Copia verso il basso i valori della prima riga dell'intervallo, spostando i riferimenti. */
  function fillDown(sheetName, rect) {
    snapshot();
    for (let c = rect.c0; c <= rect.c1; c++) {
      const v = getRaw(wb, sheetName, addr(rect.r0, c));
      for (let r = rect.r0 + 1; r <= rect.r1; r++) {
        engine.put(sheetName, addr(r, c), (typeof v === 'string' && v[0] === '=') ? shiftRefs(v, r - rect.r0, 0) : v);
      }
    }
    return engine.recalculate();
  }

  /**
   * Applica una formattazione a un intervallo (grassetto, decimali, sfondo).
   * Non modifica i valori: restituisce gli indirizzi toccati per il ridisegno.
   */
  function formatRange(sheetName, rect, key, value) {
    snapshot();
    const s = sheetByName(wb, sheetName);
    const list = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) list.push(addr(r, c));
    const all = list.every(a => s.cells[a]?.[key]);
    list.forEach(a => {
      const cell = (s.cells[a] ??= {});
      if (key === 'b') all ? delete cell.b : cell.b = true;
      else if (key === 'd') cell.d = Math.max(0, Math.min(8, (cell.d ?? 0) + value));
      else value ? cell.bg = value : delete cell.bg;
      if (!Object.keys(cell).length) delete s.cells[a];
    });
    return list;
  }

  /**
   * Incolla una matrice di celle (TSV) a partire da (r0,c0).
   * Se `internal` è vero i riferimenti relativi vengono spostati dell'offset
   * rispetto all'area di origine (come nell'applicazione originale).
   */
  function pasteRows(sheetName, r0, c0, rows, { internal = false, baseR = 0, baseC = 0 } = {}) {
    snapshot();
    rows.forEach((row, i) => row.forEach((v, j) => {
      const r = r0 + i, c = c0 + j;
      if (r < ROWS && c < COLS) {
        engine.put(sheetName, addr(r, c), parseInput(internal && v[0] === '=' ? shiftRefs(v, r0 - baseR, c0 - baseC) : v));
      }
    }));
    return engine.recalculate();
  }

  /** Aggiunge un foglio con nome automatico. @returns {number} indice del nuovo foglio */
  function addNewSheet() {
    snapshot();
    addSheet(wb, uniqueSheetName(wb, 'Foglio'));
    return wb.sheets.length - 1;
  }

  /** Elimina un foglio per indice; il grafo viene ricostruito dal chiamante. */
  function deleteSheet(index) {
    snapshot();
    removeSheet(wb, index);
    return wb;
  }

  /** Applica il codice delle funzioni utente e ricalcola le formule. */
  function applyCode(code) {
    snapshot();
    wb.code = code;
    const error = engine.setCode(code);
    engine.invalidateFormulas();
    return { error, changed: engine.recalculate() };
  }

  /**
   * Valuta una sola forma di codice utente (come `C-x C-e` di Emacs): aggiorna
   * l'ambiente delle formule e le ricalcola senza toccare `wb.code` né la
   * cronologia — è una valutazione di sessione, comoda per ridefinire al volo
   * una `defn` o una costante `def`.
   * @param {string} code
   * @returns {{error:Error|null, value:*, changed:object[]}}
   */
  function evalForm(code) {
    const { error, value } = engine.evalForm(code);
    if (error) return { error, value: null, changed: [] };
    engine.invalidateFormulas();
    return { error: null, value, changed: engine.recalculate() };
  }

  /** Annulla/ripristina: ripristina uno stato serializzato. */
  function restore(json) {
    wb = JSON.parse(json);
    engine.setWorkbook(wb);
    const error = engine.setCode(wb.code || '');
    modified = true;
    return { workbook: wb, error };
  }

  function undo() {
    if (!undoStack.length) return null;
    redoStack.push(JSON.stringify(wb));
    return restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return null;
    undoStack.push(JSON.stringify(wb));
    return restore(redoStack.pop());
  }

  /** Sostituisce l'intero workbook (apertura file / caricamento). */
  function replace(next) {
    wb = next;
    engine.setWorkbook(wb);
    undoStack.length = 0;
    redoStack.length = 0;
    modified = false;
    return engine.setCode(wb.code || '');
  }

  function markSaved() { modified = false; }

  return {
    get workbook() { return wb; },
    engine,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    isModified: () => modified,
    getHistorySize: () => undoStack.length,
    loadCode, rebuild, snapshot, setCell, clearRange, fillDown, formatRange,
    pasteRows, addNewSheet, deleteSheet, applyCode, evalForm, restore, undo, redo, replace, markSaved,
  };
}

