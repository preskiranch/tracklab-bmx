import { afterEach, expect, it, vi } from 'vitest';
import { nextPreviewNarrationVariant, previewNarrationLines, previewNarrationVariationCount } from '../../src/lib/explorePreviewNarration';
import type { ExploreRoute } from '../../src/types';
const route = { id: 'one', name: 'Beach ride', originLabel: 'Start beach', destinationLabel: 'End beach', distanceMeters: 5000 } as ExploreRoute;
afterEach(() => vi.unstubAllGlobals());
it('provides 256 unique tours and avoids a repeat until the full cycle is used', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const tours = new Set<string>();
  for (let i = 0; i < previewNarrationVariationCount; i++) tours.add(previewNarrationLines(route, nextPreviewNarrationVariant(route.id), true).join(' '));
  expect(tours.size).toBe(256);
});
it('uses route facts and omits elevation claims when unavailable', () => {
  const text = previewNarrationLines(route, 0, true).join(' ');
  expect(text).toContain('5.0 kilometers');
  expect(text).toContain('Start beach');
  expect(text).not.toContain('climbing');
  expect(previewNarrationLines({...route, elevationGainMeters: 100}, 0, false).join(' ')).toContain('328 feet');
});
