import { racePositionsAreEstablished } from './racePositionDisplay';
import type {
  PlayerSlot,
  RaceState,
  ReactionTimesByPlayer,
  RiderState,
  TrackZone,
} from '../types';

export type RaceCommentaryEventKind =
  | 'race-start'
  | 'positions-established'
  | 'lead-change'
  | 'pedal-zone'
  | 'pro-set'
  | 'final-push'
  | 'finish';

export type RaceCommentaryCoursePhase =
  | 'first-straight'
  | 'turn-one'
  | 'second-straight'
  | 'rhythm-section'
  | 'final-turn'
  | 'last-straight';

export type RaceCommentaryBattleState =
  | 'solo'
  | 'side-by-side'
  | 'under-pressure'
  | 'clear-lead';

export type RaceCommentaryRiderFact = {
  playerId: PlayerSlot['id'];
  name: string;
  rank: number;
  distanceMeters: number;
  driveAllowed: boolean;
  finished: boolean;
};

export type RaceCommentaryEvent = {
  id: string;
  kind: RaceCommentaryEventKind;
  occurredAt: number;
  trackName: string;
  raceLengthMeters: number;
  progress: number;
  leaderPlayerId: PlayerSlot['id'] | null;
  previousLeaderPlayerId?: PlayerSlot['id'];
  zoneName?: string;
  splitName?: string;
  coursePhase: RaceCommentaryCoursePhase;
  battleState: RaceCommentaryBattleState;
  pedalReferenceAllowed: boolean;
  riders: RaceCommentaryRiderFact[];
};

export function maximumRaceCommentaryEventAgeMs(kind: RaceCommentaryEventKind) {
  if (kind === 'race-start') {
    return 2_500;
  }
  if (kind === 'finish') {
    return 2_000;
  }
  if (kind === 'final-push') {
    return 3_500;
  }
  return 4_500;
}

export function raceCommentaryEventIsFresh(
  event: RaceCommentaryEvent,
  now = Date.now(),
) {
  return now - event.occurredAt <= maximumRaceCommentaryEventAgeMs(event.kind);
}

export function selectLiveRaceCommentaryEvent(events: RaceCommentaryEvent[]) {
  return events.find((event) => event.kind === 'finish')
    ?? events.find((event) => event.kind === 'race-start')
    ?? events.at(-1)
    ?? null;
}

export type RaceCommentarySnapshot = {
  raceState: RaceState;
  trackName: string;
  raceLengthMeters: number;
  players: PlayerSlot[];
  riders: RiderState[];
  zones: TrackZone[];
  reactionTimesByPlayer: ReactionTimesByPlayer;
};

export type RaceCommentaryTracker = {
  raceState: RaceState;
  sequence: number;
  positionsEstablished: boolean;
  leaderPlayerId: PlayerSlot['id'] | null;
  leaderZoneId: string | null;
  leaderCoursePhase: RaceCommentaryCoursePhase | null;
  lastCourseCallProgress: number;
  courseCallCount: number;
  finalPushCalled: boolean;
  calledProBranches: Set<string>;
  finishedPlayerIds: Set<PlayerSlot['id']>;
};

export function createRaceCommentaryTracker(): RaceCommentaryTracker {
  return {
    raceState: 'ready',
    sequence: 0,
    positionsEstablished: false,
    leaderPlayerId: null,
    leaderZoneId: null,
    leaderCoursePhase: null,
    lastCourseCallProgress: 0,
    courseCallCount: 0,
    finalPushCalled: false,
    calledProBranches: new Set(),
    finishedPlayerIds: new Set(),
  };
}

function orderedRiders(snapshot: RaceCommentarySnapshot) {
  return [...snapshot.riders].sort((left, right) => {
    if (left.finishedAt != null || right.finishedAt != null) {
      if (left.finishedAt == null) return 1;
      if (right.finishedAt == null) return -1;
      return left.finishedAt - right.finishedAt;
    }
    return right.distance - left.distance || left.playerId - right.playerId;
  });
}

function riderFacts(snapshot: RaceCommentarySnapshot): RaceCommentaryRiderFact[] {
  const playerById = new Map(snapshot.players.map((player) => [player.id, player]));
  return orderedRiders(snapshot).map((rider, index) => ({
    playerId: rider.playerId,
    name: playerById.get(rider.playerId)?.name ?? `Rider ${rider.playerId}`,
    rank: index + 1,
    distanceMeters: Number(Math.max(0, rider.distance).toFixed(2)),
    driveAllowed: rider.driveAllowed,
    finished: rider.finishedAt != null,
  }));
}

function coursePhaseForProgress(progress: number): RaceCommentaryCoursePhase {
  if (progress < 0.22) return 'first-straight';
  if (progress < 0.34) return 'turn-one';
  if (progress < 0.55) return 'second-straight';
  if (progress < 0.72) return 'rhythm-section';
  if (progress < 0.84) return 'final-turn';
  return 'last-straight';
}

function battleStateForFacts(facts: RaceCommentaryRiderFact[]): RaceCommentaryBattleState {
  if (facts.length < 2) {
    return 'solo';
  }

  const gapMeters = Math.max(0, facts[0].distanceMeters - facts[1].distanceMeters);
  if (gapMeters <= 0.75) return 'side-by-side';
  if (gapMeters <= 2.5) return 'under-pressure';
  return 'clear-lead';
}

function eventFor(
  tracker: RaceCommentaryTracker,
  snapshot: RaceCommentarySnapshot,
  kind: RaceCommentaryEventKind,
  now: number,
  extra: Partial<RaceCommentaryEvent> = {},
): RaceCommentaryEvent {
  tracker.sequence += 1;
  const facts = riderFacts(snapshot);
  const leader = facts[0] ?? null;
  const progress = leader
    ? Number(Math.min(1, leader.distanceMeters / Math.max(1, snapshot.raceLengthMeters)).toFixed(3))
    : 0;
  return {
    id: `${now}-${tracker.sequence}-${kind}`,
    kind,
    occurredAt: now,
    trackName: snapshot.trackName,
    raceLengthMeters: Number(Math.max(1, snapshot.raceLengthMeters).toFixed(2)),
    progress,
    leaderPlayerId: leader?.playerId ?? null,
    coursePhase: coursePhaseForProgress(progress),
    battleState: battleStateForFacts(facts),
    pedalReferenceAllowed: false,
    riders: facts,
    ...extra,
  };
}

function resetTrackerForReady(tracker: RaceCommentaryTracker) {
  tracker.positionsEstablished = false;
  tracker.leaderPlayerId = null;
  tracker.leaderZoneId = null;
  tracker.leaderCoursePhase = null;
  tracker.lastCourseCallProgress = 0;
  tracker.courseCallCount = 0;
  tracker.finalPushCalled = false;
  tracker.calledProBranches.clear();
  tracker.finishedPlayerIds.clear();
}

export function detectRaceCommentaryEvents(
  tracker: RaceCommentaryTracker,
  snapshot: RaceCommentarySnapshot,
  now = Date.now(),
) {
  const events: RaceCommentaryEvent[] = [];

  if (snapshot.raceState === 'ready') {
    resetTrackerForReady(tracker);
    tracker.raceState = 'ready';
    return events;
  }

  if (snapshot.raceState === 'racing' && tracker.raceState !== 'racing') {
    resetTrackerForReady(tracker);
    events.push(eventFor(tracker, snapshot, 'race-start', now));
  }

  const ordered = orderedRiders(snapshot);
  const positionsEstablished = racePositionsAreEstablished(
    snapshot.raceState,
    ordered.map((rider) => ({
      distanceMeters: rider.distance,
      finishedAt: rider.finishedAt,
    })),
  );

  if (positionsEstablished && !tracker.positionsEstablished) {
    tracker.positionsEstablished = true;
    tracker.leaderPlayerId = ordered[0]?.playerId ?? null;
    events.push(eventFor(tracker, snapshot, 'positions-established', now));
  } else if (
    positionsEstablished
    && tracker.leaderPlayerId != null
    && ordered[0]
    && ordered[0].playerId !== tracker.leaderPlayerId
  ) {
    const previousLeaderPlayerId = tracker.leaderPlayerId;
    tracker.leaderPlayerId = ordered[0].playerId;
    events.push(eventFor(tracker, snapshot, 'lead-change', now, { previousLeaderPlayerId }));
  }

  const leader = ordered[0];
  if (positionsEstablished && leader) {
    const leaderZone = snapshot.zones.find((zone) => (
      zone.type === 'pedal'
      && leader.distance >= zone.startMeter
      && leader.distance < zone.endMeter
    ));
    let enteredLeaderPedalZone = false;
    if (leaderZone && leaderZone.id !== tracker.leaderZoneId) {
      tracker.leaderZoneId = leaderZone.id;
      enteredLeaderPedalZone = true;
    } else if (!leaderZone) {
      tracker.leaderZoneId = null;
    }

    const progress = leader.distance / Math.max(1, snapshot.raceLengthMeters);
    const coursePhase = coursePhaseForProgress(progress);
    const enteredNewCoursePhase = tracker.leaderCoursePhase != null
      && coursePhase !== tracker.leaderCoursePhase;
    tracker.leaderCoursePhase = coursePhase;
    const courseCallSpaced = progress - tracker.lastCourseCallProgress >= 0.14;
    if (
      (enteredLeaderPedalZone || enteredNewCoursePhase)
      && courseCallSpaced
      && progress >= 0.08
      && progress <= 0.92
    ) {
      tracker.lastCourseCallProgress = progress;
      tracker.courseCallCount += 1;
      events.push(eventFor(tracker, snapshot, 'pedal-zone', now, {
        ...(leaderZone ? { zoneName: leaderZone.name } : {}),
        pedalReferenceAllowed: Boolean(leaderZone) && tracker.courseCallCount % 4 === 0,
      }));
    }

    Object.entries(leader.actualBranches).forEach(([splitName, branch]) => {
      const branchKey = `${leader.playerId}:${splitName}`;
      if (branch === 'b' && !tracker.calledProBranches.has(branchKey)) {
        tracker.calledProBranches.add(branchKey);
        events.push(eventFor(tracker, snapshot, 'pro-set', now, { splitName }));
      }
    });

    if (!tracker.finalPushCalled && progress >= 0.78 && leader.finishedAt == null) {
      tracker.finalPushCalled = true;
      events.push(eventFor(tracker, snapshot, 'final-push', now));
    }
  }

  ordered.forEach((rider) => {
    if (rider.finishedAt == null || tracker.finishedPlayerIds.has(rider.playerId)) {
      return;
    }
    tracker.finishedPlayerIds.add(rider.playerId);
    if (tracker.finishedPlayerIds.size === 1) {
      events.push(eventFor(tracker, snapshot, 'finish', now));
    }
  });

  tracker.raceState = snapshot.raceState;
  const finishEvent = events.find((event) => event.kind === 'finish');
  return finishEvent
    ? [finishEvent, ...events.filter((event) => event !== finishEvent)].slice(0, 2)
    : events.slice(0, 2);
}

function pickLine(candidates: string[], event: RaceCommentaryEvent, recentLines: string[]) {
  const unused = candidates.filter((candidate) => !recentLines.includes(candidate));
  const pool = unused.length > 0 ? unused : candidates;
  const seed = [...event.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return pool[seed % pool.length];
}

function riderName(event: RaceCommentaryEvent, playerId: PlayerSlot['id'] | null | undefined) {
  return event.riders.find((rider) => rider.playerId === playerId)?.name ?? 'the leader';
}

function coursePhaseLabel(phase: RaceCommentaryCoursePhase) {
  const labels: Record<RaceCommentaryCoursePhase, string> = {
    'first-straight': 'first straight',
    'turn-one': 'turn one',
    'second-straight': 'second straight',
    'rhythm-section': 'rhythm section',
    'final-turn': 'final turn',
    'last-straight': 'last straight',
  };
  return labels[phase];
}

function courseActionLines(
  event: RaceCommentaryEvent,
  leader: string,
  second: string | undefined,
) {
  const phase = coursePhaseLabel(event.coursePhase);
  const closeBattle = event.battleState === 'side-by-side' || event.battleState === 'under-pressure';
  return [
    closeBattle && second
      ? `${leader} leads through the ${phase}, with ${second} right on the wheel.`
      : `${leader} keeps it clean through the ${phase}.`,
    closeBattle && second
      ? `${leader} and ${second} are locked together through the ${phase}.`
      : `${leader} is flying through the ${phase}.`,
    closeBattle && second
      ? `${second} keeps the pressure on ${leader} through the ${phase}.`
      : `${leader} carries the lead into the ${phase}.`,
    ...(event.pedalReferenceAllowed
      ? [second
        ? `${leader} gets back on the pedals, with ${second} giving chase.`
        : `${leader} gets back on the pedals and drives toward the ${phase}.`]
      : []),
  ];
}

export function localCommentaryLine(event: RaceCommentaryEvent, recentLines: string[] = []) {
  const leader = riderName(event, event.leaderPlayerId);
  const second = event.riders[1]?.name;
  const names = event.riders.map((rider) => rider.name).join(', ');
  const candidates: Record<RaceCommentaryEventKind, string[]> = {
    'race-start': [
      `Gate's down at ${event.trackName}. Here we go.`,
      `They're racing at ${event.trackName}, charging down the first straight.`,
      `A clean gate at ${event.trackName}, and the field is underway.`,
    ],
    'positions-established': [
      `${leader} shows in front${second ? `, with ${second} close behind.` : '.'}`,
      `${leader} has the early advantage, and the race is taking shape.`,
      `${leader} leads the charge down the first straight.`,
    ],
    'lead-change': [
      `${leader} makes the move and takes over.`,
      `Here comes ${leader}, moving through to the front.`,
      `${leader} finds a way past. We have a new leader.`,
    ],
    'pedal-zone': courseActionLines(event, leader, second),
    'pro-set': [
      `${leader} commits to the Pro Set, with ${second ?? 'the field'} still in pursuit.`,
      `${leader} takes the blue Pro line and holds the advantage.`,
      `Pro Set for ${leader}. ${second ? `${second} stays close.` : 'A confident line through the split.'}`,
    ],
    'final-push': [
      `${leader} leads them into the last straight.`,
      `Final drive to the line, with ${leader} holding the advantage.`,
      `${leader} is out front, but ${second ? `${second} is not done yet.` : 'the race is not over.'}`,
    ],
    finish: [
      `${leader} gets it done at ${event.trackName}.`,
      `${leader} takes the win.`,
      `${leader} brings it home and wins the race.`,
    ],
  };
  return pickLine(candidates[event.kind], event, recentLines);
}
