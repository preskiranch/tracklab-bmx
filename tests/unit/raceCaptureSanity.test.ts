import { describe, expect, it } from 'vitest';
import { acceptedRaceCapture } from '../../src/lib/raceCaptureSanity';

function capture() {
  return {
    version: 1,
    sessionId: 'race-1',
    createdAt: 1_000,
    startedAt: 1_100,
    endedAt: 2_000,
    status: 'finished',
    source: 'live',
    track: { id: 'track-1', name: 'Track', country: 'US', state: 'CA', lengthMeters: 300 },
    sessionMode: 'lap',
    selectedMetrics: ['cadence'],
    players: [],
    zones: [],
    events: [],
    samples: [{
      at: 1_200,
      elapsedMs: 100,
      playerId: 1,
      riderName: 'Rider',
      deviceId: 1,
      deviceLabel: 'Wattbike',
      source: 'bluetooth',
      watts: 500,
      cadence: 200,
      speedKph: 80,
      signal: 1,
      riderDistanceMeters: 10,
      riderVelocityMps: 83 / 3.6,
      riderPhase: 'pedaling',
      rank: 1,
    }],
    frames: [],
    reactionTimesByPlayer: {},
    summary: [{
      playerId: 1,
      riderName: 'Rider',
      colorName: 'lime',
      accent: '#7ade36',
      deviceLabel: 'Wattbike',
      rank: 1,
      finishTimeMs: 900,
      thirtyFootTimeMs: null,
      distanceMeters: 300,
      sampleCount: 1,
      topSpeedKph: 83,
      averageSpeedKph: 70,
      topCadence: 200,
      averageCadence: 180,
      topWatts: 500,
      averageWatts: 500,
    }],
    zoneResults: [],
  };
}

describe('race capture bike-metric quarantine', () => {
  it('accepts the exact recorded boundaries', () => {
    expect(acceptedRaceCapture(capture())).not.toBeNull();
  });

  it('rejects legacy capture samples and summaries with spike metrics', () => {
    const sampleSpike = capture();
    sampleSpike.samples[0].cadence = 923_334;
    sampleSpike.samples[0].speedKph = 151_080.1;
    expect(acceptedRaceCapture(sampleSpike)).toBeNull();

    const summarySpike = capture();
    summarySpike.summary[0].topCadence = 923_334;
    expect(acceptedRaceCapture(summarySpike)).toBeNull();

    const velocitySpike = capture();
    velocitySpike.samples[0].riderVelocityMps = 41_966.7;
    expect(acceptedRaceCapture(velocitySpike)).toBeNull();
  });
});
