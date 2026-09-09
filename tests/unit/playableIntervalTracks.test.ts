import { describe, expect, it } from 'vitest';
import { hasPlayableIntervalZones, playableIntervalTracks } from '../../src/lib/playableIntervalTracks';
import type { TrackRecord, UserTrackMapping } from '../../src/types';
const mapping = {
  routeStatus: 'user-mapped',
  centerline: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }],
  zones: [{ id: 'zone-1', name: 'Zone 1', type: 'pedal', startMeter: 0, endMeter: 30 }],
} as UserTrackMapping;
describe('interval course eligibility', () => {
  it('requires saved usable pedal zones, not just a route or a track listing', () => {
    expect(hasPlayableIntervalZones(undefined)).toBe(false);
    expect(hasPlayableIntervalZones({ ...mapping, zones: [] })).toBe(false);
    expect(hasPlayableIntervalZones({ ...mapping, centerline: [] })).toBe(false);
    expect(hasPlayableIntervalZones({ ...mapping, zones: [{ ...mapping.zones[0], endMeter: 0 }] })).toBe(false);
    expect(hasPlayableIntervalZones(mapping)).toBe(true);
  });
  it('keeps unmapped and route-only tracks out of the race list', () => {
    const tracks = ['unmapped', 'route-only', 'zoned'].map(id => ({ id } as TrackRecord));
    expect(playableIntervalTracks(tracks, { 'route-only': { ...mapping, zones: [] }, zoned: mapping }).map(track => track.id)).toEqual(['zoned']);
  });
});
