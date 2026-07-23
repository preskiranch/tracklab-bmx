import { describe, expect, it } from 'vitest';
import {
  createRaceCommentaryTracker,
  detectRaceCommentaryEvents,
  localCommentaryLine,
  raceCommentaryEventIsFresh,
  selectLiveRaceCommentaryEvent,
  type RaceCommentarySnapshot,
} from '../../src/lib/raceCommentary';
import type { PlayerSlot, RiderState } from '../../src/types';

const players: PlayerSlot[] = [
  { id: 1, name: 'Avery', colorName: 'lime', accent: '#65d636', deviceId: 101 },
  { id: 2, name: 'Blake', colorName: 'red', accent: '#e84b3d', deviceId: 102 },
];

function rider(playerId: 1 | 2, distance = 0, overrides: Partial<RiderState> = {}): RiderState {
  return {
    playerId,
    distance,
    velocity: 8,
    boost: 0,
    air: 0,
    verticalVelocity: 0,
    pitch: 0,
    pedalPhase: 0,
    landingCompression: 0,
    phase: 'pedaling',
    lastWatts: 500,
    lastRawWatts: 500,
    lastRawCadence: 105,
    lastRawSpeedKph: 0,
    driveAllowed: true,
    driveSource: 'cadence',
    wattsAverage: 500,
    rank: playerId,
    thirtyFootTimeMs: null,
    finishedAt: null,
    selectedBranch: 'a',
    actualBranches: {},
    proPenaltySections: {},
    ...overrides,
  };
}

function snapshot(riders: RiderState[], raceState: RaceCommentarySnapshot['raceState'] = 'racing') {
  return {
    raceState,
    trackName: 'North Bay BMX',
    raceLengthMeters: 300,
    players,
    riders,
    zones: [{
      id: 'zone-two',
      name: 'Second Straight',
      startMeter: 40,
      endMeter: 80,
      type: 'pedal' as const,
    }],
    reactionTimesByPlayer: {},
  };
}

describe('race commentary event detection', () => {
  it('does not assign positions while riders are tied on the gate', () => {
    const tracker = createRaceCommentaryTracker();

    expect(detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1), rider(2)]),
      1_000,
    ).map((event) => event.kind)).toEqual(['race-start']);

    expect(detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 0.02), rider(2, 0)]),
      1_100,
    )).toEqual([]);
  });

  it('calls the first real order and subsequent lead changes', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(tracker, snapshot([rider(1), rider(2)]), 1_000);

    expect(detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 0.08), rider(2, 0)]),
      1_100,
    ).map((event) => event.kind)).toContain('positions-established');

    const pass = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 0.1), rider(2, 0.2)]),
      1_200,
    );
    expect(pass.map((event) => event.kind)).toContain('lead-change');
    expect(pass.find((event) => event.kind === 'lead-change')).toMatchObject({
      leaderPlayerId: 2,
      previousLeaderPlayerId: 1,
    });
  });

  it('recognizes pedal zones, the Pro Set, the final push, and the winner once', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(tracker, snapshot([rider(1), rider(2)]), 1_000);
    detectRaceCommentaryEvents(tracker, snapshot([rider(1, 1), rider(2, 0)]), 1_100);

    const pedalAndPro = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 45, { actualBranches: { 'Split 1': 'b' } }),
        rider(2, 44.5),
      ]),
      2_000,
    );
    expect(pedalAndPro.map((event) => event.kind)).toEqual(expect.arrayContaining(['pedal-zone', 'pro-set']));
    const courseCall = pedalAndPro.find((event) => event.kind === 'pedal-zone');
    expect(courseCall).toMatchObject({
      coursePhase: 'first-straight',
      battleState: 'side-by-side',
      pedalReferenceAllowed: false,
    });
    expect(localCommentaryLine(courseCall!)).toMatch(/Avery.*Blake|Blake.*Avery/);
    expect(localCommentaryLine(courseCall!)).not.toMatch(/\b(?:attack|pedal(?:ling|ing)? zone)\b/i);

    const finalPush = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 240), rider(2, 220)]),
      3_000,
    );
    expect(finalPush.map((event) => event.kind)).toContain('final-push');

    const finish = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 300, { finishedAt: 31_200 }), rider(2, 270)]),
      4_000,
    );
    expect(finish.map((event) => event.kind)).toContain('finish');
    expect(detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 300, { finishedAt: 31_200 }), rider(2, 280)]),
      4_100,
    ).map((event) => event.kind)).not.toContain('finish');
  });

  it('provides varied local lines when the AI service is unavailable', () => {
    const tracker = createRaceCommentaryTracker();
    const [event] = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1), rider(2)]),
      1_000,
    );
    const first = localCommentaryLine(event);
    const second = localCommentaryLine(event, [first]);

    expect(first).toContain('North Bay BMX');
    expect(second).not.toBe(first);
  });

  it('keeps private bike telemetry out of announcer fact packs and local calls', () => {
    const tracker = createRaceCommentaryTracker();
    const [event] = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1), rider(2)]),
      1_000,
    );
    const serializedEvent = JSON.stringify(event);
    const line = localCommentaryLine(event);

    expect(serializedEvent).not.toMatch(/"watts"|"cadence"|"speedKph"|"reactionTimesByPlayer"/);
    expect(line).not.toMatch(/\b(?:watts?|rpm|cadence|speed|mph|kph|power output)\b/i);
  });

  it('spaces mapped-zone cues so they do not dominate the live call', () => {
    const tracker = createRaceCommentaryTracker();
    const withZones = (distance: number) => ({
      ...snapshot([rider(1, distance), rider(2, Math.max(0, distance - 1))]),
      zones: [
        { id: 'z1', name: 'Pedal Zone 1', startMeter: 40, endMeter: 50, type: 'pedal' as const },
        { id: 'z2', name: 'Pedal Zone 2', startMeter: 65, endMeter: 75, type: 'pedal' as const },
        { id: 'z3', name: 'Pedal Zone 3', startMeter: 95, endMeter: 110, type: 'pedal' as const },
      ],
    });

    detectRaceCommentaryEvents(tracker, withZones(0), 1_000);
    detectRaceCommentaryEvents(tracker, withZones(1), 1_100);
    expect(detectRaceCommentaryEvents(tracker, withZones(45), 2_000)
      .map((event) => event.kind)).toContain('pedal-zone');
    detectRaceCommentaryEvents(tracker, withZones(55), 2_100);
    expect(detectRaceCommentaryEvents(tracker, withZones(70), 2_200)
      .map((event) => event.kind)).not.toContain('pedal-zone');
    detectRaceCommentaryEvents(tracker, withZones(80), 2_300);
    expect(detectRaceCommentaryEvents(tracker, withZones(100), 2_400)
      .map((event) => event.kind)).toContain('pedal-zone');
  });

  it('prioritizes a finish call when several events happen in the same frame', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(tracker, snapshot([rider(1), rider(2)]), 1_000);

    const events = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200, actualBranches: { 'Split 1': 'b' } }),
        rider(2, 250),
      ]),
      2_000,
    );

    expect(events[0].kind).toBe('finish');
    expect(selectLiveRaceCommentaryEvent(events)?.kind).toBe('finish');
  });

  it('keeps the gate call ahead of an early position call', () => {
    const tracker = createRaceCommentaryTracker();
    const events = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 1), rider(2, 0)]),
      1_000,
    );

    expect(events.map((event) => event.kind)).toEqual(['race-start', 'positions-established']);
    expect(selectLiveRaceCommentaryEvent(events)?.kind).toBe('race-start');
  });

  it('drops race calls that are no longer live', () => {
    const tracker = createRaceCommentaryTracker();
    const [startEvent] = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1), rider(2)]),
      1_000,
    );

    expect(raceCommentaryEventIsFresh(startEvent, 3_500)).toBe(true);
    expect(raceCommentaryEventIsFresh(startEvent, 3_501)).toBe(false);
  });
});
