/** Filters the combined import and schedule diagnostics without changing their order. */
export function filterIssues(items, { severity = 'all', category = 'all', query = '' } = {}) {
  const term = String(query).trim().toLocaleLowerCase();
  return items.filter(item => {
    if (severity !== 'all' && item.severity !== severity) return false;
    if (category !== 'all' && item.category !== category) return false;
    if (!term) return true;
    const searchable = [item.text, item.code, item.resourceName, item.path, ...(item.lessonIds || []), item.searchText]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.includes(term);
  });
}

export function countOpenIssues(items) {
  return items.filter(item => item.severity === 'error' || item.severity === 'warning').length;
}
