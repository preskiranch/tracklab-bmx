import { describe, expect, it } from 'vitest';
import {
  publicTrackExplorerMarkers,
  publicTrackExplorerMarkerTitle,
  publicTrackExplorerPoint,
} from '../../src/lib/publicTrackExplorer';
import type { TrackLocatorRecord } from '../../src/types';

function track(overrides: Partial<TrackLocatorRecord> = {}): TrackLocatorRecord {
  return {
    id: 'track-one',
    name: 'Track One BMX',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'California',
    source: 'Test directory',
    city: 'Napa',
    latitude: 38.3,
    longitude: -122.3,
    ...overrides,
  };
}

describe('public track Earth explorer', () => {
  it('builds one marker for every uniquely identified track with usable coordinates', () => {
    const first = track();
    const second = track({ id: 'track-two', name: 'Track Two BMX', latitude: -37.8, longitude: 144.9 });
    const markers = publicTrackExplorerMarkers([
      first,
      second,
      { ...first, name: 'Duplicate record' },
      track({ id: 'invalid-latitude', latitude: 91 }),
      track({ id: 'missing-longitude', longitude: undefined }),
    ]);

    expect(markers).toEqual([
      { position: { lat: 38.3, lng: -122.3 }, track: first },
      { position: { lat: -37.8, lng: 144.9 }, track: second },
    ]);
  });

  it('provides map-safe coordinates and an accessible TrackLab navigation label', () => {
    const melbourne = track({
      id: 'melbourne-bmx',
      name: 'Melbourne BMX',
      city: 'Melbourne',
      state: 'Victoria',
      country: 'Australia',
      latitude: '-37.8136' as unknown as number,
      longitude: '144.9631' as unknown as number,
    });

    expect(publicTrackExplorerPoint(melbourne)).toEqual({ lat: -37.8136, lng: 144.9631 });
    expect(publicTrackExplorerMarkerTitle(melbourne)).toBe(
      'Melbourne BMX — Melbourne, Victoria, Australia. Open TrackLab track details',
    );
  });
});
