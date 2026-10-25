import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, deleteItem, emptyKnowledgeBase, parseKnowledgeBase, updateItem, validateKnowledgeBase, writeKnowledgeBase } from './model.js';
import { renderMarkdown, renderResult, sectionSourceOffset } from './render.js';
import { createSnippetRuntime } from './runtime.js';
import { applySnippetEdit, findSnippetSpan } from './snippet-source.js';
import { attachStructuralEditor } from './structural-editor.js';
import { createEDNFileIO } from './files.js';
import { readLocalKnowledgeBase, writeLocalKnowledgeBase } from './local-store.js';
import { searchItems } from './item-search.js';
import { attachLinkCompletion } from './link-completion.js';

const snapshot = base => ({ 'open-ids': [...base.workspace['open-ids']], 'active-id': base.workspace['active-id'] });
const ACTION_ICONS = {
  apply: 'M5 12l4 4L19 6',
  cancel: 'M9 7L4 12l5 5M4 12h10a6 6 0 010 12',
  close: 'M6 6l12 12M18 6L6 18',
  delete: 'M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13',
  edit: 'M4 20h4L18 10l-4-4L4 16v4zM13 7l4 4',
};

export function createLoomApp({ document, window, base: initial = emptyKnowledgeBase(), saveFile, chooseFile, confirmReplace, confirmDelete, storage = null } ) {
  let base = validateKnowledgeBase(readLocalKnowledgeBase(storage) ?? initial);
  let dirty = false;
  let localSaveFailed = false;
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
  let openOrder = [...base.workspace['open-ids']];
  let uiActiveId = base.workspace['active-id'];
  let draftSequence = 0;
  let newDraft = null;

  function report(message = '') {
    const suffix = newDraft || hasDraft() ? ' · Unsaved draft'
      : !storage ? (dirty ? ' · Unsaved changes' : '')
        : localSaveFailed ? ' · Local save failed' : ' · Saved locally';
    status.textContent = message || `${base.items.length} items${suffix}`;
  }
  function isDraft(id) { return newDraft?.id === id; }
  function itemFor(id) { return isDraft(id) ? newDraft.item : base.items.find(item => item.id === id); }
  function hasDraft() {
    for (const [id, card] of cards) {
      const item = itemFor(id);
      if (!item) continue;
      const form = card.querySelector('.item-form');
      if (form && (form.elements.title.value !== item.title || form.elements.body.value !== item.body
        || form.elements.tags.value.trim() !== item.tags.map(tag => tag.name).join(' '))) return true;
      for (const code of card.querySelectorAll('.snippet-editor textarea')) {
        if (code.value !== code.dataset.original) return true;
      }
    }
    return false;
  }
  function isDirty() { return dirty || newDraft !== null || hasDraft(); }

  function persistLocal() {
    if (!storage) return false;
    localSaveFailed = !writeLocalKnowledgeBase(storage, base);
    return !localSaveFailed;
  }

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', ACTION_ICONS[name]); svg.append(path);
    return svg;
  }

  function actionButton(action, label, itemTitle, { danger = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = action; button.className = 'icon-button';
    if (danger) button.classList.add('danger');
    button.title = label; button.setAttribute('aria-label', `${label}: ${itemTitle}`);
    button.append(icon(action));
    return button;
  }

  function setActions(card, id, editing) {
    const item = itemFor(id), actions = card.querySelector('.card-actions');
    if (!item || !actions) return;
    actions.replaceChildren();
    const definitions = editing
      ? [['apply', 'Apply'], ['cancel', 'Cancel Changes'], ['delete', 'Delete']]
      : [['edit', 'Edit'], ['close', 'Close'], ['delete', 'Delete']];
    for (const [action, label] of definitions) {
      actions.append(actionButton(action, label, item.title, { danger: action === 'delete' }));
    }
  }

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
    setActions(card, id, false);
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
    form.addEventListener('submit', event => { event.preventDefault(); applyItem(id); });
    attachLinkCompletion(form.elements.body, { getItems: () => base.items });
    content.replaceChildren(form);
    setActions(card, id, true);
    form.querySelector('[name="title"]').focus();
  }

  function cancelEdit(id) {
    if (isDraft(id)) { discardDraft(); return; }
    const preview = editingPreviews.get(id);
    if (preview) {
      const card = cards.get(id);
      card.querySelector('.item-content').replaceChildren(preview); editingPreviews.delete(id);
      setActions(card, id, false);
    }
    else showItem(id);
  }

  function commitItemChanges(id, changes) {
    const before = itemFor(id);
    base = updateItem(base, id, changes);
    dirty = true; persistLocal(); showItem(id, { preserveSnippets: before.body === itemFor(id).body });
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
      const changes = { title: form.elements.title.value, tags, body: form.elements.body.value };
      if (isDraft(id)) applyDraft(changes);
      else commitItemChanges(id, changes);
    } catch (error) { report(error.message); }
  }

  function applyDraft(changes) {
    const draftId = newDraft.id;
    base = addItem(base, changes);
    const created = base.items.at(-1);
    newDraft = null;
    openOrder = openOrder.map(id => id === draftId ? created.id : id);
    uiActiveId = created.id; dirty = true;
    persistWorkspace(); persistLocal();
    history.splice(position + 1); history.push(snapshot(base)); position++;
    sync(); refreshSearch(); notifyItemChange(null, created); report();
    cards.get(created.id)?.focus();
  }

  function discardDraft() {
    if (!newDraft) return;
    const draftId = newDraft.id;
    newDraft = null;
    openOrder = openOrder.filter(id => id !== draftId);
    if (uiActiveId === draftId) uiActiveId = openOrder[0] ?? null;
    sync(); refreshSearch(); report();
    (cards.get(uiActiveId) || document.querySelector('#new-item')).focus();
  }

  function startDraft() {
    if (newDraft) {
      openItem(newDraft.id);
      cards.get(newDraft.id)?.querySelector('[name="title"]')?.focus();
      report('Apply or cancel the open draft before creating another item');
      return;
    }
    const now = new Date().toISOString();
    const id = `draft-${++draftSequence}`;
    newDraft = { id, item: { id, title: 'Untitled item', body: '', tags: [], 'created-at': now, 'updated-at': now } };
    openOrder = [id, ...openOrder];
    uiActiveId = id;
    sync(); editItem(id);
  }

  function createCard(id) {
    const card = document.createElement('article');
    card.className = 'item-card'; card.dataset.itemId = id; card.tabIndex = -1;
    const head = document.createElement('header');
    const heading = document.createElement('h2');
    const actions = document.createElement('div'); actions.className = 'card-actions';
    actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Item actions');
    head.append(heading, actions);
    const content = document.createElement('div'); content.className = 'item-content';
    card.append(head, content);
    card.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.action;
      if (action === 'close') closeItem(id);
      else if (action === 'delete') deleteKnowledgeItem(id);
      else if (action === 'edit') editItem(id);
      else if (action === 'apply') applyItem(id);
      else if (action === 'cancel') cancelEdit(id);
      else if (!action && !event.target.closest('a,button,input,textarea,select,label')) focusItem(id);
    });
    cards.set(id, card); showItem(id);
    return card;
  }

  function sync() {
    const ids = openOrder;
    for (const [id, card] of cards) if (!ids.includes(id)) { card.remove(); cards.delete(id); dependencies.delete(id); editingPreviews.delete(id); disposeSnippets(id); }
    workspace.querySelector('.workspace-empty')?.remove();
    for (const [index, id] of ids.entries()) {
      const card = cards.get(id) || createCard(id);
      if (workspace.children[index] !== card) workspace.insertBefore(card, workspace.children[index] || null);
      card.classList.toggle('active', id === uiActiveId);
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

  function persistWorkspace() {
    const openIds = openOrder.filter(id => !isDraft(id) && itemFor(id));
    const activeId = openIds.includes(uiActiveId) ? uiActiveId : openIds[0] ?? null;
    base = { ...base, workspace: { 'open-ids': openIds, 'active-id': activeId } };
  }

  function commitWorkspaceChange() {
    const before = JSON.stringify(base.workspace);
    persistWorkspace();
    if (before !== JSON.stringify(base.workspace)) {
      history.splice(position + 1); history.push(snapshot(base)); position++;
      dirty = true;
      persistLocal();
    }
    sync();
  }

  function openItem(id) {
    if (!itemFor(id)) { report(`Missing item: ${id}`); return false; }
    openOrder = [id, ...openOrder.filter(openId => openId !== id)];
    uiActiveId = id;
    commitWorkspaceChange();
    return true;
  }
  function focusItem(id) { return openItem(id); }
  function closeItem(id) {
    if (!openOrder.includes(id)) return;
    const restoreFocus = cards.get(id)?.contains(document.activeElement);
    openOrder = openOrder.filter(openId => openId !== id);
    if (uiActiveId === id) uiActiveId = openOrder[0] ?? null;
    commitWorkspaceChange();
    if (restoreFocus) (cards.get(uiActiveId) || search).focus();
  }
  function deleteKnowledgeItem(id) {
    if (isDraft(id)) {
      if (!confirmDelete('Discard this unsaved item?')) return false;
      discardDraft();
      return true;
    }
    const item = itemFor(id);
    if (!item || !confirmDelete(`Delete "${item.title}" and its content?`)) return false;
    const restoreFocus = cards.get(id)?.contains(document.activeElement);
    base = deleteItem(base, id); openOrder = openOrder.filter(openId => openId !== id);
    if (uiActiveId === id) uiActiveId = openOrder[0] ?? null;
    dirty = true;
    persistWorkspace(); persistLocal();
    history.splice(position + 1); history.push(snapshot(base)); position++;
    sync();
    if (restoreFocus) (cards.get(uiActiveId) || search).focus();
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
    const drafts = openOrder.filter(isDraft);
    openOrder = [...drafts, ...openIds];
    uiActiveId = openIds.includes(state['active-id']) ? state['active-id'] : drafts[0] ?? openIds[0] ?? null;
    base = { ...base, workspace: { 'open-ids': openIds, 'active-id': openIds.includes(state['active-id']) ? state['active-id'] : openIds[0] ?? null } };
    persistLocal();
    sync();
  }

  function searchResult(item, detail) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'search-result'; button.dataset.itemId = item.id;
    const title = document.createElement('span'); title.className = 'search-title'; title.textContent = item.title;
    button.append(title);
    if (detail) { const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = detail; button.append(meta); }
    button.addEventListener('click', () => openItem(item.id));
    return button;
  }

  function appendSearchGroup(kind, label, items, details) {
    if (!items.length) return;
    const group = document.createElement('section');
    group.className = 'search-group'; group.dataset.searchGroup = kind;
    const heading = document.createElement('h3'); heading.textContent = label; group.append(heading);
    for (const item of items) group.append(searchResult(item, details.get(item.id)));
    results.append(group);
  }

  function refreshSearch() {
    const query = search.value.trim().toLocaleLowerCase(); results.replaceChildren();
    if (!query) return;
    const found = searchItems(base.items, query);
    if (!found.total) { results.textContent = 'No matching items'; return; }
    appendSearchGroup('titles-tags', 'Titles and tags', found.primary.slice(0, 30), found.details);
    appendSearchGroup('content', 'Content', found.content.slice(0, 30), found.details);
  }

  async function exportEDN() {
    if (newDraft || hasDraft()) { report('Apply or cancel open drafts before saving'); return null; }
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
    newDraft = null; base = imported; dirty = false;
    openOrder = [...base.workspace['open-ids']]; uiActiveId = base.workspace['active-id'];
    persistLocal();
    history.splice(0, history.length, snapshot(base)); position = 0;
    sync(); refreshSearch(); report('Knowledge base imported');
    return true;
  }

  document.querySelector('#new-item').addEventListener('click', startDraft);
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
  window.addEventListener('beforeunload', event => {
    if (newDraft || hasDraft() || (!(storage && !localSaveFailed) && dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  sync(); document.querySelector('#loom-app').dataset.ready = 'true';
  return { getBase: () => base, isDirty, exportEDN, importEDN, openItem, focusItem, closeItem, deleteItem: deleteKnowledgeItem, back: () => travel(-1), forward: () => travel(1) };
}
