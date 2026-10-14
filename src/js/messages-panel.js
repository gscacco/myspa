/** Compact bottom panel with a small, variable-height virtualized message list. */

const LEVELS = ['info', 'warn', 'error', 'debug'];
const OVERSCAN = 5;
const ESTIMATED_ROW_HEIGHT = 58;

function searchableText(message) {
  return [message.message, message.category, JSON.stringify(message.source), message.details,
    message.exception?.name, message.exception?.message, message.exception?.stack]
    .filter(Boolean).join(' ').toLowerCase();
}

function exportText(message) {
  const parts = [`[${message.timestamp}] ${message.level.toUpperCase()} ${message.category}${message.source ? ` ${message.source}` : ''}: ${message.message}`];
  if (message.details) parts.push(`Details: ${message.details}`);
  if (message.exception) {
    parts.push(`${message.exception.name}: ${message.exception.message}`);
    if (message.exception.stack) parts.push(message.exception.stack);
  }
  return parts.join('\n');
}

function copyText(text) {
  if (globalThis.navigator?.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand?.('copy') || false;
  input.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard access is unavailable.'));
}

export function createMessagesPanel(store) {
  const panel = document.querySelector('#messages-panel');
  const toggle = document.querySelector('[data-action="toggle-messages"]');
  const list = panel.querySelector('#messages-list');
  const virtualList = panel.querySelector('#messages-virtual-list');
  const rows = panel.querySelector('.messages-rows');
  const categoryFilter = panel.querySelector('[data-category-filter]');
  const search = panel.querySelector('[data-message-search]');
  const count = panel.querySelector('[data-message-count]');
  const status = panel.querySelector('.messages-status');
  const resizeHandle = panel.querySelector('#messages-resizer');
  const enabledLevels = new Set(LEVELS);
  const expanded = new Set();
  const rowNodes = new Map();
  const measuredHeights = new Map();
  let messages = [];
  let viewHead = 0;
  let messageIndices = new Map();
  let prefix = [0];
  let categories = new Set();
  let categoryCounts = new Map();
  let resizeDrag = null;
  let hasOpened = false;
  let followNewMessages = true;

  const isOpen = () => !panel.hidden;
  const heightKey = message => `${message.id}:${expanded.has(message.id) ? 1 : 0}`;
  const estimatedHeight = message => {
    const key = heightKey(message);
    if (measuredHeights.has(key)) return measuredHeights.get(key);
    const longText = message.message.length > 180 ? 18 : 0;
    const details = expanded.has(message.id)
      ? Math.min(480, 48 + (message.details?.length || 0) / 3 + (message.exception?.stack?.length || 0) / 2)
      : 0;
    return ESTIMATED_ROW_HEIGHT + longText + details;
  };

  function updateCount(stats = store.getStats()) {
    count.textContent = `${stats.retained} retained · ${stats.discarded} discarded`;
    toggle.querySelector('#messages-badge').textContent = String(stats.retained);
    toggle.title = `${stats.retained} retained messages; ${stats.discarded} discarded`;
  }

  function updateCategoryOptions(next) {
    const selected = categoryFilter.value;
    if (next.size === categories.size && [...next].every(category => categories.has(category))) return;
    categories = new Set(next);
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All categories';
    categoryFilter.replaceChildren(all);
    for (const category of [...categories].sort()) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryFilter.append(option);
    }
    categoryFilter.value = categories.has(selected) ? selected : '';
  }

  function updateCategories(allMessages) {
    categoryCounts = new Map();
    for (const message of allMessages) categoryCounts.set(message.category, (categoryCounts.get(message.category) || 0) + 1);
    updateCategoryOptions(new Set(categoryCounts.keys()));
  }

  function matches(message) {
    if (!enabledLevels.has(message.level)) return false;
    if (categoryFilter.value && categoryFilter.value !== message.category) return false;
    return !search.value.trim() || searchableText(message).includes(search.value.trim().toLowerCase());
  }

  function captureAnchor() {
    if (viewHead >= messages.length) return null;
    const index = Math.min(messages.length - 1, Math.max(viewHead, findIndex(list.scrollTop)));
    return { id: messages[index].id, offset: list.scrollTop - (prefix[index] - prefix[viewHead]), atBottom: isAtBottom() };
  }

  function restoreAnchor(anchor) {
    if (!anchor) return;
    if (anchor.atBottom) {
      list.scrollTop = Math.max(0, prefix[messages.length] - prefix[viewHead] - viewportHeight());
      return;
    }
    const index = messageIndices.get(anchor.id);
    if (index !== undefined && index >= viewHead) {
      list.scrollTop = Math.max(0, prefix[index] - prefix[viewHead] + anchor.offset);
    } else list.scrollTop = 0;
  }

  function rebuildPrefix() {
    compactView();
    prefix = new Array(messages.length + 1);
    prefix[0] = 0;
    for (let index = 0; index < messages.length; index++) prefix[index + 1] = prefix[index] + estimatedHeight(messages[index]);
    virtualList.style.height = `${prefix[messages.length] - prefix[viewHead]}px`;
  }

  function compactView() {
    if (!viewHead) return;
    const base = prefix[viewHead] || 0;
    messages = messages.slice(viewHead);
    prefix = prefix.slice(viewHead).map(offset => offset - base);
    viewHead = 0;
    messageIndices = new Map(messages.map((message, index) => [message.id, index]));
  }

  function findIndex(offset) {
    if (viewHead >= messages.length) return viewHead;
    const target = prefix[viewHead] + offset;
    let low = viewHead, high = messages.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (prefix[middle + 1] <= target) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, messages.length - 1);
  }

  function viewportHeight() { return list.clientHeight || 320; }
  function isAtBottom() { return prefix[messages.length] - prefix[viewHead] - list.scrollTop - viewportHeight() <= 32; }

  function renderRow(message) {
    const item = document.createElement('article');
    item.className = 'message-row';
    item.dataset.messageId = String(message.id);
    item.dataset.level = message.level;
    item.dataset.category = message.category;
    const heading = document.createElement('div');
    heading.className = 'message-heading';
    const badge = document.createElement('span');
    badge.className = `message-level level-${message.level}`;
    badge.textContent = message.level.toUpperCase();
    const timestamp = document.createElement('time');
    timestamp.dateTime = message.timestamp;
    timestamp.title = message.timestamp;
    timestamp.textContent = new Date(message.timestamp).toLocaleString();
    const category = document.createElement('span');
    category.className = 'message-category';
    category.textContent = message.category;
    heading.append(badge, timestamp, category);
    if (message.source) {
      const source = document.createElement('span');
      source.className = 'message-source';
      source.textContent = typeof message.source === 'string' ? message.source : JSON.stringify(message.source);
      heading.append(source);
    }
    const actions = document.createElement('div');
    actions.className = 'message-row-actions';
    if (message.details || message.exception || message.message.length > 500) {
      const detailsButton = document.createElement('button');
      detailsButton.type = 'button';
      detailsButton.className = 'message-details-toggle';
      detailsButton.textContent = expanded.has(message.id) ? 'Hide details' : 'Details';
      detailsButton.setAttribute('aria-expanded', String(expanded.has(message.id)));
      detailsButton.addEventListener('click', () => toggleDetails(message.id));
      actions.append(detailsButton);
    }
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.setAttribute('aria-label', `Copy ${message.level} message`);
    copyButton.addEventListener('click', () => copyMessage(message, false));
    actions.append(copyButton);
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.message;
    const detail = document.createElement('div');
    detail.className = 'message-detail';
    detail.hidden = !expanded.has(message.id);
    if (message.message.length > 500) {
      const full = document.createElement('pre');
      full.textContent = `Message:\n${message.message}`;
      detail.append(full);
    }
    if (message.details) {
      const details = document.createElement('pre');
      details.textContent = `Details:\n${message.details}`;
      detail.append(details);
    }
    if (message.exception) {
      const exception = document.createElement('pre');
      exception.textContent = `${message.exception.name}: ${message.exception.message}${message.exception.stack ? `\n${message.exception.stack}` : ''}`;
      detail.append(exception);
    }
    if (!detail.hidden) {
      const copyDetails = document.createElement('button');
      copyDetails.type = 'button';
      copyDetails.textContent = 'Copy details';
      copyDetails.addEventListener('click', () => copyMessage(message, true));
      detail.append(copyDetails);
    }
    item.append(heading, actions, text, detail);
    return item;
  }

  function toggleDetails(id) {
    const anchor = captureAnchor();
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    rowNodes.get(id)?.remove();
    rowNodes.delete(id);
    rebuildPrefix();
    restoreAnchor(anchor);
    render();
  }

  function copyMessage(message, includeDetails) {
    const source = message.source ? ` ${typeof message.source === 'string' ? message.source : JSON.stringify(message.source)}` : '';
    copyText(includeDetails ? exportText(message) : `[${message.timestamp}] ${message.level.toUpperCase()} ${message.category}${source}: ${message.message}`)
      .then(() => report(includeDetails ? 'Message and details copied.' : 'Message copied.'))
      .catch(error => reportOperationError('copy', error));
  }

  function report(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  function reportOperationError(operation, error) {
    store.error(`Messages ${operation} failed.`, {
      category: 'app', source: { operation: `messages-${operation}` }, exception: error,
    });
    report(error?.message || `Messages ${operation} failed.`, true);
  }

  function render(skipMeasurement = false) {
    if (!isOpen()) return;
    const total = messages.length - viewHead;
    if (!total) {
      rows.replaceChildren();
      rowNodes.clear();
      virtualList.style.height = '0px';
      return;
    }
    const height = viewportHeight();
    const anchor = captureAnchor();
    const first = Math.max(viewHead, findIndex(list.scrollTop) - OVERSCAN);
    const last = Math.min(messages.length, findIndex(list.scrollTop + height) + OVERSCAN + 1);
    const visible = new Set();
    for (let index = first; index < last; index++) {
      const message = messages[index];
      const key = message.id;
      visible.add(key);
      let row = rowNodes.get(key);
      if (!row) {
        row = renderRow(message);
        rowNodes.set(key, row);
        rows.append(row);
      }
      row.style.transform = `translateY(${prefix[index] - prefix[viewHead]}px)`;
      row.style.minHeight = `${estimatedHeight(message)}px`;
      row.setAttribute('aria-posinset', String(index - viewHead + 1));
      row.setAttribute('aria-setsize', String(total));
    }
    for (const [id, row] of rowNodes) {
      if (!visible.has(id)) { row.remove(); rowNodes.delete(id); }
    }
    // Read measurements only for visible rows. This captures wrapped text and
    // expanded stack traces while leaving off-screen rows estimated.
    let geometryChanged = false;
    if (!skipMeasurement) {
      for (let index = first; index < last; index++) {
        const message = messages[index], row = rowNodes.get(message.id);
        const measured = row?.getBoundingClientRect().height || row?.offsetHeight || 0;
        const key = heightKey(message);
        if (measured > 0 && Math.abs((measuredHeights.get(key) || ESTIMATED_ROW_HEIGHT) - measured) > 2) {
          measuredHeights.set(key, measured);
          geometryChanged = true;
        }
      }
    }
    if (geometryChanged) {
      rebuildPrefix();
      restoreAnchor(anchor);
      render(true);
    }
  }

  function refreshFromStore(resetScroll = false) {
    const allMessages = store.getMessages();
    updateCategories(allMessages);
    messages = allMessages.filter(matches);
    viewHead = 0;
    messageIndices = new Map(messages.map((message, index) => [message.id, index]));
    if (resetScroll) list.scrollTop = 0;
    rebuildPrefix();
    render();
  }

  function handleChange(change) {
    updateCount(change.stats);
    if (!isOpen()) {
      if (change.cleared) {
        messages = [];
        viewHead = 0;
        messageIndices.clear();
        prefix = [0];
        expanded.clear();
        measuredHeights.clear();
        rowNodes.clear();
        rows.replaceChildren();
        virtualList.style.height = '0px';
        categoryCounts.clear();
        updateCategoryOptions(new Set());
      } else if (change.removed.length) {
        const removed = new Set(change.removed.map(entry => typeof entry === 'object' ? entry.id : entry));
        for (const entry of change.removed) {
          const id = typeof entry === 'object' ? entry.id : entry;
          rowNodes.get(id)?.remove();
          rowNodes.delete(id);
          expanded.delete(id);
          measuredHeights.delete(`${id}:0`);
          measuredHeights.delete(`${id}:1`);
        }
        while (viewHead < messages.length && removed.has(messages[viewHead].id)) {
          messageIndices.delete(messages[viewHead].id);
          messages[viewHead] = null;
          viewHead++;
        }
        if (viewHead >= 256) compactView();
        virtualList.style.height = `${prefix[messages.length] - prefix[viewHead]}px`;
      }
      return;
    }
    const anchor = captureAnchor();
    const follow = messages.length === 0 || anchor?.atBottom;
    const selectedCategory = categoryFilter.value;
    let categorySetChanged = false;
    if (change.cleared) {
      messages = [];
      viewHead = 0;
      messageIndices.clear();
      prefix = [0];
      rows.replaceChildren();
      rowNodes.clear();
      expanded.clear();
      measuredHeights.clear();
      categoryCounts.clear();
      categorySetChanged = true;
    } else if (change.removed.length) {
      const removed = new Set(change.removed.map(entry => typeof entry === 'object' ? entry.id : entry));
      for (const entry of change.removed) {
        const id = typeof entry === 'object' ? entry.id : entry;
        rowNodes.get(id)?.remove();
        rowNodes.delete(id);
        expanded.delete(id);
        measuredHeights.delete(`${id}:0`);
        measuredHeights.delete(`${id}:1`);
        if (typeof entry === 'object') {
          const remaining = (categoryCounts.get(entry.category) || 0) - 1;
          if (remaining > 0) categoryCounts.set(entry.category, remaining);
          else { categoryCounts.delete(entry.category); categorySetChanged = true; }
        }
      }
      while (viewHead < messages.length && removed.has(messages[viewHead].id)) {
        messageIndices.delete(messages[viewHead].id);
        messages[viewHead] = null;
        viewHead++;
      }
      if (viewHead >= 256) compactView();
    }
    for (const message of change.added) {
      if (!categoryCounts.has(message.category)) categorySetChanged = true;
      categoryCounts.set(message.category, (categoryCounts.get(message.category) || 0) + 1);
    }
    if (categorySetChanged) updateCategoryOptions(new Set(categoryCounts.keys()));
    if (selectedCategory && !categoryCounts.has(selectedCategory)) {
      refreshFromStore(false);
      return;
    }
    for (const message of change.added) {
      if (!matches(message)) continue;
      messageIndices.set(message.id, messages.length);
      messages.push(message);
      prefix.push(prefix[prefix.length - 1] + estimatedHeight(message));
    }
    virtualList.style.height = `${prefix[messages.length] - prefix[viewHead]}px`;
    if (follow && change.added.length) list.scrollTop = Math.max(0, prefix[messages.length] - prefix[viewHead] - viewportHeight());
    else restoreAnchor(anchor);
    if (change.added.length || change.removed.length || change.cleared) render();
  }

  function updateFilters() {
    refreshFromStore(true);
  }

  function open() {
    if (isOpen()) { close(); return; }
    panel.hidden = false;
    toggle.classList.add('on');
    toggle.setAttribute('aria-expanded', 'true');
    if (!panel.style.height) panel.style.height = 'min(34vh, 360px)';
    refreshFromStore(false);
    if (!hasOpened || followNewMessages) {
      list.scrollTop = Math.max(0, prefix[messages.length] - viewportHeight());
      render();
    }
    hasOpened = true;
    search.focus();
  }

  function close() {
    followNewMessages = isAtBottom();
    panel.hidden = true;
    toggle.classList.remove('on');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }

  function exportAll() {
    let url = null;
    try {
      const data = JSON.stringify(store.getMessages(), null, 2);
      url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'foglio-messages.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report('All retained messages exported as JSON.');
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      reportOperationError('export', error);
    }
  }

  function startResize(event) {
    if (event.button !== 0) return;
    resizeDrag = { y: event.clientY, height: panel.getBoundingClientRect().height || 280 };
    resizeHandle.setAttribute('aria-valuenow', String(Math.round(resizeDrag.height)));
    resizeHandle.setAttribute('aria-valuemax', String(Math.floor(window.innerHeight * 0.7)));
    document.body.classList.add('resizing-messages');
    event.preventDefault();
  }

  function moveResize(event) {
    if (!resizeDrag) return;
    const max = Math.max(180, Math.floor(window.innerHeight * 0.7));
    const height = Math.min(max, Math.max(160, resizeDrag.height - (event.clientY - resizeDrag.y)));
    panel.style.height = `${height}px`;
    resizeHandle.setAttribute('aria-valuenow', String(Math.round(height)));
    render();
  }

  function stopResize() {
    resizeDrag = null;
    document.body.classList.remove('resizing-messages');
  }

  function init() {
    updateCount();
    toggle.addEventListener('click', open);
    panel.querySelector('[data-close-messages]').addEventListener('click', close);
    panel.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => {
      const level = button.dataset.level;
      if (enabledLevels.has(level)) enabledLevels.delete(level);
      else enabledLevels.add(level);
      button.setAttribute('aria-pressed', String(enabledLevels.has(level)));
      button.classList.toggle('off', !enabledLevels.has(level));
      updateFilters();
    }));
    categoryFilter.addEventListener('change', updateFilters);
    search.addEventListener('input', updateFilters);
    panel.querySelector('[data-copy-messages]').addEventListener('click', () => {
      const filtered = messages.slice(viewHead);
      copyText(filtered.map(exportText).join('\n\n')).then(() => report(`${filtered.length} filtered messages copied.`))
        .catch(error => reportOperationError('copy', error));
    });
    panel.querySelector('[data-export-messages]').addEventListener('click', exportAll);
    panel.querySelector('[data-clear-messages]').addEventListener('click', () => {
      if (confirm('Clear all retained messages?')) { store.clear(); report('Messages cleared.'); }
    });
    list.addEventListener('scroll', render, { passive: true });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    resizeHandle.addEventListener('mousedown', startResize);
    resizeHandle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      const max = Math.max(180, Math.floor(window.innerHeight * 0.7));
      const height = Math.min(max, Math.max(160, (panel.getBoundingClientRect().height || 280) + direction * 16));
      panel.style.height = `${height}px`;
      resizeHandle.setAttribute('aria-valuenow', String(Math.round(height)));
      resizeHandle.setAttribute('aria-valuemax', String(max));
      render();
    });
    window.addEventListener('mousemove', moveResize);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('resize', render);
    store.subscribe(handleChange);
  }

  return { init, open, close, isOpen, refresh: () => refreshFromStore(false) };
}
