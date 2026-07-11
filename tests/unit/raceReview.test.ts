import { describe, expect, it } from 'vitest';
import {
  buildRaceZoneResults,
  raceSummaryWithCapturedMetrics,
  zoneRiderResult,
} from '../../src/lib/raceReview';
import type { RaceCapture, RaceCaptureFrame, RaceCaptureSample } from '../../src/types';

function frame(
  at: number,
  riders: Array<{
    playerId: 1 | 2;
    distanceMeters: number;
    speedKph: number;
    cadence: number;
    watts: number;
  }>,
): RaceCaptureFrame {
  return {
    at,
    elapsedMs: at - 1_000,
    raceState: 'racing',
    trackId: 'test-track',
    trackLengthMeters: 60,
    routeLengthMeters: 60,
    riders: riders.map((rider) => ({
      playerId: rider.playerId,
      riderName: `Rider ${rider.playerId}`,
      deviceId: 58_700 + rider.playerId,
      distanceMeters: rider.distanceMeters,
      velocityMps: rider.speedKph / 3.6,
      driveSource: 'cadence',
      driveAllowed: true,
      rawWatts: rider.watts,
      rawCadence: rider.cadence,
      rawSpeedKph: rider.speedKph,
      sampleAgeMs: 0,
      wattsAgeMs: 0,
      cadenceAgeMs: 0,
      speedAgeMs: 0,
    })),
  };
}

function baseCapture(): RaceCapture {
  return {
    version: 1,
    sessionId: 'review-test',
    createdAt: 500,
    startedAt: 1_000,
    endedAt: 4_000,
    status: 'finished',
    source: 'live',
    track: {
      id: 'test-track',
      name: 'Test BMX',
      country: 'United States',
      state: 'California',
      lengthMeters: 60,
      routeLengthMeters: 60,
    },
    sessionMode: 'sprint',
    selectedMetrics: ['cadence', 'speed', 'power'],
    players: [
      { id: 1, name: 'Rider 1', deviceId: 58_701, colorName: 'lime' },
      { id: 2, name: 'Rider 2', deviceId: 58_702, colorName: 'red' },
    ],
    zones: [
      { id: 'zone-1', name: 'Pedal Zone 1', startMeter: 0, endMeter: 30, type: 'pedal', restAfterSeconds: 0 },
      { id: 'zone-2', name: 'Pedal Zone 2', startMeter: 30, endMeter: 60, type: 'pedal', restAfterSeconds: 0 },
    ],
    events: [],
    samples: [],
    frames: [],
    reactionTimesByPlayer: {},
    summary: [
      {
        playerId: 1,
        riderName: 'Rider 1',
        colorName: 'lime',
        accent: '#84e047',
        deviceLabel: 'Bike 58701',
        rank: 1,
        finishTimeMs: 3_000,
        thirtyFootTimeMs: 1_680,
        distanceMeters: 60,
        sampleCount: 4,
        topSpeedKph: 30,
        averageSpeedKph: 20,
        topCadence: 110,
        averageCadence: 74,
        topWatts: 800,
        averageWatts: 475,
      },
      {
        playerId: 2,
        riderName: 'Rider 2',
        colorName: 'red',
        accent: '#ff4d4d',
        deviceLabel: 'Bike 58702',
        rank: 2,
        finishTimeMs: 3_000,
        thirtyFootTimeMs: 1_780,
        distanceMeters: 60,
        sampleCount: 4,
        topSpeedKph: 27,
        averageSpeedKph: 17.25,
        topCadence: 100,
        averageCadence: 67.5,
        topWatts: 700,
        averageWatts: 405,
      },
    ],
  };
}

describe('post-race pedal-zone results', () => {
  it('builds complete max and average metrics for every rider and zone', () => {
    const capture = baseCapture();
    capture.frames = [
      frame(1_000, [
        { playerId: 1, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
        { playerId: 2, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
      ]),
      frame(2_000, [
        { playerId: 1, distanceMeters: 20, speedKph: 20, cadence: 90, watts: 500 },
        { playerId: 2, distanceMeters: 15, speedKph: 18, cadence: 80, watts: 420 },
      ]),
      frame(3_000, [
        { playerId: 1, distanceMeters: 40, speedKph: 30, cadence: 110, watts: 800 },
        { playerId: 2, distanceMeters: 35, speedKph: 27, cadence: 100, watts: 700 },
      ]),
      frame(4_000, [
        { playerId: 1, distanceMeters: 60, speedKph: 25, cadence: 95, watts: 600 },
        { playerId: 2, distanceMeters: 60, speedKph: 24, cadence: 90, watts: 500 },
      ]),
    ];

    const results = buildRaceZoneResults(capture);
    const riderOneZoneOne = zoneRiderResult(results, 'zone-1', 1);
    const riderTwoZoneTwo = zoneRiderResult(results, 'zone-2', 2);

    expect(results).toHaveLength(2);
    expect(results.every((zone) => zone.riders.length === 2)).toBe(true);
    expect(riderOneZoneOne).toMatchObject({
      entryElapsedMs: 0,
      exitElapsedMs: 1_500,
      durationMs: 1_500,
      topSpeedKph: 25,
      topCadence: 100,
      topWatts: 650,
    });
    expect(riderOneZoneOne?.averageSpeedKph).toBeCloseTo(15, 3);
    expect(riderTwoZoneTwo?.sampleCount).toBeGreaterThanOrEqual(3);
    expect(riderTwoZoneTwo?.topSpeedKph).toBe(27);
    expect(riderTwoZoneTwo?.averageCadence).toBeGreaterThan(90);
    expect(riderTwoZoneTwo?.topWatts).toBe(700);

    const emptyMetricSummary = capture.summary.map((entry) => ({
      ...entry,
      sampleCount: 0,
      topSpeedKph: null,
      averageSpeedKph: null,
      topCadence: null,
      averageCadence: null,
      topWatts: null,
      averageWatts: null,
    }));
    const hydratedSummary = raceSummaryWithCapturedMetrics(capture, emptyMetricSummary);

    expect(hydratedSummary).toHaveLength(2);
    expect(hydratedSummary[0]).toMatchObject({
      topCadence: 110,
      topWatts: 800,
    });
    expect(hydratedSummary[0].topSpeedKph).toBeCloseTo(30, 6);
    expect(hydratedSummary[0].averageSpeedKph).toBeGreaterThan(0);
    expect(hydratedSummary[0].averageCadence).toBeGreaterThan(0);
    expect(hydratedSummary[0].averageWatts).toBeGreaterThan(0);
  });

  it('interpolates narrow zone boundaries when raw samples skip across the zone', () => {
    const capture = baseCapture();
    capture.players = [capture.players[0]];
    capture.summary = [capture.summary[0]];
    capture.zones = [{
      id: 'narrow-zone',
      name: 'Narrow pedal zone',
      startMeter: 10,
      endMeter: 12,
      type: 'pedal',
      restAfterSeconds: 0,
    }];
    const sample = (at: number, distanceMeters: number, speedKph: number, cadence: number, watts: number): RaceCaptureSample => ({
      at,
      elapsedMs: at - 1_000,
      playerId: 1,
      riderName: 'Rider 1',
      deviceId: 58_701,
      deviceLabel: 'Bike 58701',
      source: 'bluetooth',
      watts,
      cadence,
      speedKph,
      signal: 90,
      riderDistanceMeters: distanceMeters,
      riderVelocityMps: speedKph / 3.6,
      riderPhase: 'pedaling',
      rank: 1,
    });
    capture.samples = [
      sample(1_000, 0, 0, 0, 0),
      sample(2_000, 20, 40, 100, 800),
    ];

    const result = zoneRiderResult(buildRaceZoneResults(capture), 'narrow-zone', 1);

    expect(result?.sampleCount).toBe(2);
    expect(result?.entryElapsedMs).toBe(500);
    expect(result?.exitElapsedMs).toBe(600);
    expect(result?.durationMs).toBe(100);
    expect(result?.topSpeedKph).toBe(24);
    expect(result?.averageCadence).toBe(55);
    expect(result?.topWatts).toBe(480);
  });
});
