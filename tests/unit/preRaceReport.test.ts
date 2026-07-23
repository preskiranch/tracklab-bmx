import { describe, expect, it } from 'vitest';
import {
  buildPreRaceTrackContext,
  localPreRaceReportLine,
  preRaceVariableCount,
} from '../../src/lib/preRaceReport';
import type { GhostLap, PlayerSlot, TrackRecord } from '../../src/types';

const track: TrackRecord = {
  id: 'north-bay-bmx',
  name: 'North Bay BMX',
  country: 'United States',
  countryCode: 'US',
  state: 'California',
  region: 'North America',
  city: 'Napa',
  county: 'Napa County',
  postalCode: '94558',
  source: 'USA BMX',
  sourceUrl: 'https://www.usabmx.com/tracks/1946',
  sourceType: 'sanctioning-body-track-directory',
  verificationStatus: 'official-track-directory',
  addressStatus: 'provider-address',
  latitude: 38.24,
  longitude: -122.28,
  coordinateSource: 'USA BMX',
  coordinateAccuracy: 'track facility',
  websiteUrl: 'https://northbaybmx.com',
  facebookUrl: 'https://facebook.com/northbaybmx',
  instagramUrl: 'https://instagram.com/northbaybmx',
  lengthMeters: 340,
  elevationMeters: 8,
  surface: 'dirt',
  outline: [{ lat: 38.24, lng: -122.28 }],
  centerline: [
    { lat: 38.24, lng: -122.28 },
    { lat: 38.241, lng: -122.279 },
  ],
  routeStatus: 'user-mapped',
  splitSections: [{
    id: 'split-1',
    name: 'Pro Set',
    index: 0,
    splitPoint: { lat: 38.24, lng: -122.28 },
    mergePoint: { lat: 38.241, lng: -122.279 },
    branches: [
      { id: 'a', name: 'Amateur Line', lengthMeters: 40, points: [] },
      { id: 'b', name: 'Pro Line', lengthMeters: 42, points: [] },
    ],
  }],
  zones: [
    { id: 'p1', name: 'First straight', startMeter: 0, endMeter: 65, type: 'pedal' },
    { id: 'r1', name: 'Turn one', startMeter: 65, endMeter: 100, type: 'recovery' },
    { id: 't1', name: 'Rhythm', startMeter: 100, endMeter: 180, type: 'technical' },
  ],
  leaderboards: { speed: [], rpm: [], watts: [] },
};

const players: PlayerSlot[] = [
  { id: 1, name: 'Maya Torres', colorName: 'lime', accent: '#7ade36', deviceId: null },
  { id: 2, name: 'Jordan Lee', colorName: 'blue', accent: '#2388e8', deviceId: null },
  { id: 3, name: 'Avery Cole', colorName: 'red', accent: '#ef4444', deviceId: null },
  { id: 4, name: 'Sam Rivers', colorName: 'yellow', accent: '#f6d44a', deviceId: null },
];

const personalGhost = {
  version: 1,
  id: 'ghost-maya',
  trackId: track.id,
  trackName: track.name,
  riderName: 'Maya Torres',
  ownerKey: 'user:1',
  ownerName: 'Maya',
  colorName: 'lime',
  accent: '#7ade36',
  source: 'personal',
  raceSource: 'live',
  lapCount: 1,
  finishTimeMs: 31_240,
  thirtyFootTimeMs: 2_140,
  savedAt: Date.parse('2026-07-20T18:00:00Z'),
  analyticsPublic: false,
  medalRank: 1,
  summary: null,
  zoneResults: [],
  points: [],
} satisfies GhostLap;

describe('pre-race report facts', () => {
  it('builds a broad verified fact pack and matches saved rider records by name', () => {
    const context = buildPreRaceTrackContext(track, players, [personalGhost], 1);

    expect(context).toMatchObject({
      name: 'North Bay BMX',
      surface: 'dirt',
      pedalZoneCount: 1,
      pedalMeters: 65,
      recoveryMeters: 35,
      technicalMeters: 80,
      splitCount: 1,
      hasProSet: true,
      knownTrackBestMs: 31_240,
      knownTrackBestRider: 'Maya Torres',
    });
    expect(context.riders[0]).toMatchObject({
      name: 'Maya Torres',
      personalBestMs: 31_240,
      personalThirtyFootMs: 2_140,
    });
    expect(context.riders[1].personalBestMs).toBeUndefined();
    expect(preRaceVariableCount(context, {
      available: true,
      summary: 'clear',
      temperatureC: 24,
      humidityPercent: 42,
      windKph: 9,
    })).toBeGreaterThanOrEqual(50);
  });

  it('produces a truthful local fallback without inventing records or positions', () => {
    const context = buildPreRaceTrackContext(track, players.slice(0, 2), [], 1);
    const line = localPreRaceReportLine(context, {
      available: true,
      summary: 'Partly cloudy',
    });

    expect(line).toContain('Maya Torres and Jordan Lee');
    expect(line).toContain('North Bay BMX');
    expect(line).toContain('partly cloudy');
    expect(line).not.toMatch(/\b(?:first|second|record|streak)\b/i);
  });

  it('varies repeated pre-race briefings while preserving every rider name and known condition', () => {
    const context = buildPreRaceTrackContext(track, players, [], 1);
    const memory: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const line = localPreRaceReportLine(context, {
        available: true,
        summary: 'Clear',
      }, memory);
      memory.push(line);
    }

    expect(new Set(memory).size).toBe(memory.length);
    for (const line of memory) {
      expect(line).toContain('Maya Torres');
      expect(line).toContain('Jordan Lee');
      expect(line).toContain('Avery Cole');
      expect(line).toContain('Sam Rivers');
      expect(line).toMatch(/\bclear\b/i);
      expect(line).not.toMatch(/\b(?:first place|second place|winner)\b/i);
    }
  });
});
