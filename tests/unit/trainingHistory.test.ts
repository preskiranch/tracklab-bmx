import { describe, expect, it } from 'vitest';
import type { TrainingSession } from '../../src/types';
import {
  sanitizeRecordedBikeMetrics,
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

  it('fails closed when presenting or exporting legacy astronomical bike metrics', () => {
    const session = mappedIntervalSession();
    const summary = (session.details.summaries as Array<Record<string, unknown>>)[0];
    summary.topSpeedKph = 243_139.8;
    summary.averageSpeedKph = 9.4;
    summary.topCadence = 923_334;
    summary.averageCadence = 68_458.7;
    const zoneRider = (session.details.zoneResults as Array<{
      riders: Array<Record<string, unknown>>;
    }>)[0].riders[0];
    zoneRider.topSpeedKph = 151_080.1;
    zoneRider.topCadence = 923_334;

    expect(trainingSessionRaceSummaries(session)[0]).toMatchObject({
      topSpeedKph: null,
      averageSpeedKph: 9.4,
      topCadence: null,
      averageCadence: null,
    });
    expect(trainingSessionZoneResults(session)[0].riders[0]).toMatchObject({
      topSpeedKph: null,
      topCadence: null,
    });

    const csv = trainingSessionCsv(session);
    expect(csv).not.toContain('243139.8');
    expect(csv).not.toContain('151080.1');
    expect(csv).not.toContain('923334');
    expect(csv).not.toContain('68458.7');
    expect(sanitizeRecordedBikeMetrics({ cadence: 200, speedKph: 80 })).toEqual({
      cadence: 200,
      speedKph: 80,
    });
    expect(sanitizeRecordedBikeMetrics({ cadence: 200, speedKph: 83 })).toEqual({
      cadence: 200,
      speedKph: 83,
    });
    expect(sanitizeRecordedBikeMetrics({ averageSpeedMph: 999 })).toEqual({
      averageSpeedMph: null,
    });
    expect(sanitizeRecordedBikeMetrics({ cadence: 200.01, speedKph: 83.01 })).toEqual({
      cadence: null,
      speedKph: null,
    });
    expect(sanitizeRecordedBikeMetrics({ peakSpeedMps: 20 })).toEqual({ peakSpeedMps: 20 });
    expect(sanitizeRecordedBikeMetrics({ peakSpeedMps: 999 })).toEqual({ peakSpeedMps: null });
  });
});
