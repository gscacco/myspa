import { keyword } from '../../shared/js/edn-codec.js';
import { addItem, createUUID, deleteItem, emptyKnowledgeBase, parseKnowledgeBase, updateItem, validateKnowledgeBase, writeKnowledgeBase } from './model.js';
import { renderMarkdown, renderResult } from './render.js';
import { createSnippetRuntime } from './runtime.js';
import { applySnippetEdit, evaluationForm, findSnippetSpan } from './snippet-source.js';
import { attachStructuralEditor } from './structural-editor.js';
import { createAttachmentFileIO, createEDNFileIO } from './files.js';
import { readLocalKnowledgeBase, writeLocalKnowledgeBase } from './local-store.js';
import { searchItems } from './item-search.js';
import { itemsByUpdated, itemsWithTag, pageSlice, recentItems, searchEntries } from './sidebar-browser.js';
import { attachLinkCompletion } from './link-completion.js';
import { attachTagCompletion } from './tag-completion.js';
import { attachClojureCompletion } from './clojure-completion.js';
import { MARKDOWN_FORMATS, applyMarkdownFormat } from './markdown-toolbar.js';
import { highlightClojure } from './syntax-highlight.js';
import { attachmentReference, createAttachmentRecord, createAttachmentStore, isImageAttachment } from './attachments.js';
import { parseAttachmentBundle, writeAttachmentBundle } from './attachment-bundle.js';
import { itemRelationships } from './item-relationships.js';

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
  'attach-file': 'M20 12.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8',
};

export function createLoomApp({
  document, window, base: initial = emptyKnowledgeBase(), saveFile, chooseFile,
  saveAttachmentFile, chooseAttachmentFile, confirmReplace, confirmCloseAll,
  storage = null, attachmentStore = null, generateAttachmentId = createUUID,
} ) {
  let base = validateKnowledgeBase(readLocalKnowledgeBase(storage) ?? initial);
  let dirty = false;
  let localSaveFailed = false;
  const fileIO = createEDNFileIO({ window, document });
  const attachmentFileIO = createAttachmentFileIO({ window, document });
  saveFile ||= fileIO.save;
  chooseFile ||= fileIO.choose;
  saveAttachmentFile ||= attachmentFileIO.save;
  chooseAttachmentFile ||= attachmentFileIO.choose;
  confirmReplace ||= message => window.confirm(message);
  confirmCloseAll ||= message => window.confirm(message);
  const history = [snapshot(base)];
  let position = 0;
  const cards = new Map();
  const dependencies = new Map();
  const activeSnippets = new Map();
  const snippetEditors = new WeakMap();
  let snippetRuntime = null;
  const attachmentFiles = attachmentStore || createAttachmentStore({ indexedDB: window.indexedDB });
  const attachments = new Map();
  const attachmentURLs = new Map();
  const workspace = document.querySelector('#workspace');
  const search = document.querySelector('#loom-search');
  const results = document.querySelector('#search-results');
  const status = document.querySelector('#loom-status');
  const backButton = document.querySelector('#history-back');
  const forwardButton = document.querySelector('#history-forward');
  const closeAllButton = document.querySelector('#close-all');
  const setupButton = document.querySelector('#setup-button');
  const itemsPage = document.querySelector('#items-page');
  const setupPage = document.querySelector('#setup-page');
  const updatedItems = document.querySelector('#updated-items');
  const openedItems = document.querySelector('#opened-items');
  const tagItems = document.querySelector('#tag-items');
  const tagFilterName = document.querySelector('#tag-filter-name');
  const browserTabs = [...document.querySelectorAll('[data-browser-page]')];
  const browserPanels = {
    updated: document.querySelector('#updated-panel'),
    opened: document.querySelector('#opened-panel'),
    search: document.querySelector('#search-panel'),
    tag: document.querySelector('#tag-panel'),
  };
  const browserPages = { updated: 1, opened: 1, search: 1, tag: 1 };
  let searchQuery = '';
  let selectedTagName = null;
  let recentOpenIds = [...base.workspace['open-ids']];
  let openOrder = [...base.workspace['open-ids']];
  const browserPagers = {
    updated: {
      navigation: document.querySelector('#updated-pagination'),
      previous: document.querySelector('#updated-previous'),
      next: document.querySelector('#updated-next'),
      status: document.querySelector('#updated-page-status'),
    },
    opened: {
      navigation: document.querySelector('#opened-pagination'),
      previous: document.querySelector('#opened-previous'),
      next: document.querySelector('#opened-next'),
      status: document.querySelector('#opened-page-status'),
    },
    search: {
      navigation: document.querySelector('#search-pagination'),
      previous: document.querySelector('#search-previous'),
      next: document.querySelector('#search-next'),
      status: document.querySelector('#search-page-status'),
    },
    tag: {
      navigation: document.querySelector('#tag-pagination'),
      previous: document.querySelector('#tag-previous'),
      next: document.querySelector('#tag-next'),
      status: document.querySelector('#tag-page-status'),
    },
  };
  let uiActiveId = base.workspace['active-id'];
  let draftSequence = 0;
  let newDraft = null;
  let activeDialog = null;
  let activeDialogFocus = null;

  function report(message = '') {
    const suffix = newDraft || hasDraft() ? ' · Unsaved draft'
      : !storage ? (dirty ? ' · Unsaved changes' : '')
        : localSaveFailed ? ' · Local save failed' : ' · Saved locally';
    status.textContent = message || `${base.items.length} items${suffix}`;
  }
  function isDraft(id) { return newDraft?.id === id; }
  function itemFor(id) { return isDraft(id) ? newDraft.item : base.items.find(item => item.id === id); }
  function referencingItems(id) {
    return base.items.filter(item => {
      if (item.id === id) return false;
      const relationships = itemRelationships(item.body);
      return relationships.referenced.includes(id) || relationships.transcluded.includes(id);
    });
  }
  function hasDraft() {
    for (const [id, card] of cards) {
      const item = itemFor(id);
      if (!item) continue;
      const form = card.querySelector('.item-form');
      const title = card.querySelector('[name="title"]');
      if (form && (title.value !== item.title || form.elements.body.value !== item.body
        || form.elements.tags.value.trim() !== item.tags.map(tag => tag.name).join(' '))) return true;
      for (const code of card.querySelectorAll('.snippet-editor textarea')) {
        if (code.value !== code.dataset.original) return true;
      }
    }
    return false;
  }
  function isDirty() { return dirty || newDraft !== null || hasDraft(); }
  function isImageItem(item) { return item?.kind?.name === 'image'; }

  function privateAttachmentIds() {
    return new Set(base.items.filter(isImageItem).map(item => item['attachment-id']).filter(Boolean));
  }

  function publicAttachments() {
    const privateIds = privateAttachmentIds();
    return new Map([...attachments].filter(([id]) => !privateIds.has(id)));
  }

  function attachmentURL(record) {
    const cached = attachmentURLs.get(record.id);
    if (cached) return cached;
    try {
      const url = window.URL?.createObjectURL?.(record.blob) || null;
      if (url) attachmentURLs.set(record.id, url);
      return url;
    } catch { return null; }
  }

  function presentAttachment(record) { return { ...record, url: attachmentURL(record) }; }

  function setAttachmentRecords(records) {
    for (const url of attachmentURLs.values()) window.URL?.revokeObjectURL?.(url);
    attachmentURLs.clear(); attachments.clear();
    for (const record of records) attachments.set(record.id, presentAttachment(record));
  }

  function refreshRenderedCards() {
    for (const [id, card] of cards) if (!card.querySelector('.item-form')) showItem(id);
  }

  async function saveAttachment(file) {
    const id = generateAttachmentId();
    if (!id) throw new Error('Cryptographic UUID generation is unavailable');
    const saved = await attachmentFiles.put(createAttachmentRecord(file, { id }));
    const presented = presentAttachment(saved);
    attachments.set(saved.id, presented);
    return presented;
  }

  function screenshotFile(file, now) {
    if (file.name?.trim()) return file;
    const extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    return new window.File([file], `screenshot-${stamp}.${extension}`, { type: file.type });
  }

  async function createImageItem(file) {
    const now = new Date();
    const saved = await saveAttachment(screenshotFile(file, now));
    const id = createUUID();
    if (!id) throw new Error('Cryptographic UUID generation is unavailable');
    const title = `Screenshot: item:${id}`;
    base = addItem(base, {
      title, body: '', tags: [], kind: keyword('image'), 'attachment-id': saved.id,
    }, { id, now: now.toISOString() });
    const created = base.items.at(-1);
    openOrder = [created.id, ...openOrder.filter(openId => openId !== created.id)];
    recentOpenIds = [created.id, ...recentOpenIds.filter(recentId => recentId !== created.id)];
    uiActiveId = created.id; dirty = true;
    persistWorkspace(); persistLocal();
    history.splice(position + 1); history.push(snapshot(base)); position++;
    sync(); refreshSearch(); refreshDependents(created.id, null, created);
    report(`Added ${created.title}`);
    return created;
  }

  function insertAttachment(textarea, id, { image = false, block = false } = {}) {
    const reference = attachmentReference(id, { image });
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const before = textarea.value.slice(0, start), after = textarea.value.slice(end);
    const leading = block && before && !before.endsWith('\n') ? '\n\n' : '';
    const trailing = block && after && !after.startsWith('\n') ? '\n\n' : '';
    textarea.value = before + leading + reference + trailing + after;
    const caret = start + leading.length + reference.length;
    textarea.focus(); textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  async function attachFileToEditor(textarea, file) {
    const saved = await saveAttachment(file);
    const image = isImageAttachment(saved);
    insertAttachment(textarea, saved.id, { image, block: image });
    report(`Attached ${saved.name}`);
    return saved;
  }

  async function exportAttachments() {
    try {
      const records = await attachmentFiles.list();
      const source = await writeAttachmentBundle(records);
      if (!await saveAttachmentFile(source, 'loom-files.json')) return null;
      report(`Exported ${records.length} files`); return source;
    } catch (error) { report(`Files export failed: ${error.message}`); throw error; }
  }

  async function importAttachments() {
    try {
      const file = await chooseAttachmentFile();
      if (!file) return 0;
      const records = await parseAttachmentBundle(await file.text());
      await attachmentFiles.importMany(records);
      setAttachmentRecords(await attachmentFiles.list());
      refreshRenderedCards();
      report(`Imported ${records.length} files`); return records.length;
    } catch (error) { report(`Files import failed: ${error.message}`); return false; }
  }

  async function loadAttachments() {
    try {
      setAttachmentRecords(await attachmentFiles.list());
      refreshRenderedCards();
    } catch (error) { report(`Attachment store unavailable: ${error.message}`); }
  }

  async function removeAttachment(id) {
    await attachmentFiles.delete(id);
    const url = attachmentURLs.get(id);
    if (url) window.URL?.revokeObjectURL?.(url);
    attachmentURLs.delete(id); attachments.delete(id);
  }

  function setSetupOpen(open, { focus = true } = {}) {
    itemsPage.hidden = open;
    setupPage.hidden = !open;
    setupButton.classList.toggle('active', open);
    setupButton.setAttribute('aria-expanded', String(open));
    const label = open ? 'Close setup' : 'Setup';
    setupButton.title = label; setupButton.setAttribute('aria-label', label);
    if (focus) {
      if (open) setupPage.querySelector('button').focus();
      else focusSearch();
    }
  }

  function setBrowserPage(page, { focus = false } = {}) {
    if (!browserPanels[page]) return;
    for (const tab of browserTabs) {
      const selected = tab.dataset.browserPage === page;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      browserPanels[tab.dataset.browserPage].hidden = !selected;
    }
    if (focus) browserTabs.find(tab => tab.dataset.browserPage === page)?.focus();
  }

  function focusSearch() {
    setBrowserPage('search');
    search.focus();
  }

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

  function setActions(card, id, editing, { image = false } = {}) {
    const item = itemFor(id), actions = card.querySelector('.card-actions');
    if (!item || !actions) return;
    actions.replaceChildren();
    const definitions = image
      ? [['close', 'Close'], ['delete', 'Delete']]
      : editing
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
      const { value, dependencies: reads } = runtime().run(source, { currentItemId: itemId });
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
    card.classList.remove('image-item-card');
    if (isImageItem(item)) { showImageItem(id, item); return; }
    setTitleDisplay(card, item.title);
    setActions(card, id, false);
    const content = card.querySelector('.item-content');
    disposeSnippets(id);
    const reads = new Set();
    const privateIds = privateAttachmentIds();
    const rendered = renderMarkdown(item.body, {
      document, items: base.items,
      attachments: new Map([...attachments].filter(([attachmentId]) => !privateIds.has(attachmentId))),
      itemAttachments: new Map([...attachments].filter(([attachmentId]) => privateIds.has(attachmentId))),
      attachmentURL, dependencies: reads,
      onNavigate: (targetId) => openItem(targetId),
      onEditSnippet: snippet => editSnippet(id, snippet),
    });
    dependencies.set(id, reads);
    content.replaceChildren(...(item.tags.length ? [itemTags(item.tags), rendered] : [rendered]));
    for (const snippet of content.querySelectorAll('.loom-snippet')) {
      runSnippet(id, { source: snippet.querySelector('pre').textContent, output: snippet.querySelector('.snippet-output') });
    }
  }

  function renderError(message) {
    const node = document.createElement('span');
    node.className = 'render-error'; node.setAttribute('role', 'alert'); node.textContent = message;
    return node;
  }

  function showImageItem(id, item) {
    const card = cards.get(id), content = card.querySelector('.item-content');
    card.classList.add('image-item-card');
    setTitleDisplay(card, item.title, { editable: false });
    setActions(card, id, false, { image: true });
    disposeSnippets(id); dependencies.set(id, new Set([`file:${item['attachment-id']}`]));
    const attachment = attachments.get(item['attachment-id']);
    if (!attachment) { content.replaceChildren(renderError(`Missing file: ${item['attachment-id']}`)); return; }
    if (!isImageAttachment(attachment)) { content.replaceChildren(renderError(`Attachment is not an image: ${attachment.name}`)); return; }
    const url = attachmentURL(attachment);
    if (!url) { content.replaceChildren(renderError(`Attachment unavailable: ${attachment.name}`)); return; }
    const figure = document.createElement('figure');
    figure.className = 'image-item'; figure.dataset.loomFile = attachment.id;
    const image = document.createElement('img');
    image.src = url; image.alt = item.title; image.decoding = 'async';
    figure.append(image); content.replaceChildren(...(item.tags.length ? [itemTags(item.tags), figure] : [figure]));
  }

  function itemTags(tags) {
    const list = document.createElement('ul');
    list.className = 'item-tags'; list.setAttribute('aria-label', 'Tags');
    for (const tag of tags) {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'item-tag-button';
      button.dataset.tag = tag.name; button.textContent = `:${tag.name}`;
      button.setAttribute('aria-label', `Show items tagged :${tag.name}`);
      button.addEventListener('click', event => {
        event.stopPropagation();
        openTag(tag.name);
      });
      entry.append(button);
      list.append(entry);
    }
    return list;
  }

  function createFormatToolbar(textarea, id) {
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
    const attachmentInput = document.createElement('input');
    attachmentInput.type = 'file'; attachmentInput.hidden = true; attachmentInput.dataset.attachmentInput = '';
    const attach = actionButton('attach-file', 'Attach file', itemFor(id).title);
    attach.dataset.attachmentAction = 'attach-file';
    attach.addEventListener('mousedown', event => event.preventDefault());
    attach.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', () => {
      const file = attachmentInput.files?.[0];
      attachmentInput.value = '';
      if (file) attachFileToEditor(textarea, file).catch(error => report(`Attachment failed: ${error.message}`));
    });
    toolbar.append(attach, attachmentInput);
    textarea.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const action = event.key.toLowerCase() === 'b' ? 'bold' : event.key.toLowerCase() === 'i' ? 'italic' : null;
      if (!action) return;
      event.preventDefault(); apply(action);
    });
    return toolbar;
  }

  function setTitleDisplay(card, title, { editable = true } = {}) {
    if (!editable) { card.querySelector('h2').textContent = title; return; }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'item-title-button'; button.textContent = title;
    button.title = `Edit title: ${title}`; button.setAttribute('aria-label', `Edit title: ${title}`);
    card.querySelector('h2').replaceChildren(button);
  }

  function setTitleEditor(card, id, title, form) {
    form.id = `item-form-${id}`;
    const input = document.createElement('input');
    input.type = 'text'; input.name = 'title'; input.value = title;
    input.className = 'item-title-input'; input.setAttribute('aria-label', 'Title');
    input.setAttribute('form', form.id);
    card.querySelector('h2').replaceChildren(input);
    return input;
  }

  function editItem(id) {
    const item = itemFor(id), card = cards.get(id);
    if (isImageItem(item)) return;
    const content = card.querySelector('.item-content');
    const form = document.createElement('form'); form.className = 'item-form';
    const tagsField = document.createElement('label');
    tagsField.textContent = 'Tags (space-separated keywords)';
    const tagsInput = document.createElement('input');
    tagsInput.name = 'tags'; tagsInput.value = item.tags.map(tag => tag.name).join(' ');
    tagsField.append(tagsInput); form.append(tagsField);
    const bodyField = document.createElement('div'); bodyField.className = 'body-field';
    const bodyLabel = document.createElement('label'); bodyLabel.htmlFor = `body-${id}`; bodyLabel.textContent = 'Markdown';
    const textarea = document.createElement('textarea'); textarea.id = `body-${id}`; textarea.name = 'body'; textarea.value = item.body;
    bodyField.append(bodyLabel, createFormatToolbar(textarea, id), textarea); form.append(bodyField);
    form.addEventListener('submit', event => { event.preventDefault(); applyItem(id); });
    attachLinkCompletion(form.elements.body, {
      getItems: () => base.items,
      getAttachments: () => [...publicAttachments().values()],
      getItemAttachment: id => attachments.get(id),
    });
    attachTagCompletion(form.elements.tags, {
      getTags: () => base.items.flatMap(item => item.tags.map(tag => tag.name)),
    });
    const titleInput = setTitleEditor(card, id, item.title, form);
    content.replaceChildren(form);
    setActions(card, id, true);
    titleInput.focus();
  }

  function cancelEdit(id) {
    if (isDraft(id)) { discardDraft(); return; }
    showItem(id);
  }

  function commitItemChanges(id, changes) {
    const before = itemFor(id);
    base = updateItem(base, id, changes);
    dirty = true; persistLocal(); showItem(id);
    refreshBrowserLists();
    refreshDependents(id, before, itemFor(id));
    refreshSearch(); report();
  }

  function setSnippetMode(node, mode) {
    const editing = mode === 'edit';
    const actions = node.querySelector('.snippet-actions');
    if (actions) actions.hidden = editing;
    const output = node.querySelector('.snippet-output');
    if (output) output.hidden = editing;
  }

  function closeSnippetEditor(node) {
    const open = snippetEditors.get(node);
    if (!open) return;
    open.detach(); open.editor.remove(); snippetEditors.delete(node); setSnippetMode(node, 'view');
  }

  function highlightedEditor(textarea) {
    const field = document.createElement('div'); field.className = 'snippet-code-field';
    const highlight = document.createElement('pre'); highlight.className = 'snippet-highlight';
    highlight.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code'); highlight.append(code);
    const caret = document.createElement('span'); caret.className = 'snippet-caret'; caret.hidden = true;
    caret.setAttribute('aria-hidden', 'true');

    function caretRect(offset) {
      const walker = document.createTreeWalker(code, 4);
      let remaining = Math.max(0, offset), node = walker.nextNode();
      while (node && remaining > node.data.length) {
        remaining -= node.data.length; node = walker.nextNode();
      }
      const range = document.createRange();
      if (node) {
        range.setStart(node, remaining); range.collapse(true);
      } else {
        range.selectNodeContents(code); range.collapse(false);
      }
      const marker = document.createElement('span'); marker.textContent = '\u200b';
      range.insertNode(marker);
      const rect = marker.getBoundingClientRect();
      marker.remove();
      return rect;
    }

    function syncCaret() {
      const focused = document.activeElement === textarea;
      const start = textarea.selectionStart;
      if (!focused || start !== textarea.selectionEnd || !code.isConnected) {
        caret.hidden = true; return;
      }
      const rect = caretRect(start);
      const highlightRect = highlight.getBoundingClientRect();
      const lineHeight = Number.parseFloat(window.getComputedStyle(field).lineHeight) || 21;
      const leading = Math.max(0, (lineHeight - rect.height) / 2);
      caret.style.left = `${rect.left - highlightRect.left - highlight.clientLeft + highlight.scrollLeft}px`;
      caret.style.top = `${rect.top - highlightRect.top - highlight.clientTop + highlight.scrollTop - leading}px`;
      caret.style.height = `${lineHeight}px`;
      caret.hidden = false;
    }

    const syncScroll = () => {
      highlight.scrollTop = textarea.scrollTop; highlight.scrollLeft = textarea.scrollLeft;
    };
    const sync = () => {
      code.replaceChildren(highlightClojure(document, textarea.value + (textarea.value.endsWith('\n') ? ' ' : '')));
      syncScroll(); syncCaret();
    };
    textarea.spellcheck = false;
    textarea.addEventListener('input', sync);
    textarea.addEventListener('scroll', syncScroll);
    for (const event of ['keyup', 'select', 'click', 'focus']) {
      textarea.addEventListener(event, syncCaret);
    }
    textarea.addEventListener('blur', () => { caret.hidden = true; });
    highlight.append(caret);
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
    const evaluation = document.createElement('section');
    evaluation.className = 'snippet-evaluation'; evaluation.hidden = true;
    evaluation.setAttribute('aria-label', 'S-expression evaluation output');
    const evaluationLabel = document.createElement('p');
    evaluationLabel.className = 'snippet-evaluation-label'; evaluationLabel.textContent = 'Evaluation output';
    const evaluationOutput = document.createElement('div');
    evaluationOutput.className = 'snippet-evaluation-output';
    evaluationOutput.setAttribute('role', 'status'); evaluationOutput.setAttribute('aria-live', 'polite');
    evaluation.append(evaluationLabel, evaluationOutput);
    const itemTitle = itemFor(id).title;
    const apply = actionButton('apply-snippet', 'Apply code', itemTitle);
    const cancel = actionButton('cancel-snippet', 'Cancel', itemTitle);
    const actions = document.createElement('div'); actions.className = 'snippet-editor-actions';
    actions.append(apply, cancel);
    editor.append(actions, label, feedback);
    node.append(editor);
    function evaluateForm() {
      const form = evaluationForm(textarea.value, textarea.selectionStart);
      if (!form) {
        evaluation.hidden = true;
        feedback.textContent = 'Place the cursor at the end of an s-expression to evaluate it';
        return;
      }
      try {
        const { value, dependencies } = runtime().run(form.text, { currentItemId: id });
        evaluationOutput.replaceChildren(renderResult(value, {
          document, items: base.items, onNavigate: targetId => openItem(targetId), dependencies,
        }));
        evaluation.hidden = false; feedback.textContent = '';
      } catch (error) {
        const message = document.createElement('span');
        message.className = 'render-error'; message.setAttribute('role', 'alert');
        message.textContent = `Snippet error: ${error.message}`;
        evaluationOutput.replaceChildren(message);
        evaluation.hidden = false; feedback.textContent = '';
      }
    }
    const detachStructural = attachStructuralEditor(textarea, {
      onStatus: message => { feedback.textContent = message; },
      onEvaluate: evaluateForm,
    });
    const detachCompletion = attachClojureCompletion(textarea);
    editor.append(evaluation);
    const detach = () => { detachStructural(); detachCompletion(); };
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
      const changes = { title: cards.get(id).querySelector('[name="title"]').value, tags, body: form.elements.body.value };
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
    recentOpenIds = [created.id, ...recentOpenIds.filter(id => id !== draftId && id !== created.id)];
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
    setSetupOpen(false, { focus: false });
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
      else if (!action && event.target.closest('.item-title-button')) editItem(id);
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
    closeAllButton.disabled = !ids.length;
    refreshBrowserLists();
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
    if (!isDraft(id)) recentOpenIds = [id, ...recentOpenIds.filter(recentId => recentId !== id)];
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
    if (restoreFocus) {
      const card = cards.get(uiActiveId);
      if (card) card.focus();
      else focusSearch();
    }
  }
  function openItems(ids) {
    const uniqueIds = [...new Set(ids)].filter(id => itemFor(id));
    if (!uniqueIds.length) return false;
    openOrder = [...uniqueIds, ...openOrder.filter(id => !uniqueIds.includes(id))];
    recentOpenIds = [...uniqueIds, ...recentOpenIds.filter(id => !uniqueIds.includes(id))];
    uiActiveId = uniqueIds[0];
    commitWorkspaceChange();
    cards.get(uiActiveId)?.focus();
    return true;
  }
  function closeDialog({ restoreFocus = true } = {}) {
    if (!activeDialog) return;
    const focus = activeDialogFocus;
    activeDialog.remove();
    activeDialog = null; activeDialogFocus = null;
    if (restoreFocus) focus?.focus?.();
  }
  function showDialog({ title, description, details = null, actions }) {
    closeDialog({ restoreFocus: false });
    activeDialogFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'loom-dialog-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'loom-dialog'; dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'loom-dialog-title');
    dialog.setAttribute('aria-describedby', 'loom-dialog-description');
    const heading = document.createElement('h2');
    heading.id = 'loom-dialog-title'; heading.textContent = title;
    const body = document.createElement('p');
    body.id = 'loom-dialog-description'; body.textContent = description;
    const footer = document.createElement('div'); footer.className = 'loom-dialog-actions';
    const buttons = actions.map(action => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.action = action.action; button.textContent = action.label;
      if (action.danger) button.classList.add('danger');
      button.addEventListener('click', () => {
        closeDialog({ restoreFocus: Boolean(action.restoreFocus) });
        action.onSelect?.();
      });
      footer.append(button);
      return button;
    });
    dialog.append(heading, body);
    if (details) dialog.append(details);
    dialog.append(footer); backdrop.append(dialog);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeDialog(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
    });
    document.body.append(backdrop);
    activeDialog = backdrop;
    const initialIndex = actions.findIndex(action => action.initial);
    buttons[initialIndex >= 0 ? initialIndex : 0]?.focus();
  }
  function showReferenceDialog(item, references) {
    const list = document.createElement('ul'); list.className = 'loom-dialog-list';
    for (const reference of references) {
      const entry = document.createElement('li');
      entry.dataset.referenceItem = reference.id; entry.textContent = reference.title;
      list.append(entry);
    }
    showDialog({
      title: 'Item is still referenced',
      description: `${item.title} is referenced by ${references.length} item${references.length === 1 ? '' : 's'}.`,
      details: list,
      actions: [
        {
          action: 'open-all', label: 'Open all',
          onSelect: () => {
            const ids = references.map(reference => reference.id);
            openItems(ids); report(`Opened ${ids.length} referencing items`);
          },
        },
        { action: 'cancel', label: 'Cancel', restoreFocus: true, initial: true },
      ],
    });
  }
  function closeAllItems() {
    if (!openOrder.length) return false;
    if ((newDraft || hasDraft()) && !confirmCloseAll('Close all items and discard unsaved changes?')) return false;
    newDraft = null;
    openOrder = []; uiActiveId = null;
    commitWorkspaceChange();
    report('All items closed');
    focusSearch();
    return true;
  }
  function removeStoredItem(id, item, restoreFocus) {
    const privateAttachmentId = isImageItem(item) ? item['attachment-id'] : null;
    base = deleteItem(base, id); openOrder = openOrder.filter(openId => openId !== id);
    recentOpenIds = recentOpenIds.filter(recentId => recentId !== id);
    if (uiActiveId === id) uiActiveId = openOrder[0] ?? null;
    dirty = true;
    persistWorkspace(); persistLocal();
    history.splice(position + 1); history.push(snapshot(base)); position++;
    sync();
    if (restoreFocus) {
      const card = cards.get(uiActiveId);
      if (card) card.focus();
      else focusSearch();
    }
    refreshDependents(id, item, null); refreshSearch(); report();
    if (privateAttachmentId) removeAttachment(privateAttachmentId).catch(error => report(`Attachment delete failed: ${error.message}`));
    return true;
  }
  function deleteKnowledgeItem(id) {
    const cancelAction = { action: 'cancel-delete', label: 'Cancel', restoreFocus: true, initial: true };
    if (isDraft(id)) {
      showDialog({
        title: 'Discard draft?',
        description: 'This unsaved item will be removed.',
        actions: [cancelAction, { action: 'confirm-delete', label: 'Discard', danger: true, onSelect: discardDraft }],
      });
      return false;
    }
    const item = itemFor(id);
    if (!item) return false;
    const references = referencingItems(id);
    if (references.length) { showReferenceDialog(item, references); return false; }
    const restoreFocus = cards.get(id)?.contains(document.activeElement);
    showDialog({
      title: 'Delete item?',
      description: `Delete "${item.title}" and its content?`,
      actions: [cancelAction, {
        action: 'confirm-delete', label: 'Delete', danger: true,
        onSelect: () => removeStoredItem(id, item, restoreFocus),
      }],
    });
    return false;
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

  function searchResult(item, detail, { browser = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'search-result';
    if (browser) button.dataset.browserItemId = item.id;
    else button.dataset.itemId = item.id;
    const title = document.createElement('span'); title.className = 'search-title'; title.textContent = item.title;
    button.append(title);
    if (detail) { const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = detail; button.append(meta); }
    button.addEventListener('click', () => openItem(item.id));
    return button;
  }

  function itemDetail(item) {
    const updated = item['updated-at'].slice(0, 16).replace('T', ' ');
    const tags = item.tags.map(tag => `:${tag.name}`);
    return [`Updated ${updated} UTC`, ...tags].join(' · ');
  }

  function renderItemList(container, items, emptyText) {
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'browser-empty'; empty.textContent = emptyText;
      container.append(empty);
      return;
    }
    for (const item of items) container.append(searchResult(item, itemDetail(item), { browser: true }));
  }

  function updateBrowserPagination(kind, paged) {
    const pager = browserPagers[kind];
    pager.navigation.hidden = paged.pageCount <= 1;
    pager.status.textContent = `Page ${paged.page} of ${paged.pageCount}`;
    pager.previous.disabled = !paged.hasPrevious;
    pager.next.disabled = !paged.hasNext;
  }

  function refreshUpdated() {
    const paged = pageSlice(itemsByUpdated(base.items), browserPages.updated);
    browserPages.updated = paged.page;
    renderItemList(updatedItems, paged.items, 'No items yet');
    updateBrowserPagination('updated', paged);
  }

  function refreshOpened() {
    const paged = pageSlice(recentItems(base.items, recentOpenIds), browserPages.opened);
    browserPages.opened = paged.page;
    renderItemList(openedItems, paged.items, 'No items opened yet');
    updateBrowserPagination('opened', paged);
  }

  function refreshTag() {
    tagFilterName.textContent = selectedTagName ? `:${selectedTagName}` : 'None selected';
    const matching = selectedTagName ? itemsByUpdated(itemsWithTag(base.items, selectedTagName)) : [];
    const paged = pageSlice(matching, browserPages.tag);
    browserPages.tag = paged.page;
    renderItemList(tagItems, paged.items, selectedTagName
      ? `No items tagged :${selectedTagName}`
      : 'Select a tag on an item to see related items');
    updateBrowserPagination('tag', paged);
  }

  function openTag(rawTag) {
    const tag = String(rawTag ?? '').trim().replace(/^:/, '');
    if (!tag) return;
    selectedTagName = tag;
    browserPages.tag = 1;
    refreshTag();
    setBrowserPage('tag', { focus: true });
  }

  function refreshBrowserLists() {
    refreshUpdated();
    refreshOpened();
    refreshTag();
  }

  function refreshBrowserPage(kind) {
    if (kind === 'updated') refreshUpdated();
    else if (kind === 'opened') refreshOpened();
    else if (kind === 'search') refreshSearch();
    else if (kind === 'tag') refreshTag();
  }

  function appendSearchGroup(kind, label, entries, details) {
    if (!entries.length) return;
    const group = document.createElement('section');
    group.className = 'search-group'; group.dataset.searchGroup = kind;
    const heading = document.createElement('h3'); heading.textContent = label; group.append(heading);
    for (const { item } of entries) group.append(searchResult(item, details.get(item.id)));
    results.append(group);
  }

  function refreshSearch() {
    const query = search.value.trim().toLocaleLowerCase();
    if (query !== searchQuery) { searchQuery = query; browserPages.search = 1; }
    results.replaceChildren();
    if (!query) {
      results.textContent = 'Type to search by title, tag, or text';
      updateBrowserPagination('search', pageSlice([], 1));
      return;
    }
    const found = searchItems(base.items, query);
    const paged = pageSlice(searchEntries(found), browserPages.search);
    browserPages.search = paged.page;
    updateBrowserPagination('search', paged);
    if (!found.total) { results.textContent = 'No matching items'; return; }
    appendSearchGroup('titles-tags', 'Titles and tags', paged.items.filter(entry => entry.kind === 'titles-tags'), found.details);
    appendSearchGroup('content', 'Content', paged.items.filter(entry => entry.kind === 'content'), found.details);
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
    recentOpenIds = [...base.workspace['open-ids']];
    persistLocal();
    history.splice(0, history.length, snapshot(base)); position = 0;
    sync(); refreshSearch(); report('Knowledge base imported');
    return true;
  }

  document.querySelector('#new-item').addEventListener('click', startDraft);
  setupButton.addEventListener('click', () => setSetupOpen(setupPage.hidden));
  setupPage.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setSetupOpen(false); }
  });
  backButton.addEventListener('click', () => travel(-1));
  forwardButton.addEventListener('click', () => travel(1));
  closeAllButton.addEventListener('click', closeAllItems);
  browserTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setBrowserPage(tab.dataset.browserPage));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset) return;
      event.preventDefault();
      const target = browserTabs[(index + offset + browserTabs.length) % browserTabs.length];
      setBrowserPage(target.dataset.browserPage, { focus: true });
    });
  });
  for (const kind of Object.keys(browserPagers)) {
    browserPagers[kind].previous.addEventListener('click', () => {
      browserPages[kind] = Math.max(1, browserPages[kind] - 1);
      refreshBrowserPage(kind);
    });
    browserPagers[kind].next.addEventListener('click', () => {
      browserPages[kind] += 1;
      refreshBrowserPage(kind);
    });
  }
  search.addEventListener('focus', () => setBrowserPage('search'));
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
  document.querySelector('#export-files').addEventListener('click', () => { exportAttachments().catch(() => {}); });
  document.querySelector('#import-files').addEventListener('click', () => { importAttachments(); });
  document.addEventListener('paste', async event => {
    if (event.defaultPrevented) return;
    const images = Array.from(event.clipboardData?.items || [])
      .filter(entry => entry.kind === 'file' && entry.type?.startsWith('image/'))
      .map(entry => entry.getAsFile?.())
      .filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    for (const file of images) {
      try { await createImageItem(file); }
      catch (error) { report(`Screenshot import failed: ${error.message}`); }
    }
  });
  window.addEventListener('beforeunload', event => {
    if (newDraft || hasDraft() || (!(storage && !localSaveFailed) && dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  sync(); document.querySelector('#loom-app').dataset.ready = 'true';
  const ready = loadAttachments();
  return {
    getBase: () => base, isDirty, exportEDN, importEDN, exportAttachments, importAttachments, ready,
    openItem, focusItem, closeItem, closeAll: closeAllItems, deleteItem: deleteKnowledgeItem, back: () => travel(-1), forward: () => travel(1),
  };
}
