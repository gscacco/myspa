/**
 * grid.js — Rendering della griglia e interazione con l'utente.
 *
 * Dipende dal DOM, dal modello e dal motore (tramite la sessione). Non contiene
 * logica di calcolo: chiede alla sessione di eseguire le operazioni e ridisegna
 * i nodi restituiti.
 */

import { ROWS, COLS, sheetByName } from './model.js';
import { colName, addr, parseRef } from './references.js';

/**
 * Crea la vista della griglia.
 * @param {object} ctx contesto applicativo con `session`, `currentSheet()`,
 *   `updateStatus()`
 */
export function createGrid(ctx) {
  const Q = s => document.querySelector(s);
  const G = Q('#g');
  const ed = Q('#code');
  const fillHandle = Q('#fh');
  const tdOf = (r, c) => G.rows[r + 1]?.cells[c + 1];
  const DEFAULT_COL_WIDTH = 84, DEFAULT_ROW_HEIGHT = 24;
  const clampSize = (value, min, max) => Math.max(min, Math.min(max, value));

  let S = { a: { r: 0, c: 0 }, f: { r: 0, c: 0 } };
  let drag = 0;
  let fillDrag = null;
  let resizeDrag = null;
  let flowOn = true;

  const sheet = () => ctx.currentSheet();
  const rect = () => ({ r0: Math.min(S.a.r, S.f.r), r1: Math.max(S.a.r, S.f.r), c0: Math.min(S.a.c, S.f.c), c1: Math.max(S.a.c, S.f.c) });

  /** Testo mostrato per un nodo, in base al formato della cella. */
  function disp(n, f) {
    if (n.err) return n.err.message.startsWith('#') ? n.err.message.split(':')[0] : '#ERR';
    if (n.display != null) return n.display;
    const v = n.val;
    if (v === null) return '';
    if (typeof v === 'number') return f.d != null ? v.toFixed(f.d) : String(+v.toPrecision(12));
    return printValue(v);
  }

  /** Render ClojureScript collection values as readable, single-line forms. */
  function printValue(v, nested = false) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
    if (typeof v === 'number') return String(+v.toPrecision(12));
    if (typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return '[' + v.map(x => printValue(x, true)).join(' ') + ']';
    if (typeof v === 'object') {
      return '{' + Object.entries(v).map(([k, x]) => ':' + k + ' ' + printValue(x, true)).join(' ') + '}';
    }
    return String(v);
  }

  /** Ridisegna una cella dal suo nodo. */
  function paintCell(n) {
    const p = parseRef(n.a), td = tdOf(p.r, p.c);
    if (!td) return;
    const s = sheetByName(ctx.session.workbook, n.sh);
    const f = (s && s.cells[n.a]) || {};
    td.textContent = disp(n, f);
    td.className = (n.err ? 'e ' : '') + (typeof n.val === 'number' ? 'n' : '');
    td.title = n.err ? n.err.message : '';
    td.style.fontWeight = f.b ? '700' : '';
    td.style.background = f.bg || '';
  }

  /** Ridisegna i nodi indicati che appartengono al foglio corrente. */
  function paint(nodes) {
    (nodes || []).forEach(n => { if (n.sh === sheet().name) paintCell(n); });
  }

  /** Ridisegna le celle di un elenco di indirizzi del foglio corrente. */
  function paintAddresses(list) {
    list.forEach(a => paintCell(ctx.session.engine.nd(sheet().name + '!' + a)));
  }

  /** Costruisce l'intera tabella e ne popola le celle. */
  function render() {
    let h = '<colgroup><col class="row-head-col"><col data-column="0">' + [...Array(COLS - 1)].map((_, i) => '<col data-column="' + (i + 1) + '">').join('') + '</colgroup>';
    h += '<tr><th></th>' + [...Array(COLS)].map((_, c) => '<th>' + colName(c) + '<div class="col-resizer" data-column="' + c + '" title="Resize column"></div></th>').join('') + '</tr>';
    for (let r = 0; r < ROWS; r++) h += '<tr><th>' + (r + 1) + '<div class="row-resizer" data-row="' + r + '" title="Resize row"></div></th>' + '<td></td>'.repeat(COLS) + '</tr>';
    G.innerHTML = h;
    applySizes();
    Object.keys(sheet().cells).forEach(a => paintCell(ctx.session.engine.nd(sheet().name + '!' + a)));
  }

  /** Applica le dimensioni personalizzate salvate nel foglio. */
  function applySizes() {
    const current = sheet();
    let tableWidth = 46;
    G.querySelectorAll('col[data-column]').forEach(col => {
      const c = Number(col.dataset.column), width = clampSize(Number(current.widths?.[c]) || DEFAULT_COL_WIDTH, 40, 700);
      col.style.width = width + 'px';
      tableWidth += width;
    });
    G.querySelector('.row-head-col').style.width = '46px';
    G.style.width = tableWidth + 'px';
    for (let r = 0; r < ROWS; r++) {
      const height = clampSize(Number(current.heights?.[r]) || DEFAULT_ROW_HEIGHT, 18, 500);
      const row = G.rows[r + 1];
      if (!row) continue;
      row.style.height = height + 'px';
      [...row.cells].forEach(cell => { cell.style.height = height + 'px'; });
    }
  }

  /** Evidenzia i nodi da cui la cella attiva dipende (blu) e i dipendenti (arancio). */
  function flow() {
    document.querySelectorAll('.pre,.post').forEach(e => e.classList.remove('pre', 'post'));
    if (!flowOn) return;
    const n = ctx.session.engine.getNode(sheet().name + '!' + addr(S.a.r, S.a.c));
    if (!n) return;
    const mk = (d, k) => { if (d.sh !== sheet().name) return; const p = parseRef(d.a); tdOf(p.r, p.c)?.classList.add(k); };
    n.deps.forEach(d => mk(d, 'pre'));
    n.rd.forEach(d => mk(d, 'post'));
  }

  /** Aggiorna barra della formula, valore e overlay di selezione. */
  function showCell() {
    const { r0, r1, c0, c1 } = rect(), A = addr(S.a.r, S.a.c);
    const n = ctx.session.engine.getNode(sheet().name + '!' + A);
    const raw = sheet().cells[A]?.r;
    Q('#nb').value = A;
    Q('#fx').value = raw === undefined ? '' : raw;
    Q('#vv').textContent = n && n.err ? '⚠ ' + n.err.message : '';
    const a = tdOf(r0, c0), b = tdOf(r1, c1);
    if (a && b) Object.assign(Q('#ov').style, { left: a.offsetLeft + 'px', top: a.offsetTop + 'px', width: b.offsetLeft + b.offsetWidth - a.offsetLeft + 'px', height: b.offsetTop + b.offsetHeight - a.offsetTop + 'px' });
    flow();
  }

  /** Sposta la selezione. */
  function sel(r, c, ext) {
    r = Math.max(0, Math.min(ROWS - 1, r));
    c = Math.max(0, Math.min(COLS - 1, c));
    ext ? S.f = { r, c } : S.a = S.f = { r, c };
    showCell();
    const td = tdOf(r, c);
    if (td && typeof td.scrollIntoView === 'function') td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Applica il testo di una cella e ridisegna le celle cambiate. */
  function setCellText(r, c, text) {
    const changed = ctx.session.setCell(sheet().name, r, c, text);
    paint(changed);
    ctx.updateStatus();
    showCell();
  }

  /** Apre l'editor inline sulla cella attiva. */
  function edit(init) {
    const { r, c } = S.a, td = tdOf(r, c);
    if (!td) return;
    const raw = sheet().cells[addr(r, c)]?.r;
    const source = String(init ?? (raw === undefined ? '' : raw));
    const isFormula = source.startsWith('=');
    const opener = ['(', '[', '{'].includes(source) ? source : '';
    const value = opener ? opener + { '(': ')', '[': ']', '{': '}' }[opener] : isFormula ? source.slice(1) : source;
    ctx.editor.beginCellEdit({
      value,
      formula: isFormula,
      address: addr(r, c),
      caret: opener ? 1 : undefined,
      apply: text => setCellText(r, c, text),
    });
  }

  /** Chiude l'editor inline, salvando (`ok`) ed eventualmente spostando la selezione. */
  function endEdit(ok, mv) {
    if (!ctx.editor.isCellEditing()) return;
    ctx.editor.finishCellEdit(ok);
    mv ? sel(S.a.r + mv[0], S.a.c + mv[1]) : showCell();
  }

  /** Ricostruisce grafo e griglia (usato dopo cambio workbook/foglio). */
  function rebuild() {
    ctx.session.rebuild();
    render();
    showCell();
  }

  function setFlow(on) { flowOn = !!on; flow(); }

  function applyResize(e) {
    if (!resizeDrag) return;
    const { axis, index, start, size, sheetName } = resizeDrag;
    const next = clampSize(size + (axis === 'column' ? e.clientX - start : e.clientY - start), axis === 'column' ? 40 : 18, axis === 'column' ? 700 : 500);
    if (next === resizeDrag.current) return;
    if (!resizeDrag.changed) { ctx.session.snapshot(); resizeDrag.changed = true; }
    resizeDrag.current = next;
    const targetSheet = sheetByName(ctx.session.workbook, sheetName);
    if (axis === 'column') {
      (targetSheet.widths ??= {})[index] = next;
      const col = G.querySelector('col[data-column="' + index + '"]');
      if (col) col.style.width = next + 'px';
      G.style.width = 46 + [...G.querySelectorAll('col[data-column]')].reduce((sum, item) => sum + (parseFloat(item.style.width) || DEFAULT_COL_WIDTH), 0) + 'px';
    } else {
      (targetSheet.heights ??= {})[index] = next;
      const row = G.rows[index + 1];
      if (row) {
        row.style.height = next + 'px';
        [...row.cells].forEach(cell => { cell.style.height = next + 'px'; });
      }
    }
    showCell();
  }

  /** Collega gli eventi di editing (editor inline e barra della formula). */
  function mount() {
    Q('#fx').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); setCellText(S.a.r, S.a.c, e.target.value); e.target.blur(); }
      else if (e.key === 'Escape') { showCell(); e.target.blur(); }
    });
    G.addEventListener('mousedown', e => {
      const colHandle = e.target.closest('.col-resizer');
      const rowHandle = e.target.closest('.row-resizer');
      if (colHandle || rowHandle) {
        e.preventDefault();
        e.stopPropagation();
        const axis = colHandle ? 'column' : 'row';
        const index = Number((colHandle || rowHandle).dataset[axis === 'column' ? 'column' : 'row']);
        const sizes = axis === 'column' ? sheet().widths : sheet().heights;
        resizeDrag = {
          axis, index, sheetName: sheet().name,
          start: axis === 'column' ? e.clientX : e.clientY,
          size: Number(sizes?.[index]) || (axis === 'column' ? DEFAULT_COL_WIDTH : DEFAULT_ROW_HEIGHT),
          current: Number(sizes?.[index]) || (axis === 'column' ? DEFAULT_COL_WIDTH : DEFAULT_ROW_HEIGHT),
          changed: false,
        };
        document.body.classList.add(axis === 'column' ? 'resizing-column' : 'resizing-row');
        return;
      }
      const td = e.target.closest('td');
      if (!td) return;
      const r = td.parentNode.rowIndex - 1, c = td.cellIndex - 1;
      if (ctx.editor.isCellEditing()) {
        const v = ed.value, p = ed.selectionStart;
        const prefix = v.slice(0, p);
        const pendingCljsHead = /^\s*\(\s*[A-Za-z_*+!?][\w*+!?<>=./-]*\s*$/.test(prefix);
        const formulaMode = ed.dataset.formula === 'true' || hasImplicitCljsSyntax(v);
        const openFormSlot = /\s$/.test(prefix) && hasOpenCljsForm(prefix);
        if (formulaMode && (!prefix.trim() || /[=+\-*/(\[{},<>&|?:!%^]$/.test(prefix) || openFormSlot || pendingCljsHead)) {
          e.preventDefault();
          ed.dataset.formula = 'true';
          ed.setRangeText((pendingCljsHead && !/\s$/.test(prefix) ? ' ' : '') + addr(r, c), p, ed.selectionEnd, 'end');
          ctx.editor.refresh();
          ed.focus();
          return;
        }
        e.preventDefault();
        ed.focus();
        return;
      }
      sel(r, c, e.shiftKey);
      drag = 1;
    });
    fillHandle.addEventListener('mousedown', e => {
      if (ctx.editor.isCellEditing()) return;
      e.preventDefault();
      e.stopPropagation();
      const source = rect();
      fillDrag = { source, target: { r: source.r1, c: source.c1 } };
    });
    G.addEventListener('mouseover', e => {
      const td = e.target.closest('td');
      if (!td) return;
      const target = { r: td.parentNode.rowIndex - 1, c: td.cellIndex - 1 };
      if (fillDrag) {
        fillDrag.target = target;
        const { source } = fillDrag;
        S = {
          a: { r: Math.min(source.r0, target.r), c: Math.min(source.c0, target.c) },
          f: { r: Math.max(source.r1, target.r), c: Math.max(source.c1, target.c) },
        };
        showCell();
      } else if (drag) {
        S.f = target;
        showCell();
      }
    });
    G.addEventListener('dblclick', e => { if (e.target.closest('td')) edit(); });
    window.addEventListener('mousemove', applyResize);
    window.addEventListener('mouseup', () => {
      drag = 0;
      if (resizeDrag) {
        const changed = resizeDrag.changed;
        resizeDrag = null;
        document.body.classList.remove('resizing-column', 'resizing-row');
        if (changed) ctx.updateStatus();
        return;
      }
      if (!fillDrag) return;
      const { source, target } = fillDrag;
      fillDrag = null;
      const targetRect = {
        r0: Math.min(source.r0, target.r), r1: Math.max(source.r1, target.r),
        c0: Math.min(source.c0, target.c), c1: Math.max(source.c1, target.c),
      };
      const extendsSource = targetRect.r0 < source.r0 || targetRect.r1 > source.r1
        || targetRect.c0 < source.c0 || targetRect.c1 > source.c1;
      if (extendsSource) {
        const changed = ctx.session.fillRange(sheet().name, source, targetRect);
        paint(changed);
        ctx.updateStatus();
      }
      S = { a: { r: targetRect.r0, c: targetRect.c0 }, f: { r: targetRect.r1, c: targetRect.c1 } };
      showCell();
    });
  }

  function hasImplicitCljsSyntax(source) {
    const s = source.trim();
    return ['(', '[', '{', ':', '"', "'", '`', '\\'].includes(s[0])
      || s.startsWith('#{') || s.startsWith('#_')
      || /^(?:true|false|nil)$/.test(s)
      || /^[^\s()]+\s*\(/.test(s);
  }

  function hasOpenCljsForm(source) {
    let depth = 0, string = false, escape = false, comment = false;
    for (const c of source) {
      if (comment) { if (c === '\n') comment = false; continue; }
      if (string) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') string = false;
        continue;
      }
      if (c === ';') comment = true;
      else if (c === '"') string = true;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
    }
    return depth > 0;
  }

  return {
    mount, render, paint, paintAddresses, showCell, sel, edit, endEdit, setCellText,
    rebuild, rect, flow, setFlow, getFlowOn: () => flowOn,
    isEditing: () => ctx.editor.isCellEditing(),
    cursor: () => ({ r: S.a.r, c: S.a.c }),
    selection: () => S,
    tdOf,
  };
}

