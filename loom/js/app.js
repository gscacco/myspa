import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, emptyKnowledgeBase, updateItem, validateKnowledgeBase } from './model.js';

const snapshot = base => ({ 'open-ids': [...base.workspace['open-ids']], 'active-id': base.workspace['active-id'] });

export function createLoomApp({ document, window, base: initial = emptyKnowledgeBase() }) {
  let base = validateKnowledgeBase(initial);
  let dirty = false;
  const history = [snapshot(base)];
  let position = 0;
  const cards = new Map();
  const workspace = document.querySelector('#workspace');
  const search = document.querySelector('#loom-search');
  const results = document.querySelector('#search-results');
  const status = document.querySelector('#loom-status');
  const backButton = document.querySelector('#history-back');
  const forwardButton = document.querySelector('#history-forward');

  function report(message = '') { status.textContent = message || `${base.items.length} items${dirty ? ' · Unsaved changes' : ''}`; }
  function itemFor(id) { return base.items.find(item => item.id === id); }

  function showItem(id) {
    const card = cards.get(id);
    if (!card) return;
    const item = itemFor(id);
    card.querySelector('h2').textContent = item.title;
    card.querySelector('[data-action="close"]').setAttribute('aria-label', `Close ${item.title}`);
    const source = document.createElement('pre'); source.textContent = item.body;
    card.querySelector('.item-content').replaceChildren(source);
  }

  function editItem(id) {
    const item = itemFor(id), card = cards.get(id);
    const form = document.createElement('form'); form.className = 'item-form';
    for (const [name, label, tag, value] of [
      ['title', 'Title', 'input', item.title],
      ['tags', 'Tags (space-separated keywords)', 'input', item.tags.map(tag => tag.name).join(' ')],
      ['body', 'Markdown', 'textarea', item.body],
    ]) {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement(tag); input.name = name; input.value = value;
      field.append(input); form.append(field);
    }
    for (const [action, label] of [['apply', 'Apply'], ['cancel', 'Cancel']]) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.action = action; button.textContent = label; form.append(button);
    }
    card.querySelector('.item-content').replaceChildren(form);
    form.querySelector('[name="title"]').focus();
  }

  function applyItem(id) {
    const form = cards.get(id).querySelector('.item-form');
    try {
      const tags = form.elements.tags.value.trim().split(/\s+/).filter(Boolean).map(name => keyword(name.replace(/^:/, '')));
      base = updateItem(base, id, { title: form.elements.title.value, tags, body: form.elements.body.value });
      dirty = true; showItem(id); refreshSearch(); report();
    } catch (error) { report(error.message); }
  }

  function createCard(id) {
    const card = document.createElement('article');
    card.className = 'item-card'; card.dataset.itemId = id; card.tabIndex = -1;
    const head = document.createElement('header');
    const heading = document.createElement('h2');
    const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit';
    const close = document.createElement('button'); close.type = 'button'; close.dataset.action = 'close'; close.textContent = 'Close';
    head.append(heading, edit, close);
    const content = document.createElement('div'); content.className = 'item-content';
    card.append(head, content);
    card.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'close') closeItem(id);
      else if (action === 'edit') editItem(id);
      else if (action === 'apply') applyItem(id);
      else if (action === 'cancel') showItem(id);
      else if (!action) focusItem(id);
    });
    cards.set(id, card); showItem(id);
    return card;
  }

  function sync() {
    const ids = base.workspace['open-ids'];
    for (const [id, card] of cards) if (!ids.includes(id)) { card.remove(); cards.delete(id); }
    workspace.querySelector('.workspace-empty')?.remove();
    for (const [index, id] of ids.entries()) {
      const card = cards.get(id) || createCard(id);
      if (workspace.children[index] !== card) workspace.insertBefore(card, workspace.children[index] || null);
      card.classList.toggle('active', id === base.workspace['active-id']);
    }
    if (!ids.length) {
      const empty = document.createElement('p'); empty.className = 'workspace-empty';
      empty.textContent = 'Open an item from search or create a new one.';
      workspace.replaceChildren(empty);
    }
    backButton.disabled = position === 0;
    forwardButton.disabled = position === history.length - 1;
    report();
  }

  function navigate(next) {
    if (JSON.stringify(base.workspace) === JSON.stringify(next)) return;
    base = { ...base, workspace: next };
    history.splice(position + 1); history.push(snapshot(base)); position++;
    dirty = true; sync();
  }

  function openItem(id) {
    if (!itemFor(id)) { report(`Missing item: ${id}`); return false; }
    const openIds = [...base.workspace['open-ids']];
    if (!openIds.includes(id)) openIds.push(id);
    navigate({ 'open-ids': openIds, 'active-id': id });
    return true;
  }
  function focusItem(id) { return openItem(id); }
  function closeItem(id) {
    if (!base.workspace['open-ids'].includes(id)) return;
    const openIds = base.workspace['open-ids'].filter(openId => openId !== id);
    navigate({ 'open-ids': openIds, 'active-id': base.workspace['active-id'] === id ? openIds.at(-1) ?? null : base.workspace['active-id'] });
  }
  function travel(delta) {
    if (position + delta < 0 || position + delta >= history.length) return;
    position += delta;
    const state = history[position], openIds = state['open-ids'].filter(id => itemFor(id));
    base = { ...base, workspace: { 'open-ids': openIds, 'active-id': openIds.includes(state['active-id']) ? state['active-id'] : openIds.at(-1) ?? null } };
    sync();
  }

  function refreshSearch() {
    const query = search.value.trim().toLocaleLowerCase(); results.replaceChildren();
    if (!query) return;
    const matches = base.items.filter(item => `${item.title} ${item.body} ${item.tags.map(tag => tag.name).join(' ')}`.toLocaleLowerCase().includes(query)).slice(0, 30);
    if (!matches.length) { results.textContent = 'No matching items'; return; }
    for (const item of matches) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.title;
      button.addEventListener('click', () => openItem(item.id)); results.append(button);
    }
  }

  document.querySelector('#new-item').addEventListener('click', () => {
    base = addItem(base, { title: 'Untitled item' }); dirty = true;
    const id = base.items.at(-1).id; openItem(id); editItem(id);
  });
  backButton.addEventListener('click', () => travel(-1));
  forwardButton.addEventListener('click', () => travel(1));
  search.addEventListener('input', refreshSearch);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  sync(); document.querySelector('#loom-app').dataset.ready = 'true';
  return { getBase: () => base, openItem, focusItem, closeItem, back: () => travel(-1), forward: () => travel(1) };
}
