import { describe, expect, it } from 'vitest';
import {
  canonicalizeMultiplayerRaceSetup,
  multiplayerRaceConfigurationId,
  multiplayerRaceSetupActivity,
  multiplayerRaceSetupCompatibilityKey,
  multiplayerRaceSetupLabel,
  multiplayerRaceSetupTrackId,
  multiplayerRaceSetupTrackRecord,
  sanitizeMultiplayerRaceConfiguration,
  sanitizeMultiplayerRaceSetup,
  sanitizeMultiplayerRaceView,
  sanitizeMultiplayerTrackRecord,
} from '../../src/lib/multiplayerRaceSetup';
import type { TrackRecord, TrackRouteVariant } from '../../src/types';

const points = [
  { lat: 38.10000004, lng: -122.10000004 },
  { lat: 38.1005, lng: -122.1005 },
  { lat: 38.101, lng: -122.101 },
];

const zone = {
  id: 'zone-1',
  name: 'First straight',
  startMeter: 0,
  endMeter: 80,
  type: 'pedal' as const,
};

function variant(id: TrackRouteVariant['id']): TrackRouteVariant {
  return {
    id,
    name: id === 'pro' ? 'Pro Track' : 'Amateur Track',
    restAfterSeconds: 30,
    lengthMeters: id === 'pro' ? 340 : 360,
    centerline: points,
    startGate: points[0],
    finishLine: points[2],
    zones: [zone],
  };
}

function track(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    id: 'north-bay-bmx',
    name: 'North Bay BMX',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'North America',
    source: 'USA BMX',
    sourceUrl: 'https://example.test/track',
    sourceType: 'sanctioning-body-track-directory',
    verificationStatus: 'official-track-directory',
    addressStatus: 'provider-address',
    address: '100 Track Lane',
    city: 'Napa',
    latitude: 38.1,
    longitude: -122.1,
    lengthMeters: 360,
    elevationMeters: 3,
    surface: 'Clay and asphalt',
    outline: points,
    centerline: points,
    startGate: points[0],
    finishLine: points[2],
    routeStatus: 'user-mapped',
    routeVariants: [variant('pro'), variant('amateur')],
    activeRouteVariantId: 'pro',
    activeRouteVariantName: 'Pro Track',
    zones: [{ ...zone, branchSelections: { 'pro-set': 'b' } }],
    leaderboards: {
      rpm: [{ rider: 'Rider One', value: 160, unit: 'RPM', date: '2026-09-03' }],
      speed: [],
    },
    sourceRecord: {
      providerPrivateBlob: 'must not cross the multiplayer wire',
      deeplyNested: { value: true },
    },
    ...overrides,
  };
}

function raceConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    activityType: 'bmx-race',
    trackId: 'north-bay-bmx',
    trackName: 'North Bay BMX',
    trackRecord: track(),
    raceView: {
      mode: '3d',
      camera: {
        angle: 47.123456,
        heading: 90.123456,
        center: { lat: 38.10000004, lng: -122.10000004 },
        zoom: 18.123456,
        referenceViewport: { width: 1366.125, height: 1024.555 },
        updatedAt: 1_000,
      },
      riderOverlay: {
        xPct: 0.04,
        yPct: 0.7,
        width: 940,
        height: 220,
        locked: true,
        referenceViewport: { width: 1366.125, height: 1024.555 },
      },
      ownerOnly: 'discard me',
    },
    lapCount: 3,
    routeVariantId: 'pro',
    ignored: 'discard me',
    ...overrides,
  };
}

function raceSetup(configurationOverrides: Record<string, unknown> = {}, setupOverrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    revision: 4,
    configurationId: 'untrusted-client-id',
    configuration: raceConfiguration(configurationOverrides),
    ignored: 'discard me',
    ...setupOverrides,
  };
}

describe('multiplayer race setup contract', () => {
  it('canonicalizes the complete Race Intervals choice and derives its identity', () => {
    const setup = canonicalizeMultiplayerRaceSetup(raceSetup());
    expect(setup).not.toBeNull();
    expect(setup).toMatchObject({
      version: 1,
      revision: 4,
      configurationId: expect.stringMatching(/^race-[0-9a-f]{16}$/u),
      configuration: {
        activityType: 'bmx-race',
        trackId: 'north-bay-bmx',
        trackName: 'North Bay BMX',
        lapCount: 3,
        routeVariantId: 'pro',
        raceView: {
          mode: '3d',
          camera: {
            angle: 47.1235,
            heading: 90.1235,
            center: { lat: 38.1, lng: -122.1 },
            zoom: 18.1235,
            referenceViewport: { width: 1366.13, height: 1024.56 },
          },
        },
      },
    });
    expect(setup?.configurationId).not.toBe('untrusted-client-id');
    const savedTrack = setup?.configuration.trackRecord;
    expect(savedTrack?.routeVariants?.map((entry) => entry.id)).toEqual(['amateur', 'pro']);
    expect(savedTrack?.zones[0].branchSelections).toEqual({ 'pro-set': 'b' });
    expect(savedTrack?.leaderboards.rpm).toHaveLength(1);
    expect(savedTrack?.sourceRecord).toBeUndefined();
    expect((setup?.configuration as unknown as Record<string, unknown>).ignored).toBeUndefined();
    expect(multiplayerRaceSetupTrackRecord(setup)?.id).toBe('north-bay-bmx');
    expect(multiplayerRaceSetupTrackId(setup)).toBe('north-bay-bmx');
    expect(multiplayerRaceSetupActivity(setup)).toBe('bmx-race');
    expect(multiplayerRaceSetupLabel(setup)).toBe(
      'North Bay BMX · Pro Track · 3 laps · 3D Terrain',
    );
  });

  it('uses exact configuration content for compatibility but not envelope revision', () => {
    const first = canonicalizeMultiplayerRaceSetup(raceSetup())!;
    const laterRevision = canonicalizeMultiplayerRaceSetup(raceSetup({}, {
      revision: 99,
      configurationId: 'another-forged-id',
    }))!;
    expect(first.configurationId).toBe(laterRevision.configurationId);
    expect(multiplayerRaceSetupCompatibilityKey(first)).toBe(
      multiplayerRaceSetupCompatibilityKey(laterRevision),
    );

    const amateur = canonicalizeMultiplayerRaceSetup(raceSetup({ routeVariantId: 'amateur' }))!;
    const satellite = canonicalizeMultiplayerRaceSetup(raceSetup({ raceView: { mode: 'satellite' } }))!;
    expect(multiplayerRaceSetupCompatibilityKey(amateur)).not.toBe(multiplayerRaceSetupCompatibilityKey(first));
    expect(multiplayerRaceSetupCompatibilityKey(satellite)).not.toBe(multiplayerRaceSetupCompatibilityKey(first));
    expect(amateur.configurationId).not.toBe(first.configurationId);
  });

  it('canonicalizes an exact saved Straight Sprint map, distance, Air setting, and presentation', () => {
    const dragStrip = track({
      id: 'custom-drag-strip',
      name: 'Drag Strip',
      country: 'Custom Routes',
      countryCode: 'CUSTOM',
      state: 'Personal',
      region: 'Personal',
      source: 'Custom',
      sourceUrl: 'local://custom-route',
    });
    delete dragStrip.routeVariants;
    delete dragStrip.activeRouteVariantId;
    delete dragStrip.activeRouteVariantName;
    const setup = canonicalizeMultiplayerRaceSetup({
      version: 1,
      revision: 1,
      configurationId: 'ignored',
      configuration: {
        activityType: 'straight-sprint',
        courseId: 'custom-drag-strip',
        courseName: 'Drag Strip',
        courseSource: 'saved-map',
        trackRecord: dragStrip,
        raceView: { mode: 'game' },
        distanceFeet: 145,
        airSetting: 7,
      },
    });
    expect(setup).toMatchObject({
      configurationId: expect.stringMatching(/^sprint-[0-9a-f]{16}$/u),
      configuration: {
        activityType: 'straight-sprint',
        courseId: 'custom-drag-strip',
        courseSource: 'saved-map',
        distanceFeet: 145,
        airSetting: 7,
        raceView: { mode: 'game' },
      },
    });
    expect(multiplayerRaceSetupTrackId(setup)).toBe('custom-drag-strip');
    expect(multiplayerRaceSetupActivity(setup)).toBe('straight-sprint');
    expect(multiplayerRaceSetupLabel(setup)).toBe('Drag Strip · 145 ft · Air 7 · Game Arena');
  });

  it('rejects a catalog identity without embedded mapped geometry', () => {
    const setup = sanitizeMultiplayerRaceSetup({
      version: 1,
      revision: 1,
      configurationId: 'server-will-replace-this',
      configuration: {
        activityType: 'bmx-race',
        trackId: 'catalog-track',
        trackName: 'Catalog Track',
        raceView: { mode: 'satellite' },
        lapCount: 1,
        routeVariantId: null,
      },
    });
    expect(setup).toBeNull();
  });

  it.each([
    ['Explore is not a race activity', { ...raceSetup(), configuration: { activityType: 'explore' } }],
    ['unsupported setup version', raceSetup({}, { version: 2 })],
    ['non-positive revision', raceSetup({}, { revision: 0 })],
    ['invalid lap count', raceSetup({ lapCount: 21 })],
    ['invalid route choice', raceSetup({ routeVariantId: 'expert' })],
    ['missing Pro geometry', raceSetup({ trackRecord: track({ routeVariants: [variant('amateur')] }) })],
    ['mismatched track identity', raceSetup({ trackId: 'impersonated-track' })],
    ['unsupported partial-course section', raceSetup({ section: { id: 'legacy', name: 'Legacy', startMeter: 0, endMeter: 80 } })],
    ['unmapped course', raceSetup({ trackRecord: track({ routeStatus: 'locator-only' }) })],
    ['unsafe camera number', raceSetup({ raceView: { mode: '3d', camera: { angle: Number.NaN, heading: 90 } } })],
  ])('rejects %s', (_label, input) => {
    expect(canonicalizeMultiplayerRaceSetup(input)).toBeNull();
    expect(multiplayerRaceSetupCompatibilityKey(input)).toBeNull();
    expect(multiplayerRaceSetupLabel(input)).toBe('');
  });

  it.each([31, 99, 146, 1_499, 1_501])('rejects unsupported Straight Sprint distance %s', (distanceFeet) => {
    expect(sanitizeMultiplayerRaceConfiguration({
      activityType: 'straight-sprint',
      courseId: 'drag-strip',
      courseName: 'Drag Strip',
      courseSource: 'saved-map',
      raceView: { mode: 'game' },
      distanceFeet,
      airSetting: 5,
    })).toBeNull();
  });

  it('rejects invalid nested course and presentation data without mutating the input', () => {
    const source = track();
    const snapshot = JSON.stringify(source);
    expect(sanitizeMultiplayerTrackRecord({ ...source, centerline: [{ lat: 91, lng: 0 }, points[1]] })).toBeNull();
    expect(sanitizeMultiplayerTrackRecord({ ...source, leaderboards: { rpm: [], speed: 'nope' } })).toBeNull();
    expect(sanitizeMultiplayerTrackRecord({ ...source, routeVariants: [...source.routeVariants!, variant('pro')] })).toBeNull();
    expect(sanitizeMultiplayerRaceView({ mode: 'game', camera: { angle: 0, heading: 0 } })).toBeNull();
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('produces the same id for already canonical configuration data', () => {
    const configuration = sanitizeMultiplayerRaceConfiguration(raceConfiguration())!;
    expect(multiplayerRaceConfigurationId(configuration)).toBe(
      canonicalizeMultiplayerRaceSetup(raceSetup())?.configurationId,
    );
  });
});
