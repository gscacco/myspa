/** Contextual [[ item search popup for the Markdown textarea. */

import { searchItems } from './item-search.js';

let sequence = 0;

function triggerBefore(textarea) {
  if (textarea.selectionStart !== textarea.selectionEnd) return null;
  const caret = textarea.selectionStart, lineStart = textarea.value.lastIndexOf('\n', caret - 1) + 1;
  const open = textarea.value.lastIndexOf('[[', caret);
  if (open < lineStart || textarea.value[open - 1] === '\\') return null;
  const query = textarea.value.slice(open + 2, caret);
  if (query.length > 80 || /[\[\]\n]/.test(query)) return null;
  return { start: open, end: caret, query };
}

function caretPosition(textarea) {
  const document = textarea.ownerDocument, form = textarea.closest('.item-form');
  if (!form) return { left: textarea.offsetLeft, top: textarea.offsetTop + 40 };
  const mirror = document.createElement('div');
  const style = textarea.ownerDocument.defaultView.getComputedStyle(textarea);
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'letterSpacing']) {
    mirror.style[property] = style[property];
  }
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${textarea.clientWidth}px`, boxSizing: 'border-box' });
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
  const marker = document.createElement('span'); marker.textContent = '\u200b'; mirror.append(marker);
  form.append(mirror);
  const left = textarea.offsetLeft + marker.offsetLeft, top = textarea.offsetTop + marker.offsetTop + marker.offsetHeight;
  mirror.remove();
  return { left, top };
}

export function attachLinkCompletion(textarea, { getItems }) {
  const document = textarea.ownerDocument, form = textarea.closest('.item-form');
  if (!form) return () => {};
  const popup = document.createElement('div');
  popup.className = 'link-completion'; popup.id = `link-completion-${++sequence}`;
  popup.hidden = true; popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', 'Link to item');
  form.append(popup);
  textarea.setAttribute('aria-controls', popup.id);
  textarea.setAttribute('aria-autocomplete', 'list');
  textarea.setAttribute('aria-expanded', 'false');
  let current = null, options = [], active = -1, dismissed = null;

  function setExpanded(expanded) {
    popup.hidden = !expanded;
    textarea.setAttribute('aria-expanded', String(expanded));
    if (!expanded) textarea.removeAttribute('aria-activedescendant');
  }

  function setActive(index) {
    active = options.length ? (index + options.length) % options.length : -1;
    for (const [position, option] of options.entries()) {
      const selected = position === active;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
    }
    if (active >= 0) textarea.setAttribute('aria-activedescendant', options[active].id);
    else textarea.removeAttribute('aria-activedescendant');
  }

  function option(item, detail) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'search-result link-completion-option'; button.id = `${popup.id}-${item.id}`;
    button.setAttribute('role', 'option'); button.dataset.itemId = item.id;
    const title = document.createElement('span'); title.className = 'search-title'; title.textContent = item.title; button.append(title);
    if (detail) { const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = detail; button.append(meta); }
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => choose(item.id));
    return button;
  }

  function group(kind, label, items, details) {
    if (!items.length) return null;
    const section = document.createElement('section'); section.className = 'search-group'; section.dataset.searchGroup = kind;
    const heading = document.createElement('h3'); heading.textContent = label; section.append(heading);
    for (const item of items) { const result = option(item, details.get(item.id)); options.push(result); section.append(result); }
    return section;
  }

  function render(trigger) {
    popup.replaceChildren(); options = []; active = -1;
    if (!trigger.query) {
      const empty = document.createElement('p'); empty.className = 'link-completion-empty'; empty.textContent = 'Type to search items'; popup.append(empty);
    } else {
      const result = searchItems(getItems(), trigger.query);
      const primary = group('titles-tags', 'Titles and tags', result.primary, result.details);
      const content = group('content', 'Content', result.content, result.details);
      if (primary) popup.append(primary);
      if (content) popup.append(content);
      if (!result.total) { const empty = document.createElement('p'); empty.className = 'link-completion-empty'; empty.textContent = 'No matching items'; popup.append(empty); }
    }
    const position = caretPosition(textarea);
    popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
    setExpanded(true); setActive(options.length ? 0 : -1);
  }

  function close() { setExpanded(false); current = null; }

  function choose(id) {
    if (!current) return;
    textarea.setRangeText(`[[item:${id}]]`, current.start, current.end, 'end');
    textarea.dispatchEvent(new (textarea.ownerDocument.defaultView.Event)('input', { bubbles: true }));
    close(); textarea.focus();
  }

  function refresh() {
    const trigger = triggerBefore(textarea);
    if (!trigger || (dismissed && dismissed.start === trigger.start && dismissed.end === trigger.end && dismissed.query === trigger.query)) { close(); return; }
    dismissed = null; current = trigger; render(trigger);
  }

  function input() { refresh(); }
  function click() { refresh(); }
  function keydown(event) {
    if (popup.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissed = current ? { ...current } : null;
      close(); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault(); setActive(active + (event.key === 'ArrowDown' ? 1 : -1)); return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (!options.length) return;
      event.preventDefault(); choose(options[Math.max(active, 0)].dataset.itemId);
    }
  }

  textarea.addEventListener('input', input);
  textarea.addEventListener('click', click);
  textarea.addEventListener('keydown', keydown);
  return () => {
    textarea.removeEventListener('input', input); textarea.removeEventListener('click', click); textarea.removeEventListener('keydown', keydown);
    popup.remove(); textarea.removeAttribute('aria-controls'); textarea.removeAttribute('aria-autocomplete'); textarea.removeAttribute('aria-expanded');
  };
}
