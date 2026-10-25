/** Shared incremental item search used by the sidebar and contextual link completion. */

export function searchExcerpt(item, query) {
  const text = item.body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[item:[^\]]+\]\]/g, ' ')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const index = text.toLocaleLowerCase().indexOf(query);
  if (index < 0) return '';
  const start = Math.max(0, index - 35), end = Math.min(text.length, index + 85);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function searchItems(items, rawQuery) {
  const query = String(rawQuery ?? '').trim().toLocaleLowerCase();
  const primary = [], content = [], details = new Map();
  if (!query) return { primary, content, details, total: 0 };
  for (const item of items) {
    const matchingTags = item.tags.map(tag => tag.name).filter(name => name.toLocaleLowerCase().includes(query));
    const titleMatch = item.title.toLocaleLowerCase().includes(query);
    const bodyMatch = item.body.toLocaleLowerCase().includes(query);
    if (titleMatch || matchingTags.length) {
      if (matchingTags.length) details.set(item.id, matchingTags.map(name => `:${name}`).join(' '));
      primary.push(item);
    } else if (bodyMatch) {
      details.set(item.id, searchExcerpt(item, query));
      content.push(item);
    }
  }
  return { primary, content, details, total: primary.length + content.length };
}
