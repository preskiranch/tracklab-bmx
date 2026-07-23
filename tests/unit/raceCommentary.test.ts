import { describe, expect, it } from 'vitest';
import {
  createRaceCommentaryTracker,
  detectRaceCommentaryEvents,
  localCommentaryCombinationCount,
  localCommentaryLine,
  raceCommentaryEventIsFresh,
  selectLocalCommentaryFocusRiders,
  selectLiveRaceCommentaryEvent,
  type RaceCommentarySnapshot,
} from '../../src/lib/raceCommentary';
import type { PlayerSlot, RiderState } from '../../src/types';

const players: PlayerSlot[] = [
  { id: 1, name: 'Avery', colorName: 'lime', accent: '#65d636', deviceId: 101 },
  { id: 2, name: 'Blake', colorName: 'red', accent: '#e84b3d', deviceId: 102 },
  { id: 3, name: 'Casey', colorName: 'blue', accent: '#3d8ee8', deviceId: 103 },
  { id: 4, name: 'Drew', colorName: 'yellow', accent: '#e8ca3d', deviceId: 104 },
];

function rider(
  playerId: 1 | 2 | 3 | 4,
  distance = 0,
  overrides: Partial<RiderState> = {},
): RiderState {
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

  it('calls mid-pack passes and carries close third-versus-fourth battles', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 10),
        rider(2, 9),
        rider(3, 8),
        rider(4, 7.2),
      ]),
      1_000,
    );

    const pass = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 20),
        rider(3, 19),
        rider(2, 18.7),
        rider(4, 18.2),
      ]),
      1_200,
    );
    const positionChange = pass.find((event) => event.kind === 'position-change');

    expect(positionChange).toMatchObject({
      passingPlayerId: 3,
      passedPlayerId: 2,
    });
    expect(positionChange?.closeBattles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        frontPlayerId: 2,
        behindPlayerId: 4,
        position: 3,
      }),
    ]));
    expect(localCommentaryLine(positionChange!)).toMatch(/Casey.*Blake/i);
  });

  it('keeps an excited new-leader call centered on the front battle', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 10),
        rider(2, 9.5),
        rider(3, 8.5),
        rider(4, 8),
      ]),
      1_000,
    );
    const events = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(2, 20),
        rider(1, 19.7),
        rider(3, 18),
        rider(4, 17.5),
      ]),
      1_200,
    );
    const leadChange = events.find((event) => event.kind === 'lead-change');
    const line = localCommentaryLine(leadChange!);

    expect(line).toMatch(/Blake/i);
    expect(line).toMatch(/Avery/i);
    expect(line).not.toMatch(/Casey|Drew/i);
    expect(line).toMatch(/takes charge|takes command|new leader|out front|seizes the lead|front changes hands|hits the front|finds the front/i);
  });

  it('recognizes course action, the winner, and every later finisher once', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(tracker, snapshot(players.map((player) => rider(player.id))), 1_000);
    detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 1), rider(2, 0), rider(3, 0), rider(4, 0)]),
      1_100,
    );

    const pedalAndPro = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 45, { actualBranches: { 'Split 1': 'b' } }),
        rider(2, 44.5),
        rider(3, 40),
        rider(4, 39),
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
    const courseLine = localCommentaryLine(courseCall!);
    expect(players.filter((player) => courseLine.includes(player.name))).toHaveLength(2);
    expect(courseLine).not.toMatch(/\b(?:attack|pedal(?:ling|ing)? zone)\b/i);

    const finalPush = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 240), rider(2, 220), rider(3, 210), rider(4, 200)]),
      3_000,
    );
    expect(finalPush.map((event) => event.kind)).toContain('final-push');

    const finish = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200 }),
        rider(2, 270),
        rider(3, 260),
        rider(4, 250),
      ]),
      4_000,
    );
    expect(finish.find((event) => event.kind === 'finish')).toMatchObject({
      finishingPlayerId: 1,
    });

    const secondFinish = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200 }),
        rider(2, 300, { finishedAt: 32_100 }),
        rider(3, 280),
        rider(4, 270),
      ]),
      4_100,
    ).find((event) => event.kind === 'rider-finish');
    expect(secondFinish).toMatchObject({ finishingPlayerId: 2 });
    expect(localCommentaryLine(secondFinish!)).toMatch(/Blake.*second/i);

    const thirdFinish = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200 }),
        rider(2, 300, { finishedAt: 32_100 }),
        rider(3, 300, { finishedAt: 33_000 }),
        rider(4, 290),
      ]),
      4_200,
    ).find((event) => event.kind === 'rider-finish');
    expect(thirdFinish).toMatchObject({ finishingPlayerId: 3 });
    expect(localCommentaryLine(thirdFinish!)).toMatch(/Casey.*third/i);

    const fourthFinish = detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200 }),
        rider(2, 300, { finishedAt: 32_100 }),
        rider(3, 300, { finishedAt: 33_000 }),
        rider(4, 300, { finishedAt: 34_000 }),
      ]),
      4_300,
    ).find((event) => event.kind === 'rider-finish');
    expect(fourthFinish).toMatchObject({ finishingPlayerId: 4 });
    expect(localCommentaryLine(fourthFinish!)).toMatch(/Drew.*fourth/i);

    expect(detectRaceCommentaryEvents(
      tracker,
      snapshot([
        rider(1, 300, { finishedAt: 31_200 }),
        rider(2, 300, { finishedAt: 32_100 }),
        rider(3, 300, { finishedAt: 33_000 }),
        rider(4, 300, { finishedAt: 34_000 }),
      ]),
      4_400,
    ).map((event) => event.kind)).not.toContain('rider-finish');
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

  it('builds live calls from more than 100,000 sentence paths without repeating a demo series', () => {
    expect(localCommentaryCombinationCount).toBeGreaterThan(100_000);
    const baseEvent = {
      id: 'variation-0',
      sequence: 4,
      kind: 'lead-change' as const,
      occurredAt: 1_000,
      trackName: 'North Bay BMX',
      raceLengthMeters: 300,
      progress: 0.45,
      leaderPlayerId: 2 as const,
      previousLeaderPlayerId: 1 as const,
      coursePhase: 'second-straight' as const,
      battleState: 'under-pressure' as const,
      closeBattles: [{
        frontPlayerId: 3 as const,
        behindPlayerId: 4 as const,
        position: 3,
        gapMeters: 0.4,
      }],
      pedalReferenceAllowed: false,
      riders: [
        { playerId: 2 as const, name: 'Blake', rank: 1, distanceMeters: 140, driveAllowed: true, finished: false },
        { playerId: 1 as const, name: 'Avery', rank: 2, distanceMeters: 139.5, driveAllowed: true, finished: false },
        { playerId: 3 as const, name: 'Casey', rank: 3, distanceMeters: 138, driveAllowed: true, finished: false },
        { playerId: 4 as const, name: 'Drew', rank: 4, distanceMeters: 137.6, driveAllowed: true, finished: false },
      ],
    };
    const memory: string[] = [];
    for (let index = 0; index < 48; index += 1) {
      const line = localCommentaryLine({
        ...baseEvent,
        id: `variation-${index}`,
        sequence: index + 4,
      }, memory, memory.slice(-12));
      memory.push(line);
    }

    expect(new Set(memory).size).toBe(memory.length);
    expect(memory.join(' ')).toMatch(/\b(?:two spot|bar-to-bar|side-by-side|out front)\b/i);
  });

  it('rotates local fallback coverage through all four running positions', () => {
    const baseEvent = {
      id: 'coverage-2',
      sequence: 2,
      kind: 'positions-established' as const,
      occurredAt: 1_000,
      trackName: 'North Bay BMX',
      raceLengthMeters: 300,
      progress: 0.1,
      leaderPlayerId: 1 as const,
      coursePhase: 'first-straight' as const,
      battleState: 'under-pressure' as const,
      closeBattles: [],
      pedalReferenceAllowed: false,
      riders: [
        { playerId: 1 as const, name: 'Avery', rank: 1, distanceMeters: 30, driveAllowed: true, finished: false },
        { playerId: 2 as const, name: 'Blake', rank: 2, distanceMeters: 29, driveAllowed: true, finished: false },
        { playerId: 3 as const, name: 'Casey', rank: 3, distanceMeters: 28, driveAllowed: true, finished: false },
        { playerId: 4 as const, name: 'Drew', rank: 4, distanceMeters: 27, driveAllowed: true, finished: false },
      ],
    };
    const firstLine = localCommentaryLine(baseEvent, [], []);
    const secondLine = localCommentaryLine({
      ...baseEvent,
      id: 'coverage-3',
      sequence: 3,
      kind: 'pedal-zone',
    }, [firstLine], [firstLine]);
    const combined = `${firstLine} ${secondLine}`;

    expect(combined).toContain('Avery');
    expect(combined).toContain('Blake');
    expect(combined).toContain('Casey');
    expect(combined).toContain('Drew');
    expect(combined).toMatch(/\b(?:second|third|fourth|leads)\b/i);
  });

  it('keeps three of every four local fallback focus calls on the front two', () => {
    const baseEvent = {
      id: 'focus-balance',
      sequence: 1,
      kind: 'pedal-zone' as const,
      occurredAt: 1_000,
      trackName: 'North Bay BMX',
      raceLengthMeters: 300,
      progress: 0.4,
      leaderPlayerId: 1 as const,
      coursePhase: 'second-straight' as const,
      battleState: 'under-pressure' as const,
      closeBattles: [],
      pedalReferenceAllowed: false,
      riders: [
        { playerId: 1 as const, name: 'Avery', rank: 1, distanceMeters: 120, driveAllowed: true, finished: false },
        { playerId: 2 as const, name: 'Blake', rank: 2, distanceMeters: 119, driveAllowed: true, finished: false },
        { playerId: 3 as const, name: 'Casey', rank: 3, distanceMeters: 116, driveAllowed: true, finished: false },
        { playerId: 4 as const, name: 'Drew', rank: 4, distanceMeters: 114, driveAllowed: true, finished: false },
      ],
    };
    const calls = Array.from({ length: 12 }, (_, index) => (
      selectLocalCommentaryFocusRiders({ ...baseEvent, sequence: index + 1 })
    ));

    expect(calls.filter((call) => call.every((rider) => rider.rank <= 2))).toHaveLength(9);
    expect(calls.filter((call) => call.some((rider) => rider.rank >= 3))).toHaveLength(3);
  });

  it('uses occasional good-natured wit in local fallback calls', () => {
    const tracker = createRaceCommentaryTracker();
    const [event] = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 10), rider(2, 9)]),
      1_000,
    );
    const wittyEvent = {
      ...event,
      id: 'wry-5',
      sequence: 5,
      kind: 'positions-established' as const,
    };

    expect(localCommentaryLine(wittyEvent, [], []))
      .toMatch(/\b(?:calm|simple|quiet)\b/i);
  });

  it('keeps announcing at course-phase changes even without another pedal-zone boundary', () => {
    const tracker = createRaceCommentaryTracker();
    const noZones = (distance: number): RaceCommentarySnapshot => ({
      ...snapshot([rider(1, distance), rider(2, Math.max(0, distance - 0.5))]),
      zones: [],
    });

    detectRaceCommentaryEvents(tracker, noZones(0), 1_000);
    detectRaceCommentaryEvents(tracker, noZones(1), 1_100);
    const turnOne = detectRaceCommentaryEvents(tracker, noZones(70), 2_000);

    expect(turnOne).toHaveLength(1);
    expect(turnOne[0]).toMatchObject({
      kind: 'pedal-zone',
      coursePhase: 'turn-one',
      pedalReferenceAllowed: false,
    });
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

  it('expires pass calls quickly enough to avoid announcing an old order', () => {
    expect(raceCommentaryEventIsFresh({
      id: 'pass-1',
      sequence: 3,
      kind: 'position-change',
      occurredAt: 1_000,
      trackName: 'North Bay BMX',
      raceLengthMeters: 300,
      progress: 0.4,
      leaderPlayerId: 1,
      passingPlayerId: 3,
      passedPlayerId: 2,
      coursePhase: 'second-straight',
      battleState: 'under-pressure',
      closeBattles: [],
      pedalReferenceAllowed: false,
      riders: [],
    }, 3_750)).toBe(true);
    expect(raceCommentaryEventIsFresh({
      id: 'pass-1',
      sequence: 3,
      kind: 'position-change',
      occurredAt: 1_000,
      trackName: 'North Bay BMX',
      raceLengthMeters: 300,
      progress: 0.4,
      leaderPlayerId: 1,
      passingPlayerId: 3,
      passedPlayerId: 2,
      coursePhase: 'second-straight',
      battleState: 'under-pressure',
      closeBattles: [],
      pedalReferenceAllowed: false,
      riders: [],
    }, 3_751)).toBe(false);
  });

  it('keeps queued finish calls live long enough to complete after the ten-second window', () => {
    const tracker = createRaceCommentaryTracker();
    detectRaceCommentaryEvents(tracker, snapshot([rider(1), rider(2)]), 1_000);
    const [finishEvent] = detectRaceCommentaryEvents(
      tracker,
      snapshot([rider(1, 300, { finishedAt: 31_200 }), rider(2, 280)]),
      2_000,
    );

    expect(finishEvent.kind).toBe('finish');
    expect(raceCommentaryEventIsFresh(finishEvent, 26_000)).toBe(true);
    expect(raceCommentaryEventIsFresh(finishEvent, 26_001)).toBe(false);
  });
});
