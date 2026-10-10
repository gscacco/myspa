import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountApp, fakeClipboardEvent } from '../helpers/dom.js';

/** Scorciatoia: cella (r,c) a base 0. */
const cell = (document, r, c) => document.querySelector('#g').rows[r + 1].cells[c + 1];
const mouse = (window, type, el) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
const key = (window, el, init) => el.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }));

test('avvio: la griglia è costruita e i valori sono calcolati', async () => {
  const { document, close } = await mountApp();
  const G = document.querySelector('#g');
  assert.equal(G.rows.length, 101);
  assert.equal(G.rows[0].cells.length, 27);
  assert.equal(G.rows[0].cells[1].textContent, 'A');
  assert.equal(G.rows[0].cells[26].textContent, 'Z');
  assert.equal(G.rows[1].cells[1].textContent, 'Prodotto');
  assert.equal(cell(document, 1, 1).textContent, '1.50');
  assert.equal(cell(document, 1, 3).textContent, '150.00');
  assert.equal(cell(document, 1, 4).textContent, '183.00');
  assert.equal(cell(document, 5, 3).textContent, '843.80');
  assert.equal(cell(document, 5, 4).textContent, '1029.44');
  assert.equal(cell(document, 8, 3).textContent, 'Bassa');
  close();
});

test('avvio: barra, schede, editor e stato', async () => {
  const { document, close } = await mountApp();
  assert.equal(document.querySelector('#stat').textContent, 'Foglio di calcolo');
  assert.equal(document.querySelector('#nb').value, 'A1');
  assert.equal(document.querySelector('#fx').value, 'Prodotto');
  assert.equal(document.querySelectorAll('#tabs button').length, 4);
  assert.equal(document.querySelector('#tabs button').textContent, 'Foglio1');
  assert.ok(document.querySelector('#code').value.includes('CONIVA'));
  assert.ok(document.querySelector('#hl').innerHTML.includes('class="u"'));
  assert.equal(document.querySelector('#ed').hidden, true);
  close();
});

test('la selezione aggiorna il riquadro dei riferimenti', async () => {
  const { document, close } = await mountApp();
  mouse(document.defaultView, 'mousedown', cell(document, 5, 3));
  assert.equal(document.querySelector('#nb').value, 'D6');
  assert.equal(document.querySelector('#fx').value, '=SUM(D2:D5)');
  close();
});

test('modifica inline con doppio clic e Invio', async () => {
  const { document, window, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 1, 2));
  mouse(window, 'dblclick', cell(document, 1, 2));
  const ed = document.querySelector('#ed');
  assert.equal(ed.hidden, false);
  ed.value = '=1+1';
  key(window, ed, { key: 'Enter' });
  assert.equal(ed.hidden, true);
  assert.equal(cell(document, 1, 2).textContent, '2');
  assert.equal(cell(document, 1, 3).textContent, '3.00');
  assert.equal(document.querySelector('#nb').value, 'C3');
  close();
});

test('modifica dalla barra della formula', async () => {
  const { document, window, close } = await mountApp();
  const fx = document.querySelector('#fx');
  fx.value = '7';
  key(window, fx, { key: 'Enter' });
  assert.equal(cell(document, 0, 0).textContent, '7');
  close();
});

test('navigazione da tastiera e selezione estesa', async () => {
  const { document, window, close } = await mountApp();
  key(window, window, { key: 'ArrowDown' });
  assert.equal(document.querySelector('#nb').value, 'A2');
  key(window, window, { key: 'ArrowRight' });
  assert.equal(document.querySelector('#nb').value, 'B2');
  key(window, window, { key: 'ArrowDown', shiftKey: true });
  assert.equal(document.querySelector('#nb').value, 'B2');
  assert.equal(document.querySelector('#vv').textContent, '');
  close();
});

test('grassetto, decimali e sfondo dalla barra strumenti', async () => {
  const { document, window, close } = await mountApp();
  // B2 è una cella numerica senza grassetto né sfondo: si usa per verificare
  // che la barra strumenti applichi le formattazioni.
  mouse(window, 'mousedown', cell(document, 1, 1));
  mouse(window, 'click', document.querySelector('[data-action="toggle-bold"]'));
  assert.equal(cell(document, 1, 1).style.fontWeight, '700');
  mouse(window, 'click', document.querySelector('[data-action="dec-plus"]'));
  assert.equal(cell(document, 1, 1).textContent, '1.500');
  const color = document.querySelector('[data-action="bg-color"]');
  color.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.notEqual(cell(document, 1, 1).style.background, '');
  mouse(window, 'click', document.querySelector('[data-action="bg-clear"]'));
  assert.equal(cell(document, 1, 1).style.background, '');
  close();
});

test('cancella con Delete e annulla con Ctrl+Z', async () => {
  const { document, window, app, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 0, 0));
  key(window, window, { key: 'Delete' });
  assert.equal(cell(document, 0, 0).textContent, '');
  assert.equal(document.querySelector('#stat').textContent, '● modificato · Foglio di calcolo');
  key(window, window, { code: 'KeyZ', key: 'z', ctrlKey: true });
  assert.equal(cell(document, 0, 0).textContent, 'Prodotto');
  assert.equal(app.session.getHistorySize(), 0);
  close();
});

test('copia e incolla con appunti interni', async () => {
  const { document, app, close } = await mountApp();
  app.grid.sel(0, 0);
  const e1 = fakeClipboardEvent(document.body);
  app.commands.cp(e1, 0);
  assert.equal(e1.store['text/plain'], 'Prodotto');
  app.grid.sel(6, 2);
  const e2 = fakeClipboardEvent(document.body);
  e2.clipboardData.setData('text/plain', e1.store['text/plain']);
  app.commands.paste(e2);
  assert.equal(cell(document, 6, 2).textContent, 'Prodotto');
  close();
});

test('aggiunta e selezione di fogli tramite le schede', async () => {
  const { document, window, close } = await mountApp();
  const plus = () => [...document.querySelectorAll('#tabs button')].find(b => b.textContent === '＋');
  mouse(window, 'click', plus());
  assert.equal(document.querySelectorAll('#tabs button').length, 5);
  assert.equal(document.querySelector('#tabs button.on').textContent, 'Foglio3');
  assert.equal(cell(document, 0, 0).textContent, '');
  mouse(window, 'click', document.querySelector('#tabs button'));
  assert.equal(document.querySelector('#tabs button.on').textContent, 'Foglio1');
  assert.equal(cell(document, 0, 0).textContent, 'Prodotto');
  close();
});

test('applicazione del codice ClojureScript dall\'editor', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn TRIPLO [x] (* x 3))';
  mouse(window, 'click', document.querySelector('[data-action="apply-code"]'));
  app.grid.setCellText(0, 8, '=TRIPLO(4)');
  assert.equal(cell(document, 0, 8).textContent, '12');
  close();
});

test('un errore nell\'editor non compromette le funzioni incorporate', async () => {
  const { document, window, app, close } = await mountApp();
  document.querySelector('#code').value = '(defn rotto [x]';
  mouse(window, 'click', document.querySelector('[data-action="apply-code"]'));
  assert.match(document.querySelector('#fe').textContent, /Riga/);
  app.grid.setCellText(0, 8, '=SUM(1,2,3)');
  assert.equal(cell(document, 0, 8).textContent, '6');
  close();
});

test('l\'editor applica paredit (slurp/barf) con Ctrl+frecce', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  ta.value = '(a b) c';
  ta.setSelectionRange(4, 4);
  key(window, ta, { key: 'ArrowRight', ctrlKey: true });
  assert.equal(ta.value, '(a b c)');
  key(window, ta, { key: 'ArrowLeft', ctrlKey: true });
  assert.equal(ta.value, '(a b) c');
  // Attende il controllo sintattico differito dell'editor prima di chiudere il DOM.
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('il pannello delle funzioni si apre e si chiude', async () => {
  const { document, window, close } = await mountApp();
  const panel = document.querySelector('#fn');
  assert.equal(panel.hidden, true);
  mouse(window, 'click', document.querySelector('[data-action="toggle-functions"]'));
  assert.equal(panel.hidden, false);
  assert.equal(document.querySelector('#bfn').classList.contains('on'), true);
  close();
});

test('l\'interruttore del flusso evidenzia sorgenti e dipendenti', async () => {
  const { document, window, close } = await mountApp();
  mouse(window, 'mousedown', cell(document, 5, 3));
  assert.ok(document.querySelectorAll('#g td.pre').length > 0);
  mouse(window, 'click', document.querySelector('[data-action="toggle-flow"]'));
  assert.equal(document.querySelectorAll('#g td.pre').length, 0);
  close();
});

test('i pulsanti paredit eseguono slurp, barf e splice', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const btn = a => document.querySelector('[data-action="' + a + '"]');
  const esegui = (action, valore, cursore, atteso) => {
    ta.value = valore;
    ta.setSelectionRange(cursore, cursore);
    mouse(window, 'mousedown', btn(action));
    assert.equal(ta.value, atteso, action);
  };
  esegui('paredit-slurp', '(a b) c', 5, '(a b c)');       // cursore subito dopo la «)»
  esegui('paredit-barf', '(a b c)', 7, '(a b) c');
  esegui('paredit-splice', '(a b) c', 5, 'a b c');
  assert.match(document.querySelector('#note').textContent, /^✓ Splice/, 'la nota conferma il comando');
  // wrap avvolge la selezione
  ta.value = 'a b';
  ta.setSelectionRange(0, 3);
  mouse(window, 'mousedown', btn('paredit-wrap'));
  assert.equal(ta.value, '(a b)');
  // un comando non applicabile non cambia il testo e spiega perché
  ta.value = 'a b';
  ta.setSelectionRange(1, 1);
  mouse(window, 'mousedown', btn('paredit-splice'));
  assert.equal(ta.value, 'a b');
  assert.match(document.querySelector('#note').textContent, /nessuna lista/);
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('paredit: Backspace e Delete non sbilanciano le parentesi', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const premi = init => {
    const ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    ta.dispatchEvent(ev);
    return ev;
  };
  ta.value = '(a b)';
  ta.setSelectionRange(1, 1);
  assert.equal(premi({ key: 'Backspace' }).defaultPrevented, true, 'la «(» è protetta');
  assert.match(document.querySelector('#note').textContent, /sbilancerebbe/);
  ta.setSelectionRange(5, 5);
  assert.equal(premi({ key: 'Backspace' }).defaultPrevented, true, 'la «)» è protetta');
  ta.setSelectionRange(2, 2);
  assert.equal(premi({ key: 'Backspace' }).defaultPrevented, false, 'il testo si cancella normalmente');
  ta.setSelectionRange(1, 1);
  assert.equal(premi({ key: 'Delete' }).defaultPrevented, false, 'Delete su un carattere normale');
  ta.setSelectionRange(0, 5);
  assert.equal(premi({ key: 'Delete' }).defaultPrevented, false, 'una lista intera resta bilanciata');
  ta.value = '(a b';
  ta.setSelectionRange(0, 4);
  assert.equal(premi({ key: 'Delete' }).defaultPrevented, true, 'una selezione tagliata a metà è protetta');
  // la coppia vuota si cancella tutta insieme
  ta.value = '()';
  ta.setSelectionRange(1, 1);
  premi({ key: 'Backspace' });
  assert.equal(ta.value, '');
  await new Promise(r => setTimeout(r, 450));
  close();
});

test('Ctrl+Invio valuta la forma prima del cursore (C-x C-e)', async () => {
  const { document, window, app, close } = await mountApp();
  const ta = document.querySelector('#code');
  const valuta = testo => {
    ta.value = testo;
    ta.setSelectionRange(testo.length, testo.length);
    key(window, ta, { key: 'Enter', ctrlKey: true });
  };
  valuta('(defn TRIPLO [x] (* x 3))');
  app.grid.setCellText(0, 8, '=TRIPLO(4)');
  assert.equal(cell(document, 0, 8).textContent, '12');
  assert.match(document.querySelector('#note').textContent, /TRIPLO/);
  // ridefinire la funzione aggiorna le formule che la usano
  valuta('(defn TRIPLO [x] (* x 10))');
  assert.equal(cell(document, 0, 8).textContent, '40');
  // le altre definizioni del modello restano attive
  app.grid.setCellText(0, 9, '=CONIVA(1)');
  assert.equal(app.session.engine.evaluate('Foglio1!J1'), 1 + 0.22);
  // senza una forma prima del cursore si applica tutto l'editor
  ta.value = '   ';
  ta.setSelectionRange(3, 3);
  key(window, ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /applicato/);
  close();
});

test('Ctrl+Invio segnala l’errore di una forma non valutabile', async () => {
  const { document, window, close } = await mountApp();
  const ta = document.querySelector('#code');
  const form = '(chiave 1)';
  ta.value = form;
  ta.setSelectionRange(form.length, form.length);
  key(window, ta, { key: 'Enter', ctrlKey: true });
  assert.match(document.querySelector('#note').textContent, /^✗/);
  assert.match(document.querySelector('#fe').textContent, /chiave/);
  close();
});


