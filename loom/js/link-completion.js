/** Contextual [[ item and file search popup for the Markdown textarea. */

import { searchItems } from './item-search.js';
import { isImageAttachment } from './attachments.js';

let sequence = 0;

function triggerBefore(textarea) {
  if (textarea.selectionStart !== textarea.selectionEnd) return null;
  const caret = textarea.selectionStart, lineStart = textarea.value.lastIndexOf('\n', caret - 1) + 1;
  const open = textarea.value.lastIndexOf('[[', caret);
  if (open < lineStart || textarea.value[open - 1] === '\\') return null;
  const query = textarea.value.slice(open + 2, caret);
  if (query.length > 80 || /[\[\]\n]/.test(query)) return null;
  return { start: open, end: caret, query, embed: open > lineStart && textarea.value[open - 1] === '!' };
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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(document) {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.classList.add('link-completion-file-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M6 3h8l4 4v14H6zM14 3v5h5');
  icon.append(path);
  return icon;
}

function filePreview(document, attachment) {
  const preview = document.createElement('span');
  preview.className = 'link-completion-preview';
  if (isImageAttachment(attachment) && typeof attachment.url === 'string' && attachment.url) {
    const image = document.createElement('img');
    image.src = attachment.url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    preview.append(image);
  } else {
    preview.append(fileIcon(document));
  }
  return preview;
}

function fileDetails(attachment) {
  return `${attachment.type || 'application/octet-stream'} · ${formatSize(attachment.size)}`;
}

export function attachLinkCompletion(textarea, { getItems, getAttachments = () => [], getItemAttachment = () => null }) {
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
    const imageAttachment = item.kind?.name === 'image' ? getItemAttachment(item['attachment-id']) : null;
    if (imageAttachment) {
      button.classList.add('link-completion-file');
      const details = document.createElement('span'); details.className = 'link-completion-file-text';
      const title = document.createElement('span'); title.className = 'search-title'; title.textContent = item.title;
      const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = detail || 'Image item';
      details.append(title, meta); button.append(filePreview(document, imageAttachment), details);
    } else {
      const title = document.createElement('span'); title.className = 'search-title'; title.textContent = item.title; button.append(title);
      if (detail) { const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = detail; button.append(meta); }
    }
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => choose(item.id));
    return button;
  }

  function fileOption(attachment) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'search-result link-completion-option link-completion-file';
    button.id = `${popup.id}-file-${attachment.id}`;
    button.setAttribute('role', 'option'); button.dataset.fileId = attachment.id; button.title = attachment.name;
    const details = document.createElement('span'); details.className = 'link-completion-file-text';
    const title = document.createElement('span'); title.className = 'search-title'; title.textContent = attachment.name;
    const meta = document.createElement('span'); meta.className = 'search-meta'; meta.textContent = fileDetails(attachment);
    details.append(title, meta);
    button.append(filePreview(document, attachment), details);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => choose(attachment.id));
    return button;
  }

  function group(kind, label, items, details) {
    if (!items.length) return null;
    const section = document.createElement('section'); section.className = 'search-group'; section.dataset.searchGroup = kind;
    const heading = document.createElement('h3'); heading.textContent = label; section.append(heading);
    for (const item of items) { const result = option(item, details.get(item.id)); options.push(result); section.append(result); }
    return section;
  }

  function renderFiles(query) {
    popup.setAttribute('aria-label', 'Insert file reference');
    const all = getAttachments();
    const needle = query.toLocaleLowerCase();
    const files = all
      .filter(attachment => !needle || attachment.name.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right['created-at'].localeCompare(left['created-at']));
    if (!files.length) {
      const empty = document.createElement('p'); empty.className = 'link-completion-empty';
      empty.textContent = all.length ? 'No matching files' : 'No saved files';
      popup.append(empty); return;
    }
    const section = document.createElement('section');
    section.className = 'search-group'; section.dataset.searchGroup = 'files';
    const heading = document.createElement('h3'); heading.textContent = 'Files'; section.append(heading);
    for (const attachment of files) {
      const result = fileOption(attachment); options.push(result); section.append(result);
    }
    popup.append(section);
  }

  function renderItems(query, embed) {
    popup.setAttribute('aria-label', embed ? 'Embed item' : 'Link to item');
    if (!query && embed) {
      const images = getItems().filter(item => item.kind?.name === 'image')
        .sort((left, right) => right['updated-at'].localeCompare(left['updated-at']));
      if (images.length) {
        const imageGroup = group('images', 'Images', images, new Map());
        if (imageGroup) popup.append(imageGroup);
        return;
      }
    }
    if (!query) {
      const empty = document.createElement('p'); empty.className = 'link-completion-empty'; empty.textContent = 'Type to search items'; popup.append(empty);
      return;
    }
    const result = searchItems(getItems(), query);
    const primary = group('titles-tags', 'Titles and tags', result.primary, result.details);
    const content = group('content', 'Content', result.content, result.details);
    if (primary) popup.append(primary);
    if (content) popup.append(content);
    if (!result.total) { const empty = document.createElement('p'); empty.className = 'link-completion-empty'; empty.textContent = 'No matching items'; popup.append(empty); }
  }

  function render(trigger) {
    popup.replaceChildren(); options = []; active = -1;
    const file = /^file:(.*)$/i.exec(trigger.query);
    if (file) renderFiles(file[1].trim());
    else renderItems(trigger.query, trigger.embed);
    const position = caretPosition(textarea);
    popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
    setExpanded(true); setActive(options.length ? 0 : -1);
  }

  function close() { setExpanded(false); current = null; }

  function choose(id) {
    if (!current) return;
    const kind = /^file:/i.test(current.query) ? 'file' : 'item';
    textarea.setRangeText(`[[${kind}:${id}]]`, current.start, current.end, 'end');
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
      const selected = options[Math.max(active, 0)];
      event.preventDefault(); choose(selected.dataset.fileId || selected.dataset.itemId);
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
