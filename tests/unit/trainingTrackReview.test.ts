import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RaceZoneResult, TrackRecord, UserTrackMapping } from '../../src/types';
import {
  buildTrainingTrackReviewZones,
  buildTrainingTrackSchematic,
  loadTrainingTrackReview,
  resetTrainingTrackReviewCacheForTests,
  resolveTrainingTrackReview,
  trainingTrackReviewZonePolyline,
} from '../../src/lib/trainingTrackReview';

afterEach(() => {
  vi.restoreAllMocks();
  resetTrainingTrackReviewCacheForTests();
});

function track(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    id: 'track-1',
    name: 'Exact Track',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'North America',
    source: 'Test',
    sourceUrl: 'https://example.test',
    lengthMeters: 100,
    elevationMeters: 0,
    surface: 'Clay',
    outline: [{ lat: 32, lng: -117 }, { lat: 32.0005, lng: -117.0002 }, { lat: 32.0008, lng: -117 }],
    centerline: [{ lat: 32, lng: -117 }, { lat: 32.0005, lng: -117.0002 }, { lat: 32.0008, lng: -117 }],
    routeStatus: 'estimated',
    zones: [{ id: 'z1', name: 'Current zone', type: 'pedal', startMeter: 20, endMeter: 40 }],
    leaderboards: { rpm: [], speed: [] },
    ...overrides,
  };
}

function zone(overrides: Partial<RaceZoneResult> = {}): RaceZoneResult {
  return {
    zoneId: 'z1',
    zoneName: 'Recorded zone',
    zoneType: 'pedal',
    startMeter: 10,
    endMeter: 15,
    riders: [],
    ...overrides,
  };
}

function mapping(savedAt: string, offset: number): UserTrackMapping {
  const centerline = [
    { lat: 32 + offset, lng: -117 },
    { lat: 32.0005 + offset, lng: -117.0002 },
    { lat: 32.0008 + offset, lng: -117 },
  ];
  return {
    version: 1,
    trackId: 'track-1',
    trackName: 'Exact Track',
    country: 'United States',
    state: 'California',
    savedAt,
    routeStatus: 'user-mapped',
    restAfterSeconds: 5,
    lengthMeters: 100,
    centerline,
    startGate: centerline[0],
    finishLine: centerline[2],
    zoneBoundaryMeters: [10, 15],
    zones: [{ id: 'z1', name: 'Mapped zone', type: 'pedal', startMeter: 10, endMeter: 15 }],
  };
}

describe('historical track and zone review', () => {
  it('uses only an exact track id and never guesses from the saved track name', () => {
    const result = resolveTrainingTrackReview(
      { trackId: 'missing-id', zones: [zone()] },
      { catalog: [track({ name: 'The same display name' })] },
    );

    expect(result.status).toBe('missing-track');
    expect(result.track).toBeNull();
    expect(result.note).toMatch(/exact saved track/i);
  });

  it('allows bounded exact-id catalog geometry while labeling it as current estimated geometry', () => {
    const result = resolveTrainingTrackReview(
      { trackId: 'track-1', zones: [zone()] },
      { catalog: [track()] },
    );

    expect(result.status).toBe('ready');
    expect(result.mappingSource).toBe('catalog');
    expect(result.note).toMatch(/current estimated catalog route/i);
  });

  it('rejects locator-only catalog shapes instead of presenting synthetic geometry as a track route', () => {
    const result = resolveTrainingTrackReview(
      { trackId: 'track-1', zones: [zone()] },
      { catalog: [track({ routeStatus: 'locator-only' })] },
    );

    expect(result.status).toBe('unmapped');
    expect(result.note).toMatch(/locator-only/i);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({ placeable: false, recordedStartMeter: 10, recordedEndMeter: 15 });
    expect(trainingTrackReviewZonePolyline(result.track!, result.zones[0])).toEqual([]);
  });

  it('keeps historical boundaries even when the current same-id zone changed', () => {
    const current = track({
      zones: [{
        id: 'z1', name: 'Current zone', type: 'technical', startMeter: 45, endMeter: 70,
        branchSelections: { 'split-1': 'b' },
      }],
    });
    const [reviewZone] = buildTrainingTrackReviewZones([zone()], current);

    expect(reviewZone).toMatchObject({
      name: 'Recorded zone',
      type: 'pedal',
      startMeter: 10,
      endMeter: 15,
      recordedStartMeter: 10,
      recordedEndMeter: 15,
      branchSelections: { 'split-1': 'b' },
    });
  });

  it('normalizes repeated lap zones onto the physical route without changing saved distances', () => {
    const [, reviewZone] = buildTrainingTrackReviewZones([
      zone({ zoneId: 'z1-lap-1', zoneName: 'Lap 1 / Recorded zone', startMeter: 10, endMeter: 15 }),
      zone({ zoneId: 'z1-lap-2', zoneName: 'Lap 2 / Recorded zone', startMeter: 110, endMeter: 115 }),
    ], track(), 2);

    expect(reviewZone).toMatchObject({
      lapNumber: 2,
      startMeter: 10,
      endMeter: 15,
      recordedStartMeter: 110,
      recordedEndMeter: 115,
      placeable: true,
    });
  });

  it('retains every saved row but refuses to clamp or paint zones beyond a changed current route', () => {
    const current = track({ lengthMeters: 12 });
    const reviewZones = buildTrainingTrackReviewZones([
      zone(),
      zone({ zoneId: 'z1', zoneName: 'Duplicate saved row', startMeter: 20, endMeter: 30 }),
    ], current);

    expect(reviewZones).toHaveLength(2);
    expect(reviewZones.map((entry) => entry.sourceIndex)).toEqual([0, 1]);
    expect(new Set(reviewZones.map((entry) => entry.id)).size).toBe(2);
    expect(reviewZones[0]).toMatchObject({ startMeter: 10, endMeter: 15, placeable: false });
    expect(reviewZones[1]).toMatchObject({ startMeter: 20, endMeter: 30, placeable: false });
    expect(reviewZones.every((entry) => /outside the current route/i.test(entry.placementNote ?? ''))).toBe(true);
    expect(reviewZones.flatMap((entry) => trainingTrackReviewZonePolyline(current, entry))).toEqual([]);
  });

  it('marks all laps unplaceable when the current route length differs from the saved repeated-lap length', () => {
    const current = track({ lengthMeters: 120 });
    const reviewZones = buildTrainingTrackReviewZones([
      zone({ zoneId: 'z1-lap-1', startMeter: 10, endMeter: 15 }),
      zone({ zoneId: 'z1-lap-2', startMeter: 110, endMeter: 115 }),
    ], current, 2);

    expect(reviewZones).toHaveLength(2);
    expect(reviewZones[1]).toMatchObject({
      startMeter: 10,
      endMeter: 15,
      recordedStartMeter: 110,
      recordedEndMeter: 115,
      placeable: false,
    });
    expect(reviewZones.every((entry) => /route length differs/i.test(entry.placementNote ?? ''))).toBe(true);
    expect(buildTrainingTrackSchematic(current, reviewZones)?.zones).toEqual([]);
  });

  it('preserves saved zone rows when the historic track geometry is unavailable', () => {
    const [reviewZone] = buildTrainingTrackReviewZones([
      zone({ zoneId: 'z1-lap-2', startMeter: 110, endMeter: 115 }),
    ], null, 2);

    expect(reviewZone).toMatchObject({ startMeter: 110, endMeter: 115, lapNumber: 2, placeable: false });
  });

  it('fails closed when the session requested a route variant that no longer exists', () => {
    const amateurOnly = mapping('2026-08-02T00:00:00.000Z', 0);
    amateurOnly.routeVariants = [{
      id: 'amateur',
      name: 'Amateur',
      restAfterSeconds: amateurOnly.restAfterSeconds,
      lengthMeters: amateurOnly.lengthMeters,
      centerline: amateurOnly.centerline,
      startGate: amateurOnly.startGate,
      finishLine: amateurOnly.finishLine,
      zones: amateurOnly.zones,
    }];
    const result = resolveTrainingTrackReview(
      { trackId: 'track-1', routeVariantId: 'pro', zones: [zone()] },
      { catalog: [track()], userMappings: { 'track-1': amateurOnly } },
    );

    expect(result.status).toBe('unmapped');
    expect(result.note).toMatch(/Pro route variant is no longer available/i);
    expect(result.track?.activeRouteVariantId).toBeUndefined();
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({ placeable: false, recordedStartMeter: 10, recordedEndMeter: 15 });
  });

  it('uses the newest safe user/public map but rejects unbounded custom geometry', () => {
    const publicMap = mapping('2026-08-01T00:00:00.000Z', 0);
    const userMap = mapping('2026-08-02T00:00:00.000Z', 0.001);
    const result = resolveTrainingTrackReview(
      { trackId: 'track-1', zones: [zone()] },
      { catalog: [track()], publicMappings: { 'track-1': publicMap }, userMappings: { 'track-1': userMap } },
    );
    const unsafeCustom = track({
      id: 'custom-danger',
      centerline: Array.from({ length: 2_501 }, (_, index) => ({ lat: 32 + index / 100_000, lng: -117 })),
      outline: [],
    });
    const rejected = resolveTrainingTrackReview(
      { trackId: 'custom-danger', zones: [zone()] },
      { catalog: [], userRoutes: [unsafeCustom] },
    );

    expect(result.mappingSource).toBe('user');
    expect(result.mappingSavedAt).toBe(userMap.savedAt);
    expect(rejected.status).toBe('missing-track');
  });

  it('builds a finite schematic from the same route and highlighted-zone geometry', () => {
    const current = track({ routeStatus: 'user-mapped', zones: [{ id: 'z1', name: 'Zone', type: 'pedal', startMeter: 10, endMeter: 25 }] });
    const reviewZones = buildTrainingTrackReviewZones([zone({ endMeter: 25 })], current);
    const schematic = buildTrainingTrackSchematic(current, reviewZones);

    expect(schematic?.routePaths).toHaveLength(1);
    expect(schematic?.zones).toHaveLength(1);
    expect(schematic?.zones[0].path).toMatch(/^M\d/u);
    expect(Number.isFinite(schematic?.zones[0].labelX)).toBe(true);
    expect(Number.isFinite(schematic?.zones[0].labelY)).toBe(true);
  });

  it('shares static/public loads but fetches authenticated current-user maps fresh for each review', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === '/data/track-database.json') {
        return new Response(JSON.stringify({ tracks: [track()] }), { status: 200 });
      }
      if (url === '/api/public-track-mappings') {
        return new Response(JSON.stringify({ trackMappings: {}, customRoutes: [] }), { status: 200 });
      }
      if (url === '/api/user-data?profileKey=current') {
        return new Response(JSON.stringify({ trackMappings: {}, customRoutes: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    await loadTrainingTrackReview({ trackId: 'track-1', zones: [zone()] });
    await loadTrainingTrackReview({ trackId: 'track-1', zones: [zone()] });

    expect(urls.filter((url) => url === '/data/track-database.json')).toHaveLength(1);
    expect(urls.filter((url) => url === '/api/public-track-mappings')).toHaveLength(1);
    expect(urls.filter((url) => url === '/api/user-data?profileKey=current')).toHaveLength(2);
  });
});
