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

export type RaceCommentaryRiderFact = {
  playerId: PlayerSlot['id'];
  name: string;
  rank: number;
  distanceMeters: number;
  speedKph: number;
  cadence: number;
  watts: number;
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
  reactionTimesByPlayer: ReactionTimesByPlayer;
  riders: RaceCommentaryRiderFact[];
};

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
    speedKph: Number(Math.max(0, rider.velocity * 3.6).toFixed(1)),
    cadence: Math.max(0, Math.round(rider.lastRawCadence)),
    watts: Math.max(0, Math.round(rider.lastRawWatts)),
    driveAllowed: rider.driveAllowed,
    finished: rider.finishedAt != null,
  }));
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
  return {
    id: `${now}-${tracker.sequence}-${kind}`,
    kind,
    occurredAt: now,
    trackName: snapshot.trackName,
    raceLengthMeters: Number(Math.max(1, snapshot.raceLengthMeters).toFixed(2)),
    progress: leader
      ? Number(Math.min(1, leader.distanceMeters / Math.max(1, snapshot.raceLengthMeters)).toFixed(3))
      : 0,
    leaderPlayerId: leader?.playerId ?? null,
    reactionTimesByPlayer: snapshot.reactionTimesByPlayer,
    riders: facts,
    ...extra,
  };
}

function resetTrackerForReady(tracker: RaceCommentaryTracker) {
  tracker.positionsEstablished = false;
  tracker.leaderPlayerId = null;
  tracker.leaderZoneId = null;
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
    if (
      leaderZone
      && leaderZone.id !== tracker.leaderZoneId
      && leader.distance / Math.max(1, snapshot.raceLengthMeters) >= 0.04
    ) {
      tracker.leaderZoneId = leaderZone.id;
      events.push(eventFor(tracker, snapshot, 'pedal-zone', now, { zoneName: leaderZone.name }));
    } else if (!leaderZone) {
      tracker.leaderZoneId = null;
    }

    Object.entries(leader.actualBranches).forEach(([splitName, branch]) => {
      const branchKey = `${leader.playerId}:${splitName}`;
      if (branch === 'b' && !tracker.calledProBranches.has(branchKey)) {
        tracker.calledProBranches.add(branchKey);
        events.push(eventFor(tracker, snapshot, 'pro-set', now, { splitName }));
      }
    });

    const progress = leader.distance / Math.max(1, snapshot.raceLengthMeters);
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

export function localCommentaryLine(event: RaceCommentaryEvent, recentLines: string[] = []) {
  const leader = riderName(event, event.leaderPlayerId);
  const second = event.riders[1]?.name;
  const names = event.riders.map((rider) => rider.name).join(', ');
  const candidates: Record<RaceCommentaryEventKind, string[]> = {
    'race-start': [
      `The gate is down at ${event.trackName}. ${names} are underway.`,
      `We are racing at ${event.trackName}, and all eyes are on the opening drive.`,
      `Clean start at ${event.trackName}. The field charges into the first straight.`,
    ],
    'positions-established': [
      `${leader} edges into the early lead${second ? `, with ${second} right there` : ''}.`,
      `${leader} has the first clear advantage as the order begins to settle.`,
      `The race takes shape, and it is ${leader} showing in front.`,
    ],
    'lead-change': [
      `${leader} makes the move and takes over the lead.`,
      `New leader: ${leader} has ridden through to the front.`,
      `${leader} finds the speed and moves into the top spot.`,
    ],
    'pedal-zone': [
      `${leader} drives hard through ${event.zoneName ?? 'the next pedal zone'}.`,
      `Back on the pedals for ${leader} through ${event.zoneName ?? 'this straight'}.`,
      `${leader} is putting power down in ${event.zoneName ?? 'the pedal section'}.`,
    ],
    'pro-set': [
      `${leader} commits to the Pro Set and carries speed through the split.`,
      `It is the blue Pro line for ${leader}, attacking the split section.`,
      `${leader} takes the Pro Set option and keeps the pressure on.`,
    ],
    'final-push': [
      `${leader} leads the charge into the closing part of the track.`,
      `Final push now, with ${leader} holding the advantage.`,
      `${leader} is out front with the finish coming quickly.`,
    ],
    finish: [
      `${leader} gets to the stripe first at ${event.trackName}.`,
      `It is ${leader} for the win.`,
      `${leader} closes it out and takes the race.`,
    ],
  };
  return pickLine(candidates[event.kind], event, recentLines);
}
