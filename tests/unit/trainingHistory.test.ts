import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../../src/types';
import {
  trainingSessionCsv,
  trainingSessionRaceSummaries,
  trainingSessionReactionTimes,
  trainingSessionZoneResults,
} from '../../src/lib/trainingHistory';

function mappedIntervalSession(): TrainingSession {
  return {
    id: 'mapped-interval-session',
    activityType: 'bmx-race',
    title: 'Mapped interval',
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_009_000,
    durationMs: 9_000,
    distanceMeters: 320,
    trackId: 'mapped-track',
    trackName: 'Mapped Track',
    source: 'live',
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_009_000,
    details: {
      summaries: [{
        playerId: 1,
        riderId: 'studio-rider-one',
        riderName: 'Rider One',
        rank: 1,
        finishTimeMs: 8_900,
        thirtyFootTimeMs: 1_720,
        distanceMeters: 320,
        sampleCount: 44,
        topSpeedKph: 46.2,
        averageSpeedKph: 35.8,
        topCadence: 184,
        averageCadence: 162.5,
        topWatts: 1_240,
        averageWatts: 810,
      }],
      reactionTimesByPlayer: { 1: 181 },
      zoneResults: [{
        zoneId: 'zone-drive-one',
        zoneName: 'Drive one',
        zoneType: 'pedal',
        startMeter: 5,
        endMeter: 25,
        riders: [{
          playerId: 1,
          sampleCount: 13,
          entryElapsedMs: 300,
          exitElapsedMs: 1_180,
          durationMs: 880,
          topSpeedKph: 43.1,
          averageSpeedKph: 37.4,
          topCadence: 181,
          averageCadence: 168.2,
          topWatts: 1_210,
          averageWatts: 920.4,
        }],
      }],
    },
  };
}

describe('training history metric access', () => {
  it('returns the complete saved rider, reaction, and mapped-zone record', () => {
    const session = mappedIntervalSession();

    expect(trainingSessionRaceSummaries(session)).toEqual([
      expect.objectContaining({ riderId: 'studio-rider-one', topCadence: 184, averageWatts: 810 }),
    ]);
    expect(trainingSessionReactionTimes(session)).toEqual({ 1: 181 });
    expect(trainingSessionZoneResults(session)).toEqual([
      expect.objectContaining({
        zoneId: 'zone-drive-one',
        riders: [expect.objectContaining({
          sampleCount: 13,
          entryElapsedMs: 300,
          exitElapsedMs: 1_180,
          durationMs: 880,
          topSpeedKph: 43.1,
          averageSpeedKph: 37.4,
          topCadence: 181,
          averageCadence: 168.2,
          topWatts: 1_210,
          averageWatts: 920.4,
        })],
      }),
    ]);
  });

  it('exports dedicated overall and pedal-zone CSV columns without dropping the full JSON details', () => {
    const csv = trainingSessionCsv(mappedIntervalSession());

    expect(csv).toContain('"Details","{""summaries""');
    expect(csv).toContain('"Reaction ms"');
    expect(csv).toContain('"181"');
    expect(csv).toContain('"Zone ID","Zone","Zone type"');
    expect(csv).toContain('"zone-drive-one","Drive one","pedal"');
    expect(csv).toContain('"13","300","1180","880","43.1","37.4","181","168.2","1210","920.4"');
  });
});
