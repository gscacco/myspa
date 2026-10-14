/** Searchable in-app reference for ClojureScript functions, forms, and keywords. */

import { HELP_ENTRIES } from './help-content.js';
import { highlightClojureScript } from './editor-assistance.js';

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = element('textarea', { value: text });
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand?.('copy') || false;
  input.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard access is unavailable'));
}

export function createHelp(ctx) {
  const overlay = document.querySelector('#help-overlay');
  const dialog = overlay.querySelector('.help-dialog');
  const search = overlay.querySelector('[data-help-search]');
  const list = overlay.querySelector('[data-help-list]');
  const detail = overlay.querySelector('[data-help-detail]');
  const status = overlay.querySelector('[data-help-status]');
  let selected = HELP_ENTRIES[0];
  let visible = HELP_ENTRIES;

  function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function select(entry) {
    selected = entry;
    list.querySelectorAll('[data-help-id]').forEach(button => {
      const active = button.dataset.helpId === entry.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
    const example = element('code');
    example.innerHTML = highlightClojureScript(entry.example, { declarationCode: ctx.editor.value() });
    detail.replaceChildren(
      element('div', { class: 'help-entry-category', text: entry.category }),
      element('h2', { text: entry.name }),
      element('code', { class: 'help-signature', text: entry.signature }),
      element('p', { class: 'help-description', text: entry.description }),
      element('pre', { class: 'help-example', 'aria-label': 'ClojureScript example' },
        example),
    );
    showStatus(`${visible.length} voci · esempio selezionato: ${entry.name}`);
  }

  function renderList() {
    const term = search.value.trim().toLocaleLowerCase();
    visible = HELP_ENTRIES.filter(entry => !term
      || `${entry.name} ${entry.signature} ${entry.category} ${entry.description}`.toLocaleLowerCase().includes(term));
    if (!visible.some(entry => entry.id === selected.id)) selected = visible[0] || null;
    const groups = new Map();
    for (const entry of visible) {
      if (!groups.has(entry.category)) groups.set(entry.category, []);
      groups.get(entry.category).push(entry);
    }
    list.replaceChildren();
    for (const [category, entries] of groups) {
      list.append(element('h3', { text: category }));
      for (const entry of entries) {
        list.append(element('button', {
          type: 'button', class: 'help-entry-button', 'data-help-id': entry.id,
          'aria-current': entry.id === selected?.id ? 'true' : 'false',
          onclick: () => select(entry),
        }, element('span', { text: entry.name }), element('small', { text: entry.signature })));
      }
    }
    if (!selected) {
      detail.replaceChildren(element('p', { class: 'help-empty', text: 'Nessuna voce corrisponde alla ricerca.' }));
      showStatus('Nessun risultato');
      return;
    }
    select(selected);
  }

  function open() {
    overlay.hidden = false;
    renderList();
    search.focus();
  }

  function close() {
    overlay.hidden = true;
    document.querySelector('[data-action="help"]').focus();
  }

  function insertExample() {
    if (!selected) return;
    if (!ctx.editor.insertText(selected.example)) {
      showStatus('Chiudi prima la modifica di una cella per inserire l’esempio.', true);
      return;
    }
    close();
    ctx.editor.note(`Esempio di ${selected.name} inserito nell’editor. Valutalo con Ctrl+Invio o applica il codice.`);
  }

  function mount() {
    document.querySelector('[data-action="help"]').addEventListener('click', open);
    overlay.querySelector('[data-help-close]').addEventListener('click', close);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
    search.addEventListener('input', renderList);
    overlay.querySelector('[data-help-copy]').addEventListener('click', () => {
      if (!selected) return;
      copyText(selected.example)
        .then(() => showStatus(`Esempio di ${selected.name} copiato.`))
        .catch(error => showStatus(error.message, true));
    });
    overlay.querySelector('[data-help-insert]').addEventListener('click', insertExample);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)
        || (event.target !== search && !event.target.matches('[data-help-id]'))) return;
      const current = visible.findIndex(entry => entry.id === selected?.id);
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const next = visible[(current + offset + visible.length) % visible.length];
      if (next) {
        event.preventDefault();
        select(next);
        [...list.querySelectorAll('[data-help-id]')].find(button => button.dataset.helpId === next.id)?.focus();
      }
    });
  }

  return { mount, open, close };
}
