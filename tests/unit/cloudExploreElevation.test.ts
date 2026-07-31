import { describe, expect, it, vi } from 'vitest';
import {
  exploreElevationPathParameter,
  exploreElevationSampleCount,
  fetchExploreElevationProfile,
  normalizeExploreElevationProfile,
} from '../../cloud/exploreElevation.mjs';

describe('cloud Explore elevation sampling', () => {
  it('uses route-sized sampling within Google limits', () => {
    expect(exploreElevationSampleCount(1)).toBe(2);
    expect(exploreElevationSampleCount(1_000)).toBe(21);
    expect(exploreElevationSampleCount(1_000_000)).toBe(256);
    expect(exploreElevationPathParameter('_p~iF~ps|U')).toBe('enc:_p~iF~ps|U');
  });

  it('normalizes an evenly spaced, smoothed route profile', () => {
    const profile = normalizeExploreElevationProfile([
      { elevation: 100 },
      { elevation: 110 },
      { elevation: 90 },
    ], 1_000);

    expect(profile?.samples).toEqual([
      { distanceMeters: 0, elevationMeters: 100 },
      { distanceMeters: 500, elevationMeters: 102.5 },
      { distanceMeters: 1_000, elevationMeters: 90 },
    ]);
    expect(profile?.gainMeters).toBeCloseTo(2.5, 8);
    expect(profile?.lossMeters).toBeCloseTo(12.5, 8);
  });

  it('requests elevation with the server-held key and never returns it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 'OK',
      results: [{ elevation: 10 }, { elevation: 20 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const profile = await fetchExploreElevationProfile({
      apiKey: 'server-secret-key',
      distanceMeters: 100,
      encodedPolyline: '_p~iF~ps|U',
      fetchImpl,
    });

    const requestedUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('path=enc%3A_p%7EiF%7Eps%7CU');
    expect(requestedUrl).toContain('samples=3');
    expect(requestedUrl).toContain('key=server-secret-key');
    expect(JSON.stringify(profile)).not.toContain('server-secret-key');
  });
});
