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
      topCadence: 100,
      topWatts: 650,
    });
    expect(riderOneZoneOne?.topSpeedKph).toBeCloseTo(26.3328, 4);
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

  it('records only each rider’s actual amateur/pro branch zone so Watch windows cannot overlap', () => {
    const capture = baseCapture();
    capture.zones = [{
      id: 'amateur-zone',
      name: 'Amateur first straight',
      startMeter: 10,
      endMeter: 30,
      type: 'pedal',
      branchSelections: { 'split-1': 'a' },
    }, {
      id: 'pro-zone',
      name: 'Pro first straight',
      startMeter: 10,
      endMeter: 30,
      type: 'pedal',
      branchSelections: { 'split-1': 'b' },
    }];
    capture.frames = [
      frame(1_000, [
        { playerId: 1, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
        { playerId: 2, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
      ]),
      frame(2_000, [
        { playerId: 1, distanceMeters: 20, speedKph: 25, cadence: 95, watts: 600 },
        { playerId: 2, distanceMeters: 20, speedKph: 27, cadence: 100, watts: 700 },
      ]),
      frame(3_000, [
        { playerId: 1, distanceMeters: 40, speedKph: 30, cadence: 110, watts: 800 },
        { playerId: 2, distanceMeters: 40, speedKph: 32, cadence: 115, watts: 900 },
      ]),
    ];

    const results = buildRaceZoneResults(capture, {
      1: { 'split-1': 'a' },
      2: { 'split-1': 'b' },
    });

    expect(zoneRiderResult(results, 'amateur-zone', 1)).toMatchObject({
      entryElapsedMs: 500,
      exitElapsedMs: 1_500,
      sampleCount: 3,
    });
    expect(zoneRiderResult(results, 'amateur-zone', 2)).toMatchObject({
      entryElapsedMs: null,
      exitElapsedMs: null,
      sampleCount: 0,
    });
    expect(zoneRiderResult(results, 'pro-zone', 1)).toMatchObject({
      entryElapsedMs: null,
      exitElapsedMs: null,
      sampleCount: 0,
    });
    expect(zoneRiderResult(results, 'pro-zone', 2)).toMatchObject({
      entryElapsedMs: 500,
      exitElapsedMs: 1_500,
      sampleCount: 3,
    });

    const unknownBranches = buildRaceZoneResults(capture);
    expect(zoneRiderResult(unknownBranches, 'amateur-zone', 1).sampleCount).toBe(3);
    expect(zoneRiderResult(unknownBranches, 'pro-zone', 1).sampleCount).toBe(3);
  });

  it('keeps corrected demo cadence and reported peak speed in the same order', () => {
    const capture = baseCapture();
    capture.frames = [
      frame(1_000, [
        { playerId: 1, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
        { playerId: 2, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
      ]),
      frame(2_000, [
        { playerId: 1, distanceMeters: 12, speedKph: 27.9 * 1.609344, cadence: 173, watts: 900 },
        { playerId: 2, distanceMeters: 12, speedKph: 28 * 1.609344, cadence: 171, watts: 890 },
      ]),
    ];
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
    const higherCadenceRider = hydratedSummary.find((entry) => entry.playerId === 1);
    const lowerCadenceRider = hydratedSummary.find((entry) => entry.playerId === 2);

    expect(higherCadenceRider?.topCadence).toBe(173);
    expect(lowerCadenceRider?.topCadence).toBe(171);
    expect(higherCadenceRider?.topSpeedKph).toBeGreaterThan(lowerCadenceRider?.topSpeedKph ?? 0);
    expect((higherCadenceRider?.topSpeedKph ?? 0) / 1.609344).toBeCloseTo(28.31, 2);
    expect((lowerCadenceRider?.topSpeedKph ?? 0) / 1.609344).toBeCloseTo(28, 2);
  });

  it('excludes corrupt cadence from race history and cadence-derived peak speed', () => {
    const capture = baseCapture();
    capture.players = [capture.players[0]];
    capture.summary = [{
      ...capture.summary[0],
      sampleCount: 0,
      topSpeedKph: null,
      averageSpeedKph: null,
      topCadence: null,
      averageCadence: null,
    }];
    capture.frames = [
      frame(1_000, [
        { playerId: 1, distanceMeters: 0, speedKph: 0, cadence: 0, watts: 0 },
      ]),
      frame(2_000, [
        { playerId: 1, distanceMeters: 20, speedKph: 30, cadence: 100, watts: 500 },
      ]),
      frame(3_000, [
        { playerId: 1, distanceMeters: 40, speedKph: 32, cadence: 923_334, watts: 600 },
      ]),
    ];

    const [summary] = raceSummaryWithCapturedMetrics(capture, capture.summary);
    const [zone] = buildRaceZoneResults(capture);

    expect(summary.topCadence).toBe(100);
    expect(summary.averageCadence).toBe(50);
    expect(summary.topSpeedKph).toBe(32);
    expect(zone.riders[0].topCadence).toBe(100);
    expect(zone.riders[0].topSpeedKph).toBe(31);
  });

  it('does not revive corrupt legacy summary fallbacks when no valid capture points remain', () => {
    const capture = baseCapture();
    capture.players = [capture.players[0]];
    capture.frames = [];
    capture.samples = [];
    capture.summary = [{
      ...capture.summary[0],
      topSpeedKph: 243_139.8,
      averageSpeedKph: 9.4,
      topCadence: 923_334,
      averageCadence: 68_458.7,
    }];

    const [summary] = raceSummaryWithCapturedMetrics(capture, capture.summary);

    expect(summary.topSpeedKph).toBeNull();
    expect(summary.averageSpeedKph).toBe(9.4);
    expect(summary.topCadence).toBeNull();
    expect(summary.averageCadence).toBeNull();
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

  it('associates authoritative bike packets with the zone occupied at that moment', () => {
    const capture = baseCapture();
    capture.players = [capture.players[0]];
    capture.summary = [{ ...capture.summary[0], finishTimeMs: 4_800 }];
    capture.zones = [
      { id: 'zone-1', name: 'Pedal Zone 1', startMeter: 0, endMeter: 18, type: 'pedal', restAfterSeconds: 0 },
      { id: 'zone-2', name: 'Pedal Zone 2', startMeter: 22, endMeter: 38, type: 'pedal', restAfterSeconds: 0 },
      { id: 'zone-3', name: 'Pedal Zone 3', startMeter: 42, endMeter: 60, type: 'pedal', restAfterSeconds: 0 },
    ];
    capture.frames = [0, 10, 20, 30, 40, 50, 60].map((distanceMeters, index) => frame(
      1_000 + index * 800,
      [{ playerId: 1, distanceMeters, speedKph: 29.3, cadence: 115, watts: 0 }],
    ));
    capture.samples = [
      [0, 50, 125, 1_000],
      [10, 45, 120, 900],
      [20, 40, 112, 800],
      [30, 35, 105, 700],
      [40, 30, 100, 600],
      [50, 25, 90, 500],
      [60, 20, 80, 400],
    ].map(([distanceMeters, speedKph, cadence, watts], index): RaceCaptureSample => ({
      at: 1_000 + index * 800,
      elapsedMs: index * 800,
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
    }));

    const results = buildRaceZoneResults(capture);
    const firstZone = zoneRiderResult(results, 'zone-1', 1);
    const middleZone = zoneRiderResult(results, 'zone-2', 1);
    const finalZone = zoneRiderResult(results, 'zone-3', 1);

    expect(firstZone).toMatchObject({
      topCadence: 125,
      topSpeedKph: 50,
      topWatts: 1_000,
    });
    expect(middleZone?.topCadence).toBeLessThan(firstZone?.topCadence ?? 0);
    expect(finalZone?.topCadence).toBeLessThan(middleZone?.topCadence ?? 0);
    expect(middleZone?.topSpeedKph).toBeLessThan(firstZone?.topSpeedKph ?? 0);
    expect(finalZone?.topSpeedKph).toBeLessThan(middleZone?.topSpeedKph ?? 0);
    expect(middleZone?.topWatts).toBeLessThan(firstZone?.topWatts ?? 0);
    expect(finalZone?.topWatts).toBeLessThan(middleZone?.topWatts ?? 0);
    expect(results.every((zone) => (zone.riders[0]?.topWatts ?? 0) > 0)).toBe(true);
  });
});
