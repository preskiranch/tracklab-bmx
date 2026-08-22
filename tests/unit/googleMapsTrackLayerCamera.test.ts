import { describe, expect, it } from 'vitest';
import { scheduleSatelliteTileRepaints } from '../../src/components/GoogleMapsTrackLayer';
import type { GoogleMap, GoogleMapsRuntime } from '../../src/lib/googleMaps';
import type { EarthCamera, TrackRecord } from '../../src/types';

const track = {
  id: 'camera-rotation-test-track',
  name: 'Camera rotation test track',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'North America',
  source: 'Test',
  sourceUrl: 'https://example.test/track',
  lengthMeters: 400,
  elevationMeters: 0,
  surface: 'Clay',
  outline: [
    { lat: 38.3550, lng: -121.9780 },
    { lat: 38.3560, lng: -121.9770 },
  ],
  zones: [],
  leaderboards: { rpm: [], speed: [] },
} satisfies TrackRecord;

describe('Google Maps satellite camera repaints', () => {
  it('keeps the newest camera through portrait-landscape-portrait delayed repaints', () => {
    const cameraMoves: Array<Record<string, unknown>> = [];
    let fitBoundsCalls = 0;
    let resizeTriggers = 0;
    const map = {
      addListener: () => ({ remove: () => undefined }),
      fitBounds: () => { fitBoundsCalls += 1; },
      moveCamera: (camera: Record<string, unknown>) => { cameraMoves.push(camera); },
      setHeading: () => undefined,
      setOptions: () => undefined,
      setTilt: () => undefined,
    } as unknown as GoogleMap;
    const google = {
      maps: {
        event: {
          trigger: (_target: unknown, eventName: string) => {
            if (eventName === 'resize') {
              resizeTriggers += 1;
            }
          },
        },
      },
    } as unknown as GoogleMapsRuntime;
    const cameraRef: { current: Partial<EarthCamera> } = {
      current: {
        angle: 42,
        center: { lat: 38.3552, lng: -121.9778 },
        heading: 20,
        zoom: 18,
      },
    };
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];

    scheduleSatelliteTileRepaints(
      google,
      map,
      cameraRef,
      track,
      (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      },
    );

    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual([0, 90, 260, 700, 1400]);
    scheduled[0].callback();

    cameraRef.current = {
      angle: 55,
      center: { lat: 38.3555, lng: -121.9775 },
      heading: 125,
      zoom: 19.25,
    };
    scheduled[1].callback();
    scheduled[2].callback();

    cameraRef.current = {
      angle: 38,
      center: { lat: 38.3558, lng: -121.9772 },
      heading: 310,
      zoom: 20,
    };
    scheduled[3].callback();
    scheduled[4].callback();

    expect(cameraMoves).toEqual([
      { center: { lat: 38.3552, lng: -121.9778 }, heading: 20, tilt: 42, zoom: 18 },
      { center: { lat: 38.3555, lng: -121.9775 }, heading: 125, tilt: 55, zoom: 19.25 },
      { center: { lat: 38.3555, lng: -121.9775 }, heading: 125, tilt: 55, zoom: 19.25 },
      { center: { lat: 38.3558, lng: -121.9772 }, heading: 310, tilt: 38, zoom: 20 },
      { center: { lat: 38.3558, lng: -121.9772 }, heading: 310, tilt: 38, zoom: 20 },
    ]);
    expect(resizeTriggers).toBe(5);
    expect(fitBoundsCalls).toBe(0);
  });
});
