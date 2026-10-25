/** Contextual completion for tags already used by Loom items. */

let sequence = 0;

function currentToken(input) {
  if (input.selectionStart !== input.selectionEnd) return null;
  const caret = input.selectionStart;
  const before = input.value.slice(0, caret), after = input.value.slice(caret);
  const left = /\S*$/.exec(before)[0], right = /^\S*/.exec(after)[0];
  const token = left + right;
  if (token.length > 80) return null;
  return { start: caret - left.length, end: caret + right.length, query: token.replace(/^:/, '') };
}

function signature(trigger) { return `${trigger.start}:${trigger.end}:${trigger.query}`; }

function availableTags(getTags, input, trigger, query) {
  const occupied = new Set(`${input.value.slice(0, trigger.start)} ${input.value.slice(trigger.end)}`
    .split(/\s+/).filter(Boolean).map(tag => tag.replace(/^:/, '').toLocaleLowerCase()));
  const folded = query.toLocaleLowerCase(), unique = new Map();
  for (const value of getTags()) {
    if (typeof value === 'string' && value && !unique.has(value)) unique.set(value, value);
  }
  return [...unique.values()]
    .filter(tag => !occupied.has(tag.toLocaleLowerCase()) && tag.toLocaleLowerCase().includes(folded))
    .sort((left, right) => {
      const leftPrefix = left.toLocaleLowerCase().startsWith(folded);
      const rightPrefix = right.toLocaleLowerCase().startsWith(folded);
      if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      return left.localeCompare(right);
    })
    .slice(0, 30);
}

export function attachTagCompletion(input, { getTags }) {
  const document = input.ownerDocument, field = input.closest('label');
  if (!field) return () => {};
  field.classList.add('tag-field');
  const popup = document.createElement('div');
  popup.className = 'tag-completion'; popup.id = `tag-completion-${++sequence}`;
  popup.hidden = true; popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', 'Existing tags');
  field.append(popup);
  input.setAttribute('aria-controls', popup.id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  let current = null, options = [], active = -1, dismissed = null;

  function setExpanded(expanded) {
    popup.hidden = !expanded;
    input.setAttribute('aria-expanded', String(expanded));
    if (!expanded) input.removeAttribute('aria-activedescendant');
  }

  function setActive(index) {
    active = options.length ? (index + options.length) % options.length : -1;
    for (const [position, option] of options.entries()) {
      const selected = position === active;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
    }
    if (active >= 0) input.setAttribute('aria-activedescendant', options[active].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function close() { setExpanded(false); current = null; }

  function choose(tag) {
    if (!current) return;
    input.setRangeText(tag, current.start, current.end, 'end');
    input.dispatchEvent(new (input.ownerDocument.defaultView.Event)('input', { bubbles: true }));
    close(); input.focus();
  }

  function option(tag) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tag-completion-option';
    button.id = `${popup.id}-${options.length}`; button.dataset.tag = tag;
    button.setAttribute('role', 'option'); button.textContent = `:${tag}`;
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => choose(tag));
    return button;
  }

  function render(trigger) {
    popup.replaceChildren(); options = []; active = -1;
    const tags = availableTags(getTags, input, trigger, trigger.query);
    if (!tags.length) { close(); return; }
    options = tags.map(option);
    popup.append(...options);
    setExpanded(true); setActive(0);
  }

  function refresh() {
    if (document.activeElement !== input) { close(); return; }
    const trigger = currentToken(input);
    if (!trigger) { close(); return; }
    if (dismissed === signature(trigger)) { close(); return; }
    dismissed = null; current = trigger; render(trigger);
  }

  function onFocus() { dismissed = null; refresh(); }
  function onInput() { dismissed = null; refresh(); }
  function onClick() { refresh(); }
  function onBlur() { close(); }
  function onKeydown(event) {
    if (popup.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault(); dismissed = current ? signature(current) : null; close(); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault(); setActive(active + (event.key === 'ArrowDown' ? 1 : -1)); return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (!options.length) return;
      event.preventDefault(); choose(options[Math.max(active, 0)].dataset.tag);
    }
  }

  input.addEventListener('focus', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('click', onClick);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);
  return () => {
    input.removeEventListener('focus', onFocus); input.removeEventListener('input', onInput);
    input.removeEventListener('click', onClick); input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKeydown);
    popup.remove(); field.classList.remove('tag-field');
    input.removeAttribute('aria-controls'); input.removeAttribute('aria-autocomplete'); input.removeAttribute('aria-expanded');
  };
}
