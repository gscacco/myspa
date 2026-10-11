/**
 * grid.js — Rendering della griglia e interazione con l'utente.
 *
 * Dipende dal DOM, dal modello e dal motore (tramite la sessione). Non contiene
 * logica di calcolo: chiede alla sessione di eseguire le operazioni e ridisegna
 * i nodi restituiti.
 */

import { ROWS, COLS, sheetByName } from './model.js';
import { colName, addr, parseRef } from './references.js';
import { PAIRS, CLOSERS, safeDeletion, indentFor, pareditNewline, pareditSlurp, pareditBarf, pareditSplice, pareditWrap } from './editor-assistance.js';

/**
 * Crea la vista della griglia.
 * @param {object} ctx contesto applicativo con `session`, `currentSheet()`,
 *   `updateStatus()`
 */
export function createGrid(ctx) {
  const Q = s => document.querySelector(s);
  const G = Q('#g');
  const ed = Q('#ed');
  const tdOf = (r, c) => G.rows[r + 1]?.cells[c + 1];

  let S = { a: { r: 0, c: 0 }, f: { r: 0, c: 0 } };
  let drag = 0;
  let flowOn = true;

  const sheet = () => ctx.currentSheet();
  const rect = () => ({ r0: Math.min(S.a.r, S.f.r), r1: Math.max(S.a.r, S.f.r), c0: Math.min(S.a.c, S.f.c), c1: Math.max(S.a.c, S.f.c) });

  /** Testo mostrato per un nodo, in base al formato della cella. */
  function disp(n, f) {
    if (n.err) return n.err.message.startsWith('#') ? n.err.message.split(':')[0] : '#ERR';
    const v = n.val;
    if (v === null) return '';
    if (typeof v === 'number') return f.d != null ? v.toFixed(f.d) : String(+v.toPrecision(12));
    return Array.isArray(v) ? '[' + v.flat(Infinity).length + ']' : String(v);
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
    let h = '<tr><th></th>' + [...Array(COLS)].map((_, c) => '<th>' + colName(c) + '</th>').join('') + '</tr>';
    for (let r = 0; r < ROWS; r++) h += '<tr><th>' + (r + 1) + '</th>' + '<td></td>'.repeat(COLS) + '</tr>';
    G.innerHTML = h;
    Object.keys(sheet().cells).forEach(a => paintCell(ctx.session.engine.nd(sheet().name + '!' + a)));
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
    ed.dataset.formula = String(isFormula);
    ed.value = isFormula ? source.slice(1) : source;
    Q('#formula-pop-title').textContent = 'Formula · ' + addr(r, c);
    ed.hidden = false;
    Q('#formula-pop').hidden = false;
    ed.focus();
  }

  /** Converte il testo dell'editor flottante nel valore memorizzato nella cella. */
  function editedCellText() {
    let source = ed.value;
    const isFormula = ed.dataset.formula === 'true' || /^\s*\(/.test(source);
    if (!isFormula) return source;
    if (source.startsWith('=')) source = source.slice(1);
    return source.trim() ? '=' + source : '';
  }

  /** Chiude l'editor inline, salvando (`ok`) ed eventualmente spostando la selezione. */
  function endEdit(ok, mv) {
    if (ed.hidden) return;
    ed.hidden = true;
    Q('#formula-pop').hidden = true;
    if (ok) setCellText(S.a.r, S.a.c, editedCellText());
    mv ? sel(S.a.r + mv[0], S.a.c + mv[1]) : showCell();
  }

  /** Ricostruisce grafo e griglia (usato dopo cambio workbook/foglio). */
  function rebuild() {
    ctx.session.rebuild();
    render();
    showCell();
  }

  function setFlow(on) { flowOn = !!on; flow(); }

  /** Collega gli eventi di editing (editor inline e barra della formula). */
  function mount() {
    Q('#formula-pop-close').addEventListener('click', () => endEdit(1));
    ed.addEventListener('keydown', e => {
      const v = ed.value, a = ed.selectionStart, b = ed.selectionEnd, m = e.ctrlKey || e.metaKey;
      if (e.key === '=' && !m && !e.altKey && !v && a === 0 && b === 0) {
        e.preventDefault();
        ed.dataset.formula = 'true';
        return;
      }
      const structures = {
        ArrowRight: () => pareditSlurp(v, a),
        ArrowLeft: () => pareditBarf(v, a),
        ArrowUp: () => pareditSplice(v, a),
        ArrowDown: () => pareditWrap(v, a, b),
      };
      if (m && structures[e.key]) {
        e.preventDefault();
        const r = structures[e.key]();
        if (r) {
          ed.setRangeText(r.text, r.from, r.to, 'end');
          if (r.caret != null) ed.setSelectionRange(r.caret, r.selEnd != null ? r.selEnd : r.caret);
        }
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const empty = a === b;
        if (e.key === 'Backspace' && empty && PAIRS[v[a - 1]] && PAIRS[v[a - 1]] === v[a]) {
          e.preventDefault();
          ed.setRangeText('', a - 1, a + 1, 'end');
          return;
        }
        const from = empty ? (e.key === 'Backspace' ? a - 1 : a) : a;
        const to = empty ? (e.key === 'Backspace' ? a : a + 1) : b;
        if (from >= 0 && to > from && !safeDeletion(v, from, to)) e.preventDefault();
        return;
      }
      if (m || e.altKey || e.key.length !== 1) return;
      if (CLOSERS.has(e.key) && v[a] === e.key && a === b) {
        e.preventDefault();
        ed.setSelectionRange(a + 1, a + 1);
        return;
      }
      if (!PAIRS[e.key]) return;
      if (a !== b) {
        e.preventDefault();
        ed.setRangeText(e.key + v.slice(a, b) + PAIRS[e.key], a, b, 'end');
        ed.setSelectionRange(a + 1, b + 1);
        return;
      }
      if (!/[({\[]/.test(e.key) && /\w/.test(v[a - 1] || '')) return;
      e.preventDefault();
      ed.setRangeText(e.key + PAIRS[e.key], a, b, 'end');
      ed.setSelectionRange(a + 1, a + 1);
    });
    ed.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { endEdit(1); return; }
        const v = ed.value, a = ed.selectionStart, b = ed.selectionEnd;
        const r = a === b
          ? pareditNewline(v, a)
          : { from: a, to: b, text: '\n' + ' '.repeat(indentFor(v, a)), caret: a + 1 + indentFor(v, a) };
        ed.setRangeText(r.text, r.from, r.to, 'end');
        ed.setSelectionRange(r.caret, r.caret);
      }
      else if (e.key === 'Tab') e.preventDefault();
    });
    Q('#fx').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); setCellText(S.a.r, S.a.c, e.target.value); e.target.blur(); }
      else if (e.key === 'Escape') { showCell(); e.target.blur(); }
    });
    G.addEventListener('mousedown', e => {
      const td = e.target.closest('td');
      if (!td) return;
      const r = td.parentNode.rowIndex - 1, c = td.cellIndex - 1;
      if (!ed.hidden) {
        const v = ed.value, p = ed.selectionStart;
        const prefix = v.slice(0, p);
        const pendingCljsHead = /^\s*\(\s*[A-Za-z_*+!?][\w*+!?<>=./-]*\s*$/.test(prefix);
        const formulaMode = ed.dataset.formula === 'true' || /^\s*\(/.test(v);
        if (formulaMode && (/[=+\-*/(,<>&|?:!%^]$/.test(prefix) || pendingCljsHead)) {
          e.preventDefault();
          ed.dataset.formula = 'true';
          ed.setRangeText((pendingCljsHead && !/\s$/.test(prefix) ? ' ' : '') + addr(r, c), p, ed.selectionEnd, 'end');
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
    G.addEventListener('mouseover', e => { if (!drag) return; const td = e.target.closest('td'); if (td) { S.f = { r: td.parentNode.rowIndex - 1, c: td.cellIndex - 1 }; showCell(); } });
    G.addEventListener('dblclick', e => { if (e.target.closest('td')) edit(); });
    window.addEventListener('mouseup', () => drag = 0);
  }

  return {
    mount, render, paint, paintAddresses, showCell, sel, edit, endEdit, setCellText,
    rebuild, rect, flow, setFlow, getFlowOn: () => flowOn,
    isEditing: () => !ed.hidden,
    cursor: () => ({ r: S.a.r, c: S.a.c }),
    selection: () => S,
    tdOf,
  };
}

