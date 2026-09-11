export function mergeExploreRouteHistoryEntries(preferred, fallback, sanitizeExploreRouteHistory) {
  const entries = [...(Array.isArray(preferred) ? preferred : []), ...(Array.isArray(fallback) ? fallback : [])];
  const deleted = new Map();
  for (const entry of entries) {
    if (typeof entry?.id === 'string' && Number.isFinite(entry.deletedAt)) {
      deleted.set(entry.id, Math.max(deleted.get(entry.id) ?? 0, entry.deletedAt));
    }
  }
  return [
    ...sanitizeExploreRouteHistory(entries.filter(entry => !deleted.has(entry?.id)
      || Number(entry.createdAt) > deleted.get(entry.id))),
    ...[...deleted].map(([id, deletedAt]) => ({ id, deletedAt })),
  ];
}

