import { describe, expect, it } from 'vitest';
import type { TrackZone, UserTrackMapping } from '../../src/types';
import {
  mergeTrackMappingsBySavedAt,
  newestTrackMapping,
  repeatTrackZonesForLaps,
  routeIsClosedLoop,
} from '../../src/lib/trackMapping';

function mapping(trackId: string, savedAt: string, zoneCount: number): UserTrackMapping {
  const startGate = { lat: 38.244, lng: -122.283 };
  const finishLine = { lat: 38.245, lng: -122.282 };
  return {
    version: 1,
    trackId,
    trackName: 'North Bay BMX - Napa Valley',
    country: 'United States',
    state: 'California',
    savedAt,
    routeStatus: 'user-mapped',
    restAfterSeconds: 1,
    lengthMeters: 320,
    centerline: [startGate, finishLine],
    startGate,
    finishLine,
    zones: Array.from({ length: zoneCount }, (_, index) => ({
      id: `zone-${index + 1}`,
      name: `Pedal Zone ${index + 1}`,
      startMeter: index * 20,
      endMeter: index * 20 + 10,
      type: 'pedal' as const,
      restAfterSeconds: 1,
    })),
  };
}

describe('cross-browser track mapping resolution', () => {
  it('uses a newer published mapping instead of a stale browser-local mapping', () => {
    const staleLocal = mapping('north-bay', '2026-07-01T12:00:00.000Z', 1);
    const currentPublished = mapping('north-bay', '2026-07-10T12:00:00.000Z', 8);

    expect(newestTrackMapping(staleLocal, currentPublished)).toBe(currentPublished);
  });

  it('merges cloud mappings without replacing newer work from the current device', () => {
    const current = mapping('north-bay', '2026-07-10T12:00:00.000Z', 8);
    const staleCloud = mapping('north-bay', '2026-07-01T12:00:00.000Z', 1);
    const otherTrack = mapping('oak-creek', '2026-07-09T12:00:00.000Z', 5);

    const merged = mergeTrackMappingsBySavedAt(
      { 'north-bay': current },
      { 'north-bay': staleCloud, 'oak-creek': otherTrack },
    );

    expect(merged['north-bay']).toBe(current);
    expect(merged['oak-creek']).toBe(otherTrack);
  });
});

describe('closed-loop route support', () => {
  const start = { lat: 39.9999, lng: -75.1541 };
  const route = [
    start,
    { lat: 40.0002, lng: -75.1538 },
    { lat: 39.9998, lng: -75.1535 },
  ];

  it('recognizes an exact or nearby finish snapped to the start', () => {
    expect(routeIsClosedLoop([...route, start])).toBe(true);
    expect(routeIsClosedLoop([...route, { lat: 39.99991, lng: -75.15409 }])).toBe(true);
    expect(routeIsClosedLoop(route)).toBe(false);
  });

  it('repeats pedal zones at the correct route offset for every lap', () => {
    const zones: TrackZone[] = [{
      id: 'pedal-1',
      name: 'Pedal Zone 1',
      startMeter: 0,
      endMeter: 35,
      type: 'pedal',
    }];

    expect(repeatTrackZonesForLaps(zones, 200, 3)).toEqual([
      expect.objectContaining({ id: 'pedal-1-lap-1', name: 'Lap 1 / Pedal Zone 1', startMeter: 0, endMeter: 35 }),
      expect.objectContaining({ id: 'pedal-1-lap-2', name: 'Lap 2 / Pedal Zone 1', startMeter: 200, endMeter: 235 }),
      expect.objectContaining({ id: 'pedal-1-lap-3', name: 'Lap 3 / Pedal Zone 1', startMeter: 400, endMeter: 435 }),
    ]);
  });
});
