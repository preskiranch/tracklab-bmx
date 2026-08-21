import { describe, expect, it } from 'vitest';
import type { HeartRateMeasurement, PrivateHeartRateSample } from '../../src/types';
import {
  activeElapsedMsAt,
  dedupeHeartRateMeasurements,
  isHeartRateMeasurementFresh,
  mapHeartRateMeasurementsToActiveClock,
  mergeHeartRateMeasurement,
  normalizeHeartRateMeasurement,
  summarizeHeartRate,
  summarizeHeartRateZones,
} from '../../src/lib/heartRate';

function measurement(
  sequence: number,
  recordedAt: number,
  bpm: number,
  sessionId = 'training-1',
): HeartRateMeasurement {
  return {
    source: 'apple-watch',
    sessionId,
    sequence,
    bpm,
    recordedAt,
    receivedAt: recordedAt + 25,
  };
}

function activeSample(
  sequence: number,
  activeElapsedMs: number,
  bpm: number,
): PrivateHeartRateSample {
  return { ...measurement(sequence, 1_000_000 + activeElapsedMs, bpm), activeElapsedMs };
}

describe('private Apple Watch heart-rate foundation', () => {
  it('normalizes native sensor time without replacing it with delivery time', () => {
    expect(normalizeHeartRateMeasurement({
      version: 1,
      source: 'apple-watch',
      sessionId: ' session-7 ',
      sequence: 9,
      bpm: 147.46,
      measuredAt: 10_000,
      receivedAt: 12_500,
    })).toEqual({
      source: 'apple-watch',
      sessionId: 'session-7',
      sequence: 9,
      bpm: 147.5,
      recordedAt: 10_000,
      receivedAt: 12_500,
    });

    expect(normalizeHeartRateMeasurement({
      source: 'apple-watch', sessionId: null, sequence: 1, bpm: 0, measuredAt: 10_000,
    })).toBeNull();
    expect(normalizeHeartRateMeasurement({
      source: 'apple-watch', sessionId: null, sequence: 1, bpm: 400, measuredAt: 10_000,
    })).toBeNull();
  });

  it('deduplicates retries by session and sequence without allowing a retry to rewrite health data', () => {
    const original = measurement(2, 2_000, 130);
    const rewrittenRetry = { ...original, bpm: 190, receivedAt: 8_000 };
    const sameSensorSampleWithNewSequence = measurement(99, 2_000, 130);
    const anotherSession = measurement(2, 2_100, 140, 'training-2');

    expect(dedupeHeartRateMeasurements([
      original,
      rewrittenRetry,
      sameSensorSampleWithNewSequence,
      measurement(1, 1_000, 120),
      anotherSession,
    ])).toEqual([
      measurement(1, 1_000, 120),
      original,
      anotherSession,
    ]);

    expect(mergeHeartRateMeasurement([
      measurement(1, 1_000, 120),
      original,
    ], measurement(3, 3_000, 150), 2)).toEqual([
      original,
      measurement(3, 3_000, 150),
    ]);
    expect(mergeHeartRateMeasurement([], measurement(3, 3_000, 150), Number.NaN))
      .toEqual([measurement(3, 3_000, 150)]);
  });

  it('maps sensor timestamps to an active clock while excluding pauses and staging', () => {
    const segments = [
      { startedAt: 10_000, endedAt: 15_000, activeElapsedAtStartMs: 0 },
      { startedAt: 20_000, endedAt: 26_000, activeElapsedAtStartMs: 5_000 },
    ];

    expect(activeElapsedMsAt(9_999, segments)).toBeNull();
    expect(activeElapsedMsAt(12_500, segments)).toBe(2_500);
    expect(activeElapsedMsAt(17_000, segments)).toBeNull();
    expect(activeElapsedMsAt(23_000, segments)).toBe(8_000);
    expect(activeElapsedMsAt(26_000, segments)).toBeNull();

    expect(mapHeartRateMeasurementsToActiveClock([
      measurement(1, 9_500, 100),
      measurement(2, 12_500, 125),
      measurement(3, 17_000, 130),
      measurement(4, 23_000, 145),
    ], segments).map(({ sequence, activeElapsedMs }) => ({ sequence, activeElapsedMs }))).toEqual([
      { sequence: 2, activeElapsedMs: 2_500 },
      { sequence: 4, activeElapsedMs: 8_000 },
    ]);
  });

  it('uses sensor time for live freshness and rejects stale or implausibly future samples', () => {
    const sample = measurement(1, 10_000, 120);
    expect(isHeartRateMeasurementFresh(sample, 19_999, 10_000)).toBe(true);
    expect(isHeartRateMeasurementFresh(sample, 20_001, 10_000)).toBe(false);
    expect(isHeartRateMeasurementFresh(sample, 7_999, 10_000)).toBe(false);
  });

  it('calculates time-weighted average and reports uncovered sample gaps', () => {
    const summary = summarizeHeartRate([
      activeSample(1, 0, 100),
      activeSample(2, 2_000, 140),
      activeSample(3, 8_000, 160),
    ], {
      startElapsedMs: 0,
      endElapsedMs: 10_000,
      maximumGapMs: 4_000,
    });

    expect(summary).toEqual({
      sampleCount: 3,
      coverageMs: 8_000,
      coveragePercent: 80,
      firstSampleElapsedMs: 0,
      lastSampleElapsedMs: 8_000,
      minimumBpm: 100,
      averageBpm: 135,
      peakBpm: 160,
    });
  });

  it('returns null metrics for missing data and separate coverage for every requested zone', () => {
    const samples = [
      activeSample(1, 1_000, 110),
      activeSample(2, 3_000, 130),
      activeSample(3, 7_000, 150),
    ];
    expect(summarizeHeartRate([], { startElapsedMs: 0, endElapsedMs: 5_000 })).toEqual({
      sampleCount: 0,
      coverageMs: 0,
      coveragePercent: 0,
      firstSampleElapsedMs: null,
      lastSampleElapsedMs: null,
      minimumBpm: null,
      averageBpm: null,
      peakBpm: null,
    });

    const zones = summarizeHeartRateZones(samples, [
      { zoneId: 'zone-1', zoneName: 'Zone 1', startElapsedMs: 0, endElapsedMs: 5_000 },
      { zoneId: 'zone-2', zoneName: 'Zone 2', startElapsedMs: 5_000, endElapsedMs: 10_000 },
      { zoneId: '', startElapsedMs: 0, endElapsedMs: 1_000 },
    ], 3_000);

    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({
      zoneId: 'zone-1',
      zoneName: 'Zone 1',
      summary: { sampleCount: 2, minimumBpm: 110, peakBpm: 130 },
    });
    expect(zones[1]).toMatchObject({
      zoneId: 'zone-2',
      zoneName: 'Zone 2',
      summary: { sampleCount: 1, minimumBpm: 150, peakBpm: 150 },
    });
  });
});
