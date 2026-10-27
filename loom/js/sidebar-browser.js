/** Deterministic ordering and pagination for the sidebar item browser. */

export const SIDEBAR_PAGE_SIZE = 8;

export function itemsByUpdated(items) {
  return [...items].sort((left, right) => {
    const byUpdated = right['updated-at'].localeCompare(left['updated-at']);
    return byUpdated || left.id.localeCompare(right.id);
  });
}

export function recentItems(items, ids) {
  const byId = new Map(items.map(item => [item.id, item]));
  const seen = new Set();
  const recent = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (item) recent.push(item);
  }
  return recent;
}

export function itemsWithTag(items, rawTag) {
  const tag = String(rawTag ?? '').trim().replace(/^:/, '');
  if (!tag) return [];
  return items.filter(item => item.tags.some(candidate => candidate.name === tag));
}

export function pageSlice(items, requestedPage = 1, pageSize = SIDEBAR_PAGE_SIZE) {
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : SIDEBAR_PAGE_SIZE;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const candidate = Number.isInteger(requestedPage) ? requestedPage : 1;
  const page = Math.min(pageCount, Math.max(1, candidate));
  const start = (page - 1) * size;
  const end = Math.min(total, start + size);
  return {
    items: items.slice(start, end),
    page,
    pageCount,
    total,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

export function searchEntries(found) {
  return [
    ...found.primary.map(item => ({ kind: 'titles-tags', item })),
    ...found.content.map(item => ({ kind: 'content', item })),
  ];
}
