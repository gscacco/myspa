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
export function createSession(workbook, options = {}) {
  let wb = workbook;
  const engine = createEngine(wb, options);
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
  function pasteRows(sheetName, r0, c0, rows, {
    internal = false, baseR = 0, baseC = 0, formulas = [], targetRect = null,
    sourceRect = null, preserveSource = false,
  } = {}) {
    const sourceHeight = rows.length;
    const sourceWidth = Math.max(0, ...rows.map(row => row.length));
    if (!sourceHeight || !sourceWidth) return [];
    const selectedHeight = targetRect ? targetRect.r1 - targetRect.r0 + 1 : 1;
    const selectedWidth = targetRect ? targetRect.c1 - targetRect.c0 + 1 : 1;
    const destR0 = targetRect?.r0 ?? r0, destC0 = targetRect?.c0 ?? c0;
    const dest = preserveSource && targetRect ? targetRect : {
      r0: destR0, c0: destC0,
      r1: destR0 + Math.max(sourceHeight, selectedHeight) - 1,
      c1: destC0 + Math.max(sourceWidth, selectedWidth) - 1,
    };
    const modulo = (value, size) => (value % size + size) % size;
    snapshot();
    for (let r = Math.max(0, dest.r0); r <= Math.min(ROWS - 1, dest.r1); r++) {
      for (let c = Math.max(0, dest.c0); c <= Math.min(COLS - 1, dest.c1); c++) {
        if (preserveSource && sourceRect
          && r >= sourceRect.r0 && r <= sourceRect.r1
          && c >= sourceRect.c0 && c <= sourceRect.c1) continue;
        const alignR = preserveSource ? baseR : r0;
        const alignC = preserveSource ? baseC : c0;
        const i = modulo(r - alignR, sourceHeight), j = modulo(c - alignC, sourceWidth);
        const v = rows[i]?.[j] ?? '';
        const isFormula = formulas[i]?.[j] ?? (typeof v === 'string' && v.startsWith('='));
        const sourceR = baseR + i, sourceC = baseC + j;
        engine.put(sheetName, addr(r, c), parseInput(internal && isFormula ? shiftRefs(v, r - sourceR, c - sourceC) : v));
      }
    }
    return engine.recalculate();
  }

  /** Estende una selezione ripetendo un intervallo sorgente, come il fill handle. */
  function fillRange(sheetName, sourceRect, targetRect) {
    const rows = [], formulas = [];
    for (let r = sourceRect.r0; r <= sourceRect.r1; r++) {
      const row = [], formulaRow = [];
      for (let c = sourceRect.c0; c <= sourceRect.c1; c++) {
        const address = addr(r, c), node = engine.nd(sheetName + '!' + address);
        row.push(String(getRaw(wb, sheetName, address) ?? ''));
        formulaRow.push(!!(node.fn || node.cljs));
      }
      rows.push(row); formulas.push(formulaRow);
    }
    return pasteRows(sheetName, targetRect.r0, targetRect.c0, rows, {
      internal: true, baseR: sourceRect.r0, baseC: sourceRect.c0,
      formulas, targetRect, sourceRect, preserveSource: true,
    });
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
    pasteRows, fillRange, addNewSheet, deleteSheet, applyCode, evalForm, restore, undo, redo, replace, markSaved,
  };
}

