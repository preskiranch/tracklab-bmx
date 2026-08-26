import { describe, expect, it } from 'vitest';
import {
  resolveDeferredSatelliteMapView,
  type DeferredSatelliteMapView,
} from '../../src/components/GoogleMapsTrackLayer';
import {
  resolveDeferred3DMapView,
  type Deferred3DMapView,
} from '../../src/components/GoogleMaps3DTrackLayer';
import type { TrackRecord } from '../../src/types';

const track = {
  id: 'delayed-camera-dragstrip',
  name: 'Delayed Camera Dragstrip',
  country: 'United States',
  countryCode: 'CUSTOM',
  state: 'California',
  region: 'North America',
  source: 'Test',
  sourceUrl: 'https://example.test/delayed-camera-dragstrip',
  lengthMeters: 100,
  elevationMeters: 0,
  surface: 'Paved',
  outline: [
    { lat: 38.3550, lng: -121.9780 },
    { lat: 38.3560, lng: -121.9770 },
  ],
  centerline: [
    { lat: 38.3551, lng: -121.9779 },
    { lat: 38.3559, lng: -121.9771 },
  ],
  zones: [],
  leaderboards: { rpm: [], speed: [] },
  routeStatus: 'user-mapped',
} satisfies TrackRecord;

describe('deferred Google Maps camera relay', () => {
  it('uses the latest satellite camera when the loader resolves after a saved-view rerender', async () => {
    const viewRef: { current: DeferredSatelliteMapView } = {
      current: {
        track,
        camera: {
          angle: 10,
          heading: 20,
          center: { lat: 38.3552, lng: -121.9778 },
          zoom: 17,
        },
      },
    };
    const delayedResolution = Promise.resolve().then(() => (
      resolveDeferredSatelliteMapView(viewRef)
    ));

    viewRef.current = {
      track,
      camera: {
        angle: 56,
        heading: 132,
        center: { lat: 38.3557, lng: -121.9773 },
        zoom: 20.25,
      },
    };

    await expect(delayedResolution).resolves.toEqual({
      track,
      camera: {
        angle: 56,
        heading: 132,
        center: { lat: 38.3557, lng: -121.9773 },
        zoom: 20.25,
      },
    });
  });

  it('preserves every locked satellite camera field even when the saved vantage is outside track bounds', () => {
    const camera = {
      angle: 31,
      heading: 244,
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 21.5,
    };
    const viewRef: { current: DeferredSatelliteMapView } = {
      current: { track, camera, cameraLocked: true },
    };

    expect(resolveDeferredSatelliteMapView(viewRef)).toEqual({ track, camera });
  });

  it('uses the latest 3D camera when the library resolves after a saved-view rerender', async () => {
    const viewRef: { current: Deferred3DMapView } = {
      current: {
        trackId: track.id,
        trackCenter: { lat: 38.3555, lng: -121.9775 },
        baseRange: 400,
        angle: 20,
        heading: 30,
        center: null,
        zoom: 18,
      },
    };
    const delayedResolution = Promise.resolve().then(() => (
      resolveDeferred3DMapView(viewRef)
    ));

    viewRef.current = {
      trackId: track.id,
      trackCenter: { lat: 38.3555, lng: -121.9775 },
      baseRange: 500,
      angle: 61,
      heading: 278,
      center: { lat: 38.3558, lng: -121.9772 },
      zoom: 20,
    };

    await expect(delayedResolution).resolves.toEqual({
      trackId: track.id,
      center: { lat: 38.3558, lng: -121.9772 },
      angle: 61,
      heading: 278,
      range: 250,
      baseRange: 500,
      zoom: 20,
    });
  });
});
