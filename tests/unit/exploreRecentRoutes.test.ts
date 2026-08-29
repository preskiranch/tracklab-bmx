import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecentExploreRoutes,
  mergeRecentExploreRoutes,
  reconcileCloudExploreRouteHistory,
  rememberRecentExploreRoute,
  resolveExploreRecentRouteHistoryScope,
} from '../../src/lib/exploreRecentRoutes';
import type { ExploreRoute } from '../../src/types';

function route(index: number): ExploreRoute {
  return {
    id: `EXPLORE-${index}`,
    name: `Route ${index}`,
    origin: { lat: 38.5 + index / 1_000, lng: -121.5 },
    destination: { lat: 38.6 + index / 1_000, lng: -121.4 },
    originLabel: `Start ${index}`,
    destinationLabel: `Finish ${index}`,
    travelMode: index % 2 === 0 ? 'bicycle' : 'drive',
    distanceMeters: 1_000 + index,
    durationSeconds: 300 + index,
    encodedPolyline: `_p~iF~ps|U_ulLnnqC_mqNvxq${index}`,
    waypoints: [{
      point: { lat: 38.55 + index / 1_000, lng: -121.45 },
      label: `Waypoint ${index}`,
    }],
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
    expect(recent[0]).toMatchObject({
      name: 'Route 9',
      waypoints: [{ label: 'Waypoint 9' }],
    });

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

  it('merges cloud history with unsynced local routes without mixing duplicates', () => {
    expect(mergeRecentExploreRoutes(
      [route(7), route(6)],
      [route(6), route(5)],
    ).map((candidate) => candidate.id)).toEqual([
      'EXPLORE-7',
      'EXPLORE-6',
      'EXPLORE-5',
    ]);
  });

  it('treats selected-athlete cloud history as authoritative over a stale tablet cache', () => {
    expect(reconcileCloudExploreRouteHistory(
      [route(7)],
      [route(1)],
      true,
    ).map((candidate) => candidate.id)).toEqual(['EXPLORE-7']);

    expect(reconcileCloudExploreRouteHistory(
      [route(7)],
      [route(1)],
      false,
    ).map((candidate) => candidate.id)).toEqual(['EXPLORE-7', 'EXPLORE-1']);
  });

  it('ignores a stale owner key during kiosk takeover and disables owner cloud history', () => {
    expect(resolveExploreRecentRouteHistoryScope({
      accountProfileKey: 'owner@example.com',
      accountCloudEnabled: true,
      kioskMode: true,
      clubTabletDeviceId: 'tablet-1',
      studioRiderId: null,
    })).toEqual({ profileKey: null, cloudEnabled: false, cloudAuthoritative: false });

    expect(resolveExploreRecentRouteHistoryScope({
      accountProfileKey: 'owner@example.com',
      accountCloudEnabled: true,
      kioskMode: true,
      clubTabletDeviceId: 'tablet-1',
      studioRiderId: 'athlete-a',
    })).toEqual({
      profileKey: 'club-tablet-route-history-v1:tablet-1:athlete-a',
      cloudEnabled: true,
      cloudAuthoritative: true,
    });
  });

  it('isolates route history by both tablet and selected athlete without touching owner cache', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const ownerScope = resolveExploreRecentRouteHistoryScope({
      accountProfileKey: 'owner@example.com',
      accountCloudEnabled: true,
      kioskMode: false,
    });
    const athleteAScope = resolveExploreRecentRouteHistoryScope({
      accountProfileKey: 'owner@example.com',
      accountCloudEnabled: true,
      kioskMode: true,
      clubTabletDeviceId: 'tablet-1',
      studioRiderId: 'athlete-a',
    });
    const athleteBScope = resolveExploreRecentRouteHistoryScope({
      accountProfileKey: 'owner@example.com',
      accountCloudEnabled: true,
      kioskMode: true,
      clubTabletDeviceId: 'tablet-1',
      studioRiderId: 'athlete-b',
    });

    expect(ownerScope.profileKey).toBe('owner@example.com');
    expect(athleteAScope.profileKey).not.toBe(athleteBScope.profileKey);
    rememberRecentExploreRoute(ownerScope.profileKey!, route(7));
    const ownerRoutesBeforeAthleteUse = loadRecentExploreRoutes(ownerScope.profileKey!);
    rememberRecentExploreRoute(athleteAScope.profileKey!, route(1));
    rememberRecentExploreRoute(athleteBScope.profileKey!, route(2));

    expect(loadRecentExploreRoutes(athleteAScope.profileKey!).map(({ id }) => id)).toEqual(['EXPLORE-1']);
    expect(loadRecentExploreRoutes(athleteBScope.profileKey!).map(({ id }) => id)).toEqual(['EXPLORE-2']);
    expect(loadRecentExploreRoutes(ownerScope.profileKey!)).toEqual(ownerRoutesBeforeAthleteUse);
  });
});
