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
import { MARKDOWN_FORMATS, applyMarkdownFormat } from './markdown-toolbar.js';
import { highlightClojure } from './syntax-highlight.js';

const snapshot = base => ({ 'open-ids': [...base.workspace['open-ids']], 'active-id': base.workspace['active-id'] });
const APPLY_ICON = 'M5 12l4 4L19 6';
const CANCEL_ICON = 'M9 7L4 12l5 5M4 12h10a6 6 0 010 12';
const ACTION_ICONS = {
  apply: APPLY_ICON,
  'apply-snippet': APPLY_ICON,
  cancel: CANCEL_ICON,
  'cancel-snippet': CANCEL_ICON,
  close: 'M6 6l12 12M18 6L6 18',
  delete: 'M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13',
  edit: 'M4 20h4L18 10l-4-4L4 16v4zM13 7l4 4',
  bold: 'M7 5h6a4 4 0 010 8H7zM7 13h7a4 4 0 010 8H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  strikethrough: 'M5 12h14M8 7c1-2 3-3 5-3 3 0 5 1 5 4M8 17c1 2 3 3 5 3 3 0 5-1 5-4',
  'inline-code': 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  heading: 'M5 5v14M19 5v14M5 12h14',
  'bullet-list': 'M5 7h.01M5 12h.01M5 17h.01M9 7h10M9 12h10M9 17h10',
  blockquote: 'M5 6h4v7H5zM5 16v2M15 6h4v7h-4zM15 16v2',
  'item-link': 'M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1',
  'executable-code': 'M8 8l-4 4 4 4M16 8l4 4-4 4M12 5v14',
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
  const activeSnippets = new Map();
  const snippetEditors = new WeakMap();
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

  function runSnippet(itemId, { source, output }) {
    try {
      const { value, dependencies: reads } = runtime().run(source);
      const rendered = renderResult(value, {
        document, items: base.items, onNavigate: targetId => openItem(targetId), dependencies: reads,
      });
      output.replaceChildren(rendered);
      activeSnippets.set(output, { itemId, source, dependencies: reads });
    } catch (error) {
      activeSnippets.delete(output);
      const message = document.createElement('span'); message.className = 'render-error';
      message.setAttribute('role', 'alert'); message.textContent = `Snippet error: ${error.message}`;
      output.replaceChildren(message);
    }
  }

  function refreshDependents(id, before, after) {
    const oldTags = before?.tags.map(tag => tag.name) || [];
    const newTags = after?.tags.map(tag => tag.name) || [];
    const summaryChanged = !before || !after || before.title !== after.title || JSON.stringify(oldTags) !== JSON.stringify(newTags);
    const subscriptions = [...activeSnippets];
    const affectedCards = new Set();
    for (const [cardId, reads] of dependencies) {
      if (cardId !== id && reads.has(`item:${id}`)) affectedCards.add(cardId);
    }
    for (const cardId of affectedCards) {
      if (cards.has(cardId) && !cards.get(cardId).querySelector('.item-form')) showItem(cardId);
    }
    for (const [output, subscription] of subscriptions) {
      if (subscription.itemId === id || affectedCards.has(subscription.itemId)) continue;
      const reads = subscription.dependencies;
      const changed = reads.has(`item:${id}`) || (summaryChanged && (reads.has('index')
        || [...reads].some(read => read.startsWith('tag:') && (oldTags.includes(read.slice(4)) || newTags.includes(read.slice(4))))));
      if (changed && output.isConnected) runSnippet(subscription.itemId, { source: subscription.source, output });
    }
  }

  function showItem(id) {
    const card = cards.get(id);
    if (!card) return;
    const item = itemFor(id);
    card.querySelector('h2').textContent = item.title;
    setActions(card, id, false);
    const content = card.querySelector('.item-content');
    disposeSnippets(id);
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
      onEditSnippet: snippet => editSnippet(id, snippet),
      onViewSnippet: snippet => viewSnippet(snippet),
    });
    dependencies.set(id, reads);
    content.replaceChildren(rendered);
    for (const snippet of content.querySelectorAll('.loom-snippet')) {
      runSnippet(id, { source: snippet.querySelector('pre').textContent, output: snippet.querySelector('.snippet-output') });
    }
  }

  function createFormatToolbar(textarea) {
    const toolbar = document.createElement('div');
    toolbar.className = 'format-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Markdown formatting');
    const apply = action => {
      const result = applyMarkdownFormat(textarea.value, textarea.selectionStart, textarea.selectionEnd, action);
      textarea.value = result.value;
      textarea.focus();
      textarea.setSelectionRange(result.start, result.end);
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    for (const definition of MARKDOWN_FORMATS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'icon-button format-button';
      button.dataset.formatAction = definition.action;
      button.title = definition.label; button.setAttribute('aria-label', definition.label);
      button.append(icon(definition.icon));
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => apply(definition.action));
      toolbar.append(button);
    }
    textarea.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const action = event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : null;
      if (!action) return;
      event.preventDefault(); apply(action);
    });
    return toolbar;
  }

  function editItem(id) {
    const item = itemFor(id), card = cards.get(id);
    const content = card.querySelector('.item-content');
    const form = document.createElement('form'); form.className = 'item-form';
    for (const [name, label, tag, value] of [
      ['title', 'Title', 'input', item.title],
      ['tags', 'Tags (space-separated keywords)', 'input', item.tags.map(tag => tag.name).join(' ')],
    ]) {
      const field = document.createElement('label'); field.textContent = label;
      const input = document.createElement(tag); input.name = name; input.value = value;
      field.append(input); form.append(field);
    }
    const bodyField = document.createElement('div'); bodyField.className = 'body-field';
    const bodyLabel = document.createElement('label'); bodyLabel.htmlFor = `body-${id}`; bodyLabel.textContent = 'Markdown';
    const textarea = document.createElement('textarea'); textarea.id = `body-${id}`; textarea.name = 'body'; textarea.value = item.body;
    bodyField.append(bodyLabel, createFormatToolbar(textarea), textarea); form.append(bodyField);
    form.addEventListener('submit', event => { event.preventDefault(); applyItem(id); });
    attachLinkCompletion(form.elements.body, { getItems: () => base.items });
    content.replaceChildren(form);
    setActions(card, id, true);
    form.querySelector('[name="title"]').focus();
  }

  function cancelEdit(id) {
    if (isDraft(id)) { discardDraft(); return; }
    showItem(id);
  }

  function commitItemChanges(id, changes) {
    const before = itemFor(id);
    base = updateItem(base, id, changes);
    dirty = true; persistLocal(); showItem(id);
    refreshDependents(id, before, itemFor(id));
    refreshSearch(); report();
  }

  function setSnippetMode(node, mode) {
    const editing = mode === 'edit';
    node.querySelector('[data-action="view-snippet"]')?.setAttribute('aria-pressed', String(!editing));
    node.querySelector('[data-action="edit-snippet"]')?.setAttribute('aria-pressed', String(editing));
    const output = node.querySelector('.snippet-output');
    if (output) output.hidden = editing;
  }

  function closeSnippetEditor(node) {
    const open = snippetEditors.get(node);
    if (!open) return;
    open.detach(); open.editor.remove(); snippetEditors.delete(node); setSnippetMode(node, 'view');
  }

  function viewSnippet({ node }) {
    const open = snippetEditors.get(node);
    if (!open) { setSnippetMode(node, 'view'); return; }
    const { textarea } = open;
    if (textarea.value !== textarea.dataset.original
      && !window.confirm('Discard the unapplied code changes and view the saved result?')) return;
    closeSnippetEditor(node);
  }

  function highlightedEditor(textarea) {
    const field = document.createElement('div'); field.className = 'snippet-code-field';
    const highlight = document.createElement('pre'); highlight.className = 'snippet-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code'); highlight.append(code);
    const syncScroll = () => {
      highlight.scrollTop = textarea.scrollTop; highlight.scrollLeft = textarea.scrollLeft;
    };
    const sync = () => {
      code.replaceChildren(highlightClojure(document, textarea.value + (textarea.value.endsWith('\n') ? ' ' : '')));
      syncScroll();
    };
    textarea.spellcheck = false;
    textarea.addEventListener('input', sync);
    textarea.addEventListener('scroll', syncScroll);
    field.append(highlight, textarea);
    sync();
    return field;
  }

  function editSnippet(id, { ordinal, node }) {
    if (snippetEditors.has(node)) { snippetEditors.get(node).textarea.focus(); return; }
    const originalBody = itemFor(id).body;
    const span = findSnippetSpan(originalBody, ordinal);
    if (!span) { report('Unable to locate the snippet in Markdown source'); return; }
    const editor = document.createElement('div'); editor.className = 'snippet-editor';
    const label = document.createElement('label'); label.textContent = 'ClojureScript source';
    const textarea = document.createElement('textarea'); textarea.value = span.source;
    textarea.dataset.original = span.source;
    label.append(highlightedEditor(textarea));
    const feedback = document.createElement('p'); feedback.setAttribute('role', 'alert');
    const itemTitle = itemFor(id).title;
    const apply = actionButton('apply-snippet', 'Apply code', itemTitle);
    const cancel = actionButton('cancel-snippet', 'Cancel', itemTitle);
    const actions = document.createElement('div'); actions.className = 'snippet-editor-actions';
    actions.append(apply, cancel);
    editor.append(actions, label, feedback);
    node.append(editor);
    const detach = attachStructuralEditor(textarea, { onStatus: message => { feedback.textContent = message; } });
    snippetEditors.set(node, { editor, textarea, detach });
    setSnippetMode(node, 'edit');
    cancel.addEventListener('click', () => closeSnippetEditor(node));
    apply.addEventListener('click', () => {
      try {
        const body = applySnippetEdit(originalBody, itemFor(id).body, span, textarea.value);
        snippetEditors.delete(node); detach(); commitItemChanges(id, { body });
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
    sync(); refreshSearch(); refreshDependents(created.id, null, created); report();
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
    for (const [id, card] of cards) if (!ids.includes(id)) { card.remove(); cards.delete(id); dependencies.delete(id); disposeSnippets(id); }
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
    refreshDependents(id, item, null); refreshSearch(); report();
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
    cards.clear(); dependencies.clear(); workspace.replaceChildren();
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
