import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, deleteItem, emptyKnowledgeBase, parseKnowledgeBase, updateItem, validateKnowledgeBase, writeKnowledgeBase } from './model.js';
import { renderMarkdown, renderResult, sectionSourceOffset } from './render.js';
import { createSnippetRuntime } from './runtime.js';
import { applySnippetEdit, findSnippetSpan } from './snippet-source.js';
import { attachStructuralEditor } from './structural-editor.js';
import { createEDNFileIO } from './files.js';

const snapshot = base => ({ 'open-ids': [...base.workspace['open-ids']], 'active-id': base.workspace['active-id'] });

export function createLoomApp({ document, window, base: initial = emptyKnowledgeBase(), saveFile, chooseFile, confirmReplace, confirmDelete } ) {
  let base = validateKnowledgeBase(initial);
  let dirty = false;
  const fileIO = createEDNFileIO({ window, document });
  saveFile ||= fileIO.save;
  chooseFile ||= fileIO.choose;
  confirmReplace ||= message => window.confirm(message);
  confirmDelete ||= message => window.confirm(message);
  const history = [snapshot(base)];
  let position = 0;
  const cards = new Map();
  const dependencies = new Map();
  const editingPreviews = new Map();
  const activeSnippets = new Map();
  let snippetRuntime = null;
  const workspace = document.querySelector('#workspace');
  const search = document.querySelector('#loom-search');
  const results = document.querySelector('#search-results');
  const status = document.querySelector('#loom-status');
  const backButton = document.querySelector('#history-back');
  const forwardButton = document.querySelector('#history-forward');

  function report(message = '') { status.textContent = message || `${base.items.length} items${dirty ? ' · Unsaved changes' : ''}`; }
  function itemFor(id) { return base.items.find(item => item.id === id); }
  function hasDraft() {
    for (const [id, card] of cards) {
      const item = itemFor(id);
      const form = card.querySelector('.item-form');
      if (form && (form.elements.title.value !== item.title || form.elements.body.value !== item.body
        || form.elements.tags.value.trim() !== item.tags.map(tag => tag.name).join(' '))) return true;
      const code = card.querySelector('.snippet-editor textarea');
      if (code && code.value !== code.dataset.original) return true;
    }
    return false;
  }
  function isDirty() { return dirty || hasDraft(); }

  function runtime() {
    if (!snippetRuntime) {
      const scittle = window.scittle || globalThis.scittle;
      snippetRuntime = createSnippetRuntime({ getItems: () => base.items, scittle, host: window.scittle ? window : globalThis });
    }
    return snippetRuntime;
  }

  function disposeSnippets(id) {
    for (const [output, subscription] of activeSnippets) if (subscription.itemId === id) activeSnippets.delete(output);
  }

  function runSnippet(itemId, { source, output, run }) {
    try {
      const { value, dependencies: reads } = runtime().run(source);
      const rendered = renderResult(value, { document, items: base.items, onNavigate: targetId => openItem(targetId) });
      output.replaceChildren(rendered);
      activeSnippets.set(output, { itemId, source, dependencies: reads, run });
      run.textContent = 'Run again';
    } catch (error) {
      activeSnippets.delete(output);
      const message = document.createElement('span'); message.className = 'render-error';
      message.setAttribute('role', 'alert'); message.textContent = `Snippet error: ${error.message}`;
      output.replaceChildren(message);
    }
  }

  function notifyItemChange(before, after) {
    const id = after?.id || before?.id;
    const oldTags = before?.tags.map(tag => tag.name) || [];
    const newTags = after?.tags.map(tag => tag.name) || [];
    const summaryChanged = !before || !after || before.title !== after.title || JSON.stringify(oldTags) !== JSON.stringify(newTags);
    for (const [output, subscription] of [...activeSnippets]) {
      const reads = subscription.dependencies;
      const affected = reads.has(`item:${id}`) || (summaryChanged && (reads.has('index')
        || [...reads].some(read => read.startsWith('tag:') && (oldTags.includes(read.slice(4)) || newTags.includes(read.slice(4))))));
      if (affected && output.isConnected) runSnippet(subscription.itemId, { source: subscription.source, output, run: subscription.run });
    }
  }

  function showItem(id, { preserveSnippets = false } = {}) {
    const card = cards.get(id);
    if (!card) return;
    const item = itemFor(id);
    card.querySelector('h2').textContent = item.title;
    card.querySelector('[data-action="close"]').setAttribute('aria-label', `Close ${item.title}`);
    const content = card.querySelector('.item-content');
    if (preserveSnippets && editingPreviews.has(id)) content.replaceChildren(editingPreviews.get(id));
    editingPreviews.delete(id);
    const oldSnippets = preserveSnippets ? [...content.querySelectorAll('.loom-snippet')] : [];
    if (!preserveSnippets) disposeSnippets(id);
    const reads = new Set();
    const rendered = renderMarkdown(item.body, {
      document, items: base.items, dependencies: reads,
      onNavigate: (targetId) => openItem(targetId),
      onEditSource: (targetId, section) => {
        if (!openItem(targetId)) return;
        editItem(targetId);
        const textarea = cards.get(targetId).querySelector('[name="body"]');
        const offset = sectionSourceOffset(itemFor(targetId).body, section);
        if (offset !== null) { textarea.focus(); textarea.setSelectionRange(offset, offset); }
      },
      onRun: snippet => runSnippet(id, snippet),
      onEditSnippet: snippet => editSnippet(id, snippet),
    });
    if (preserveSnippets) {
      const nextSnippets = [...rendered.querySelectorAll('.loom-snippet')];
      for (const [index, next] of nextSnippets.entries()) {
        const old = oldSnippets[index];
        if (old && old.querySelector('pre')?.textContent === next.querySelector('pre')?.textContent) next.replaceWith(old);
      }
    }
    dependencies.set(id, reads);
    content.replaceChildren(rendered);
  }

  function editItem(id) {
    const item = itemFor(id), card = cards.get(id);
    const content = card.querySelector('.item-content');
    const preview = document.createDocumentFragment(); preview.append(...content.childNodes);
    editingPreviews.set(id, preview);
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
    content.replaceChildren(form);
    form.querySelector('[name="title"]').focus();
  }

  function cancelEdit(id) {
    const preview = editingPreviews.get(id);
    if (preview) { cards.get(id).querySelector('.item-content').replaceChildren(preview); editingPreviews.delete(id); }
    else showItem(id);
  }

  function commitItemChanges(id, changes) {
    const before = itemFor(id);
    base = updateItem(base, id, changes);
    dirty = true; showItem(id, { preserveSnippets: before.body === itemFor(id).body });
    for (const [cardId, reads] of dependencies) {
      if (cardId !== id && reads.has(id) && !cards.get(cardId)?.querySelector('.item-form')) showItem(cardId, { preserveSnippets: true });
    }
    notifyItemChange(before, itemFor(id));
    refreshSearch(); report();
  }

  function editSnippet(id, { ordinal, node }) {
    if (node.querySelector('.snippet-editor')) return;
    const originalBody = itemFor(id).body;
    const span = findSnippetSpan(originalBody, ordinal);
    if (!span) { report('Unable to locate the snippet in Markdown source'); return; }
    const editor = document.createElement('div'); editor.className = 'snippet-editor';
    const label = document.createElement('label'); label.textContent = 'ClojureScript source';
    const textarea = document.createElement('textarea'); textarea.value = span.source;
    textarea.dataset.original = span.source;
    label.append(textarea);
    const feedback = document.createElement('p'); feedback.setAttribute('role', 'alert');
    const apply = document.createElement('button'); apply.type = 'button'; apply.dataset.action = 'apply-snippet'; apply.textContent = 'Apply code';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.dataset.action = 'cancel-snippet'; cancel.textContent = 'Cancel';
    editor.append(label, apply, cancel, feedback);
    const preview = node.querySelector('pre'); preview.hidden = true;
    node.append(editor);
    const detach = attachStructuralEditor(textarea, { onStatus: message => { feedback.textContent = message; } });
    cancel.addEventListener('click', () => { detach(); editor.remove(); preview.hidden = false; });
    apply.addEventListener('click', () => {
      try {
        const body = applySnippetEdit(originalBody, itemFor(id).body, span, textarea.value);
        detach(); commitItemChanges(id, { body });
      } catch (error) { feedback.textContent = error.message; }
    });
    textarea.focus();
  }

  function applyItem(id) {
    const form = cards.get(id).querySelector('.item-form');
    try {
      const tags = form.elements.tags.value.trim().split(/\s+/).filter(Boolean).map(name => keyword(name.replace(/^:/, '')));
      commitItemChanges(id, { title: form.elements.title.value, tags, body: form.elements.body.value });
    } catch (error) { report(error.message); }
  }

  function createCard(id) {
    const card = document.createElement('article');
    card.className = 'item-card'; card.dataset.itemId = id; card.tabIndex = -1;
    const head = document.createElement('header');
    const heading = document.createElement('h2');
    const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.action = 'edit'; edit.textContent = 'Edit';
    const close = document.createElement('button'); close.type = 'button'; close.dataset.action = 'close'; close.textContent = 'Close';
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.action = 'delete'; remove.textContent = 'Delete';
    head.append(heading, edit, close, remove);
    const content = document.createElement('div'); content.className = 'item-content';
    card.append(head, content);
    card.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'close') closeItem(id);
      else if (action === 'delete') deleteKnowledgeItem(id);
      else if (action === 'edit') editItem(id);
      else if (action === 'apply') applyItem(id);
      else if (action === 'cancel') cancelEdit(id);
      else if (!action) focusItem(id);
    });
    cards.set(id, card); showItem(id);
    return card;
  }

  function sync() {
    const ids = base.workspace['open-ids'];
    for (const [id, card] of cards) if (!ids.includes(id)) { card.remove(); cards.delete(id); dependencies.delete(id); editingPreviews.delete(id); disposeSnippets(id); }
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
    const restoreFocus = cards.get(id)?.contains(document.activeElement);
    const openIds = base.workspace['open-ids'].filter(openId => openId !== id);
    navigate({ 'open-ids': openIds, 'active-id': base.workspace['active-id'] === id ? openIds.at(-1) ?? null : base.workspace['active-id'] });
    if (restoreFocus) (cards.get(base.workspace['active-id']) || search).focus();
  }
  function deleteKnowledgeItem(id) {
    const item = itemFor(id);
    if (!item || !confirmDelete(`Delete "${item.title}" and its content?`)) return false;
    base = deleteItem(base, id); dirty = true;
    history.splice(position + 1); history.push(snapshot(base)); position++;
    sync();
    for (const [cardId, reads] of dependencies) {
      if (reads.has(id) && !cards.get(cardId)?.querySelector('.item-form')) showItem(cardId, { preserveSnippets: true });
    }
    notifyItemChange(item, null); refreshSearch(); report();
    return true;
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

  async function exportEDN() {
    if (hasDraft()) { report('Apply or cancel open drafts before saving'); return null; }
    const source = writeKnowledgeBase(base);
    try {
      if (!await saveFile(source, 'loom.edn')) return null;
      dirty = false; report('Knowledge base saved'); return source;
    } catch (error) { report(`Save failed: ${error.message}`); throw error; }
  }

  function importEDN(source) {
    let imported;
    try { imported = parseKnowledgeBase(source); }
    catch (error) { report(`Import failed: ${error.message}`); return false; }
    if (isDirty() && !confirmReplace('Replace the current knowledge base and discard unsaved changes?')) return false;
    for (const id of cards.keys()) disposeSnippets(id);
    cards.clear(); dependencies.clear(); editingPreviews.clear(); workspace.replaceChildren();
    base = imported; dirty = false;
    history.splice(0, history.length, snapshot(base)); position = 0;
    sync(); refreshSearch(); report('Knowledge base imported');
    return true;
  }

  document.querySelector('#new-item').addEventListener('click', () => {
    base = addItem(base, { title: 'Untitled item' }); dirty = true;
    notifyItemChange(null, base.items.at(-1));
    const id = base.items.at(-1).id; openItem(id); editItem(id);
  });
  backButton.addEventListener('click', () => travel(-1));
  forwardButton.addEventListener('click', () => travel(1));
  search.addEventListener('input', refreshSearch);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = results.querySelector('button');
      if (first) { event.preventDefault(); first.click(); }
    } else if (event.key === 'Escape') { search.value = ''; refreshSearch(); }
  });
  document.querySelector('#save-edn').addEventListener('click', () => { exportEDN().catch(() => {}); });
  document.querySelector('#import-edn').addEventListener('click', async () => {
    try { const file = await chooseFile(); if (file) importEDN(await file.text()); }
    catch (error) { report(`Import failed: ${error.message}`); }
  });
  window.addEventListener('beforeunload', event => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });
  sync(); document.querySelector('#loom-app').dataset.ready = 'true';
  return { getBase: () => base, isDirty, exportEDN, importEDN, openItem, focusItem, closeItem, deleteItem: deleteKnowledgeItem, back: () => travel(-1), forward: () => travel(1) };
}
