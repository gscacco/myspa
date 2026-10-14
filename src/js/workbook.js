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
import { addr, colIndex, shiftRefs } from './references.js';
import { ROWS, COLS, sheetByName, getRaw, parseInput, addSheet, removeSheet, uniqueSheetName } from './model.js';

/** Numero massimo di passi conservati nella cronologia "annulla". */
const HISTORY_LIMIT = 100;

const STYLE_TYPES = Object.freeze({
  background: 'color', color: 'color', bold: 'boolean', italic: 'boolean', underline: 'boolean',
  'font-size': 'fontSize', 'font-family': 'fontFamily',
  'border-color': 'color', 'border-width': 'borderWidth', 'border-style': 'borderStyle',
});
const BORDER_STYLES = new Set(['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);

function isColor(value) {
  return typeof value === 'string' && value.length <= 64 && (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    || /^[a-z]{1,24}$/i.test(value)
    || /^(?:rgb|rgba|hsl|hsla)\([\d\s,.%/-]+\)$/i.test(value)
    || /^var\(--[\w-]+\)$/i.test(value)
  );
}

function normalizeStyle(style) {
  if (style == null) return null;
  if (typeof style !== 'object' || Array.isArray(style)) throw new TypeError('Cell style must be a ClojureScript map');
  const result = {};
  for (const [rawKey, value] of Object.entries(style)) {
    const key = rawKey.replace(/^:/, '');
    const type = STYLE_TYPES[key];
    if (!type) throw new Error(`Unknown cell style :${key}`);
    if (value == null) { result[key] = null; continue; }
    if (type === 'color') {
      if (!isColor(value)) throw new TypeError(`:${key} must be a CSS color`);
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') throw new TypeError(`:${key} must be true or false`);
    } else if (type === 'fontSize') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 72) throw new RangeError(':font-size must be between 8 and 72 pixels');
    } else if (type === 'fontFamily') {
      if (typeof value !== 'string' || !value.trim() || value.length > 80 || !/^[\w\s,'"-]+$/.test(value)) throw new TypeError(':font-family must be a plain font-family name');
    } else if (type === 'borderWidth') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 12) throw new RangeError(':border-width must be between 0 and 12 pixels');
    } else if (type === 'borderStyle') {
      const border = String(value).replace(/^:/, '');
      if (!BORDER_STYLES.has(border)) throw new TypeError(`Unsupported :border-style ${border}`);
      result[key] = border;
      continue;
    }
    result[key] = value;
  }
  return result;
}

function parseStyleTarget(target, defaultSheet) {
  const match = /^(?:([A-Za-z_]\w*)!)?\$?([A-Z]{1,2})\$?(\d+)(?::\$?([A-Z]{1,2})\$?(\d+))?$/.exec(String(target ?? '').trim());
  if (!match) throw new Error(`Invalid cell or range reference: ${target}`);
  const sheetName = match[1] || defaultSheet;
  if (!sheetName) throw new Error('No current sheet is available for this style operation');
  const start = { r: Number(match[3]) - 1, c: colIndex(match[2]) };
  const end = match[4] ? { r: Number(match[5]) - 1, c: colIndex(match[4]) } : start;
  if ([start.r, end.r].some(row => row < 0 || row >= ROWS)
    || [start.c, end.c].some(column => column < 0 || column >= COLS)) {
    throw new RangeError(`Cell or range is outside the grid: ${target}`);
  }
  return {
    sheetName,
    rect: { r0: Math.min(start.r, end.r), r1: Math.max(start.r, end.r), c0: Math.min(start.c, end.c), c1: Math.max(start.c, end.c) },
  };
}

/**
 * Crea una sessione di lavoro su un workbook.
 * @param {object} workbook
 */
export function createSession(workbook, options = {}) {
  let wb = workbook;
  let styleListener = options.onStyle || null;
  const engine = createEngine(wb, {
    ...options,
    styleRange: (target, style, sourceSheet) => {
      const currentSheet = sourceSheet || options.getCurrentSheet?.() || wb.sheets[0]?.name;
      const { sheetName, rect } = parseStyleTarget(target, currentSheet);
      const addresses = setRangeStyle(sheetName, rect, style);
      if (addresses.length) styleListener?.({ sheetName, addresses });
      return addresses.length;
    },
  });
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

  /** Aggiorna la sorgente del codice utente senza eseguirla. */
  function setCodeSource(code) {
    const source = String(code ?? '');
    if ((wb.code || '') === source) return false;
    snapshot();
    wb.code = source;
    return true;
  }

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

  /** Apply supported presentation styles to a cell range without recalculating values. */
  function setRangeStyle(sheetName, rect, style) {
    const normalized = normalizeStyle(style);
    const sheet = sheetByName(wb, sheetName);
    if (!sheet) throw new Error(`Unknown sheet: ${sheetName}`);
    const plans = [];
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
      const address = addr(r, c), cell = sheet.cells[address];
      const next = normalized === null ? {} : { ...(cell?.style || {}) };
      if (normalized !== null) {
        for (const [key, value] of Object.entries(normalized)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
      }
      const previous = cell?.style || {};
      const changed = normalized === null
        ? Object.keys(previous).length > 0 || cell?.b !== undefined || cell?.bg !== undefined
        : Object.keys(previous).length !== Object.keys(next).length
          || Object.entries(next).some(([key, value]) => previous[key] !== value);
      if (changed) plans.push({ address, next });
    }
    if (!plans.length) return [];
    snapshot();
    for (const { address, next } of plans) {
      const cell = (sheet.cells[address] ??= {});
      if (normalized === null) {
        delete cell.style;
        delete cell.b;
        delete cell.bg;
      } else if (Object.keys(next).length) cell.style = next;
      else delete cell.style;
      if (!Object.keys(cell).length) delete sheet.cells[address];
    }
    return plans.map(plan => plan.address);
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
    loadCode, setCodeSource, rebuild, snapshot, setCell, clearRange, fillDown, formatRange,
    setRangeStyle, setStyleListener: listener => { styleListener = typeof listener === 'function' ? listener : null; },
    pasteRows, fillRange, addNewSheet, deleteSheet, applyCode, evalForm, restore, undo, redo, replace, markSaved,
  };
}

