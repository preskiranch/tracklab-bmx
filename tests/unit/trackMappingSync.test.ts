import { describe, expect, it } from 'vitest';
import type { UserTrackMapping } from '../../src/types';
import { mergeTrackMappingsBySavedAt, newestTrackMapping } from '../../src/lib/trackMapping';

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
