import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecentExploreRoutes,
  rememberRecentExploreRoute,
} from '../../src/lib/exploreRecentRoutes';
import type { ExploreRoute } from '../../src/types';

function route(index: number): ExploreRoute {
  return {
    id: `EXPLORE-${index}`,
    origin: { lat: 38.5 + index / 1_000, lng: -121.5 },
    destination: { lat: 38.6 + index / 1_000, lng: -121.4 },
    originLabel: `Start ${index}`,
    destinationLabel: `Finish ${index}`,
    travelMode: index % 2 === 0 ? 'bicycle' : 'drive',
    distanceMeters: 1_000 + index,
    durationSeconds: 300 + index,
    encodedPolyline: `_p~iF~ps|U_ulLnnqC_mqNvxq${index}`,
    elevationSamples: [
      { distanceMeters: 0, elevationMeters: 10 },
      { distanceMeters: 1_000 + index, elevationMeters: 20 },
    ],
    elevationGainMeters: 10,
    elevationLossMeters: 0,
    createdAt: 1_700_000_000_000 + index,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recent Explore routes', () => {
  it('keeps the eight most recent routes per account and moves reused routes to the top', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    for (let index = 0; index < 10; index += 1) {
      rememberRecentExploreRoute('rider@example.com', route(index));
    }
    const recent = loadRecentExploreRoutes('rider@example.com');
    expect(recent).toHaveLength(8);
    expect(recent.map((candidate) => candidate.id)).toEqual([
      'EXPLORE-9',
      'EXPLORE-8',
      'EXPLORE-7',
      'EXPLORE-6',
      'EXPLORE-5',
      'EXPLORE-4',
      'EXPLORE-3',
      'EXPLORE-2',
    ]);

    rememberRecentExploreRoute('rider@example.com', route(5));
    expect(loadRecentExploreRoutes('rider@example.com')[0].id).toBe('EXPLORE-5');
    expect(loadRecentExploreRoutes('another@example.com')).toEqual([]);
  });

  it('ignores corrupted stored routes instead of breaking Explore setup', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => JSON.stringify([{ id: 'broken' }, route(1)]),
        setItem: vi.fn(),
      },
    });

    expect(loadRecentExploreRoutes('rider@example.com').map((candidate) => candidate.id))
      .toEqual(['EXPLORE-1']);
  });
});
