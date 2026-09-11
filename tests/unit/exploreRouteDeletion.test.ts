import { expect, it } from 'vitest';
import { mergeExploreRouteHistoryEntries } from '../../cloud/exploreRouteHistory.mjs';
const sanitize = (entries: any[]) => [...new Map(entries.filter(x => x.createdAt).map(x => [x.id, x])).values()];
it('keeps a deleted route removed when an older device uploads its cache', () => {
  const old = { id: 'a', createdAt: 10 };
  const other = { id: 'b', createdAt: 20 };
  const removed = mergeExploreRouteHistoryEntries([{ id: 'a', deletedAt: 30 }], [old, other], sanitize);
  expect(sanitize(removed)).toEqual([other]);
  expect(sanitize(mergeExploreRouteHistoryEntries([old], removed, sanitize))).toEqual([other]);
});
it('allows a freshly rebuilt route and retains deletion history for stale clients', () => {
  const result = mergeExploreRouteHistoryEntries([{ id: 'a', createdAt: 40 }], [{ id: 'a', deletedAt: 30 }], sanitize);
  expect(sanitize(result)).toEqual([{ id: 'a', createdAt: 40 }]);
  expect(result).toContainEqual({ id: 'a', deletedAt: 30 });
});
