import { describe, expect, it } from 'vitest';
import {
  createSatelliteCameraSyncHandler,
  restartSatelliteTileRepaints,
  scheduleSatelliteFitFinalization,
  scheduleSatelliteTileRepaints,
} from '../../src/components/GoogleMapsTrackLayer';
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
    const viewRef = {
      current: {
        track,
        camera: cameraRef.current,
        cameraLocked: false,
      },
    };
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];

    scheduleSatelliteTileRepaints(
      google,
      map,
      cameraRef,
      viewRef,
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

  it('restarts the complete repaint sequence for each viewport resize', () => {
    const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
    const cancelled: number[] = [];
    let nextTimer = 0;
    let resizeTriggers = 0;
    const cameraMoves: Array<Record<string, unknown>> = [];
    const map = {
      addListener: () => ({ remove: () => undefined }),
      fitBounds: () => undefined,
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
        angle: 47,
        center: { lat: 38.3554, lng: -121.9776 },
        heading: 180,
        zoom: 19,
      },
    };
    const viewRef = {
      current: {
        track,
        camera: cameraRef.current,
        cameraLocked: true,
      },
    };
    const scheduleTimer = (callback: () => void, delayMs: number) => {
      nextTimer += 1;
      scheduled.set(nextTimer, { callback, delayMs });
      return nextTimer;
    };
    const cancelTimer = (timer: number) => {
      cancelled.push(timer);
      scheduled.delete(timer);
    };

    let repaintTimers = restartSatelliteTileRepaints(
      [],
      google,
      map,
      cameraRef,
      viewRef,
      cancelTimer,
      scheduleTimer,
    );
    expect(repaintTimers).toEqual([1, 2, 3, 4, 5]);

    cameraRef.current = {
      angle: 35,
      center: { lat: 38.3558, lng: -121.9772 },
      heading: 270,
      zoom: 20.5,
    };
    repaintTimers = restartSatelliteTileRepaints(
      repaintTimers,
      google,
      map,
      cameraRef,
      viewRef,
      cancelTimer,
      scheduleTimer,
    );

    expect(cancelled).toEqual([1, 2, 3, 4, 5]);
    expect(repaintTimers).toEqual([6, 7, 8, 9, 10]);
    expect(repaintTimers.map((timer) => scheduled.get(timer)?.delayMs)).toEqual([0, 90, 260, 700, 1400]);
    repaintTimers.forEach((timer) => scheduled.get(timer)?.callback());
    expect(resizeTriggers).toBe(5);
    expect(cameraMoves).toHaveLength(5);
    expect(cameraMoves.every((camera) => (
      camera.center != null
      && (camera.center as { lat: number }).lat === 38.3558
      && camera.heading === 270
      && camera.tilt === 35
      && camera.zoom === 20.5
    ))).toBe(true);
  });

  it('cancels and generation-guards stale track-fit callbacks', () => {
    const frames = new Map<number, () => void>();
    const timers = new Map<number, () => void>();
    const cancelledFrames: number[] = [];
    const cancelledTimers: number[] = [];
    const generationRef = { current: 1 };
    let nextFrame = 0;
    let nextTimer = 10;
    let staleApplies = 0;
    let staleReleases = 0;

    const stale = scheduleSatelliteFitFinalization(
      generationRef,
      1,
      () => { staleApplies += 1; },
      () => { staleReleases += 1; },
      (callback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      },
      (frameRequest) => { cancelledFrames.push(frameRequest); },
      (callback) => {
        nextTimer += 1;
        timers.set(nextTimer, callback);
        return nextTimer;
      },
      (timer) => { cancelledTimers.push(timer); },
    );

    generationRef.current = 2;
    frames.get(stale.frameRequest)?.();
    timers.get(stale.releaseTimer)?.();
    stale.cancel();
    expect(staleApplies).toBe(0);
    expect(staleReleases).toBe(0);
    expect(cancelledFrames).toEqual([stale.frameRequest]);
    expect(cancelledTimers).toEqual([stale.releaseTimer]);

    let latestApplies = 0;
    let latestReleases = 0;
    const latest = scheduleSatelliteFitFinalization(
      generationRef,
      2,
      () => { latestApplies += 1; },
      () => { latestReleases += 1; },
      (callback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      },
      (frameRequest) => { cancelledFrames.push(frameRequest); },
      (callback) => {
        nextTimer += 1;
        timers.set(nextTimer, callback);
        return nextTimer;
      },
      (timer) => { cancelledTimers.push(timer); },
    );
    frames.get(latest.frameRequest)?.();
    timers.get(latest.releaseTimer)?.();
    expect(latestApplies).toBe(2);
    expect(latestReleases).toBe(1);
  });

  it('keeps one listener wired to the latest camera-change callback and view', () => {
    let tilt = 41;
    let heading = 175;
    let zoom = 18.5;
    const map = {
      getCenter: () => ({ toJSON: () => ({ lat: 38.3554, lng: -121.9776 }) }),
      getHeading: () => heading,
      getTilt: () => tilt,
      getZoom: () => zoom,
    } as unknown as GoogleMap;
    const cameraRef: { current: Partial<EarthCamera> } = { current: {} };
    const viewRef = {
      current: {
        track,
        camera: { angle: 0, heading: 0 },
        cameraLocked: false,
      },
    };
    const suppressRef = { current: false };
    const firstChanges: Partial<EarthCamera>[] = [];
    const secondChanges: Partial<EarthCamera>[] = [];
    const callbackRef: { current: ((camera: Partial<EarthCamera>) => void) | undefined } = {
      current: (camera) => firstChanges.push(camera),
    };
    const syncCamera = createSatelliteCameraSyncHandler(
      map,
      cameraRef,
      viewRef,
      suppressRef,
      callbackRef,
      () => 1234,
    );

    syncCamera();
    callbackRef.current = (camera) => secondChanges.push(camera);
    tilt = 53;
    heading = 275;
    zoom = 20;
    syncCamera();

    expect(firstChanges).toHaveLength(1);
    expect(secondChanges).toEqual([{
      angle: 53,
      center: { lat: 38.3554, lng: -121.9776 },
      heading: 275,
      updatedAt: 1234,
      zoom: 20,
    }]);
    viewRef.current = { ...viewRef.current, cameraLocked: true };
    syncCamera();
    suppressRef.current = true;
    viewRef.current = { ...viewRef.current, cameraLocked: false };
    syncCamera();
    expect(secondChanges).toHaveLength(1);
  });
});
