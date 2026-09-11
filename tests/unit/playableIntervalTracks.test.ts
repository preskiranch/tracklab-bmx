import { chooseOpeningTrack } from '../../src/lib/openingTrack';
import { describe, expect, it } from 'vitest';
import { hasPlayableIntervalZones, playableIntervalTracks } from '../../src/lib/playableIntervalTracks';
import type { TrackRecord, UserTrackMapping } from '../../src/types';
const mapping = {
  routeStatus: 'user-mapped',
  lengthMeters: 100, restAfterSeconds: 1, splitSections: [],
  startGate: {lat:1,lng:1}, finishLine: {lat:1,lng:2},
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
  it('rejects legacy whole-route placeholder zones when saved boundaries are empty', () => {
    const placeholder = { ...mapping, zoneBoundaryMeters: [], zoneBoundarySets: [], zones: [{ ...mapping.zones[0], name: 'Sprint 1', endMeter: 100 }] };
    expect(playableIntervalTracks([{ id: 'unfinished' } as TrackRecord], { unfinished: placeholder })).toEqual([]);
  });
  it('keeps unmapped and route-only tracks out of the race list', () => {
    const tracks = ['unmapped', 'route-only', 'zoned'].map(id => ({ id } as TrackRecord));
    expect(playableIntervalTracks(tracks, { 'route-only': { ...mapping, zones: [] }, zoned: mapping }).map(track => track.id)).toEqual(['zoned']);
  });
});


describe('random opening track', () => {
  const tracks = ['a', 'b', 'c', 'unfinished'].map(id => ({id} as TrackRecord));
  const mappings = { a: mapping, b: mapping, c: mapping, unfinished: {...mapping, zones: []} };
  it('uses different random offsets and never repeats the previous opening when alternatives exist', () => {
    expect(chooseOpeningTrack(tracks, mappings, 'a', () => 0)?.id).toBe('b');
    expect(chooseOpeningTrack(tracks, mappings, 'a', () => 0.99)?.id).toBe('c');
  });
  it('handles one playable track and an empty catalog', () => {
    expect(chooseOpeningTrack(tracks, {a: mapping}, 'a')?.id).toBe('a');
    expect(chooseOpeningTrack(tracks, {}, null)).toBeUndefined();
  });
});
