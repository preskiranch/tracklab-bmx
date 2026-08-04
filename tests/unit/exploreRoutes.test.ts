import { describe, expect, it, vi } from 'vitest';
import { upgradeExploreRoutesToBicycleRoads } from '../../src/lib/exploreRoutes';
import type { ExploreRoute } from '../../src/types';

function savedRoute(id: string, travelMode: ExploreRoute['travelMode']): ExploreRoute {
  return {
    id,
    name: `${id} ride`,
    origin: { lat: 34.02, lng: -118.69 },
    destination: { lat: 34.03, lng: -118.60 },
    originLabel: 'Malibu Pier',
    destinationLabel: 'Malibu Road',
    travelMode,
    distanceMeters: 10_000,
    durationSeconds: 1_800,
    encodedPolyline: 'legacy-polyline',
    waypoints: [{ point: { lat: 34.025, lng: -118.64 }, label: 'Ocean overlook' }],
    elevationSamples: [
      { distanceMeters: 0, elevationMeters: 4 },
      { distanceMeters: 10_000, elevationMeters: 20 },
    ],
    elevationGainMeters: 16,
    elevationLossMeters: 0,
    createdAt: 1_700_000_000_000,
  };
}

describe('saved Explore route upgrades', () => {
  it('rebuilds driving geometry as a bicycle route without duplicating the saved route', async () => {
    const legacy = savedRoute('saved-malibu', 'drive');
    const existingBicycle = savedRoute('saved-sf', 'bicycle');
    const rebuild = vi.fn(async (request) => ({
      ...legacy,
      id: 'generated-bicycle-id',
      travelMode: request.travelMode,
      distanceMeters: 11_200,
      encodedPolyline: 'bicycle-road-polyline',
      elevationGainMeters: 27,
      createdAt: Date.now(),
    }));

    const result = await upgradeExploreRoutesToBicycleRoads([legacy, existingBicycle], rebuild);

    expect(rebuild).toHaveBeenCalledOnce();
    expect(rebuild).toHaveBeenCalledWith(expect.objectContaining({
      origin: legacy.origin,
      destination: legacy.destination,
      originLabel: legacy.originLabel,
      destinationLabel: legacy.destinationLabel,
      routeName: legacy.name,
      travelMode: 'bicycle',
      waypoints: legacy.waypoints,
    }));
    expect(result).toMatchObject({ upgradedCount: 1, failedCount: 0 });
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]).toMatchObject({
      id: legacy.id,
      createdAt: legacy.createdAt,
      name: legacy.name,
      travelMode: 'bicycle',
      encodedPolyline: 'bicycle-road-polyline',
      elevationGainMeters: 27,
    });
    expect(result.routes[1]).toBe(existingBicycle);
  });

  it('keeps a legacy route intact when Google cannot rebuild it so it can retry later', async () => {
    const legacy = savedRoute('saved-retry', 'drive');
    const result = await upgradeExploreRoutesToBicycleRoads(
      [legacy],
      vi.fn().mockRejectedValue(new Error('Routes unavailable')),
    );

    expect(result).toEqual({ routes: [legacy], upgradedCount: 0, failedCount: 1 });
  });
});
