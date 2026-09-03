import { describe, expect, it } from 'vitest';
import {
  publicTrackEarthPinAltitudeMeters,
  publicTrackEarthRevealRadiusMeters,
  publicTrackEarthVisibleMarkers,
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

  it('reveals more named track pins as the Earth camera rises', () => {
    const selected = track();
    const nearby = track({ id: 'nearby', name: 'Nearby BMX', latitude: 38.32, longitude: -122.3 });
    const regional = track({ id: 'regional', name: 'Regional BMX', latitude: 39.3, longitude: -122.3 });
    const distant = track({ id: 'distant', name: 'Distant BMX', latitude: -37.8, longitude: 144.9 });
    const markers = publicTrackExplorerMarkers([selected, nearby, regional, distant]);
    const center = { lat: 38.3, lng: -122.3 };

    expect(publicTrackEarthVisibleMarkers(markers, center, 1_000, selected.id).map(({ track: item }) => item.id))
      .toEqual(['track-one', 'nearby']);
    expect(publicTrackEarthVisibleMarkers(markers, center, 30_000, selected.id).map(({ track: item }) => item.id))
      .toEqual(['track-one', 'nearby', 'regional']);
    expect(publicTrackEarthVisibleMarkers(markers, center, 4_200_000, selected.id)).toHaveLength(4);
  });

  it('keeps the selected track available after panning and scales its ground tether for camera range', () => {
    const selected = track();
    const markers = publicTrackExplorerMarkers([selected]);

    expect(publicTrackEarthVisibleMarkers(markers, { lat: -37.8, lng: 144.9 }, 1_000, selected.id)[0]?.track.id)
      .toBe(selected.id);
    expect(publicTrackEarthRevealRadiusMeters(1_000)).toBe(5_000);
    expect(publicTrackEarthPinAltitudeMeters(20_000)).toBeGreaterThan(publicTrackEarthPinAltitudeMeters(1_000));
    expect(publicTrackEarthPinAltitudeMeters(Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(90);
  });

  it('loads every valid directory pin at global range without losing the selected track', () => {
    const catalog = Array.from({ length: 1_305 }, (_, index) => track({
      id: `global-${index}`,
      name: `Global Track ${index}`,
      latitude: -80 + ((index * 37) % 160),
      longitude: -179 + ((index * 53) % 358),
    }));
    const markers = publicTrackExplorerMarkers(catalog);
    const visible = publicTrackEarthVisibleMarkers(
      markers,
      { lat: 0, lng: 0 },
      4_200_000,
      catalog[712].id,
    );

    expect(visible).toHaveLength(1_305);
    expect(visible[0]?.track.id).toBe(catalog[712].id);
    expect(new Set(visible.map(({ track: item }) => item.id)).size).toBe(1_305);
  });
});
