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
  sequence: number;
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
    return 8_000;
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
    sequence: tracker.sequence,
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

function lineTokens(line: string) {
  return line
    .normalize('NFKD')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenSimilarity(leftLine: string, rightLine: string) {
  const left = new Set(lineTokens(leftLine));
  const right = new Set(lineTokens(rightLine));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      shared += 1;
    }
  });
  return shared / (left.size + right.size - shared);
}

function lineRaceSections(line: string) {
  const patterns: Array<[RaceCommentaryCoursePhase, RegExp]> = [
    ['first-straight', /\b(?:first|opening)\s+straight(?:away)?\b/i],
    ['turn-one', /\b(?:turn|corner)\s+(?:one|1|first)\b|\bfirst\s+(?:turn|corner)\b/i],
    ['second-straight', /\bsecond\s+straight(?:away)?\b/i],
    ['rhythm-section', /\brhythm(?:\s+section)?\b/i],
    ['final-turn', /\b(?:final|last)\s+(?:turn|corner)\b/i],
    ['last-straight', /\b(?:final|last|home)\s+straight(?:away)?\b/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(line)).map(([section]) => section);
}

function lineRepeatsRecentRaceSection(line: string, raceLines: string[]) {
  const sections = lineRaceSections(line);
  const recentSections = new Set(raceLines.slice(-4).flatMap(lineRaceSections));
  return sections.some((section) => recentSections.has(section));
}

function pickLine(
  candidates: string[],
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      repeatsRaceSection: lineRepeatsRecentRaceSection(candidate, raceLines),
      similarity: recentLines.reduce(
        (highest, recentLine) => Math.max(highest, tokenSimilarity(candidate, recentLine)),
        0,
      ),
    }))
    .sort((left, right) => (
      Number(left.repeatsRaceSection) - Number(right.repeatsRaceSection)
      || left.similarity - right.similarity
    ));
  const bestRepeatsRaceSection = ranked[0]?.repeatsRaceSection ?? false;
  const bestSimilarity = ranked[0]?.similarity ?? 0;
  const pool = ranked
    .filter((item) => (
      item.repeatsRaceSection === bestRepeatsRaceSection
      && item.similarity <= bestSimilarity + 0.05
    ))
    .map((item) => item.candidate);
  const seed = [...event.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return pool[seed % pool.length];
}

function lineMentionsLocalRider(line: string, rider: RaceCommentaryRiderFact) {
  const lineWords = new Set(lineTokens(line));
  const aliases = [rider.name, rider.name.split(/\s+/)[0]].map(lineTokens);
  return aliases.some((alias) => (
    alias.length > 0 && alias.every((word) => lineWords.has(word))
  ));
}

export function selectLocalCommentaryFocusRiders(
  event: RaceCommentaryEvent,
  raceLines: string[] = [],
  limit = 2,
) {
  const riders = [...event.riders].sort((left, right) => left.rank - right.rank);
  const mentionCounts = new Map(riders.map((rider) => [
    rider.playerId,
    raceLines.reduce(
      (count, line) => count + (lineMentionsLocalRider(line, rider) ? 1 : 0),
      0,
    ),
  ]));
  const startIndex = Math.max(0, event.sequence - 1) % Math.max(1, riders.length);
  const orderByPlayerId = new Map(riders.map((rider, index) => [rider.playerId, index]));
  return riders
    .sort((left, right) => {
      const mentionDifference = (mentionCounts.get(left.playerId) ?? 0)
        - (mentionCounts.get(right.playerId) ?? 0);
      if (mentionDifference !== 0) {
        return mentionDifference;
      }
      const leftIndex = orderByPlayerId.get(left.playerId) ?? 0;
      const rightIndex = orderByPlayerId.get(right.playerId) ?? 0;
      return ((leftIndex - startIndex + riders.length) % riders.length)
        - ((rightIndex - startIndex + riders.length) % riders.length);
    })
    .slice(0, Math.min(limit, riders.length));
}

function requiredLocalCommentaryRiders(
  event: RaceCommentaryEvent,
  raceLines: string[],
) {
  const focusRiders = selectLocalCommentaryFocusRiders(event, raceLines, 2);
  const leader = event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    ?? event.riders[0];
  if (event.kind === 'race-start') return [];
  if (event.kind === 'finish') return leader ? [leader] : [];
  if (event.kind === 'lead-change') {
    const previousLeader = event.riders.find(
      (rider) => rider.playerId === event.previousLeaderPlayerId,
    );
    return [...new Map(
      [leader, previousLeader, ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 2);
  }
  if (event.kind === 'pro-set' || event.kind === 'final-push') {
    return [...new Map(
      [leader, ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 2);
  }
  return focusRiders;
}

function localPositionClause(rider: RaceCommentaryRiderFact) {
  if (rider.rank === 1) return `${rider.name} leads`;
  if (rider.rank === 2) return `${rider.name} runs second`;
  if (rider.rank === 3) return `${rider.name} holds third`;
  return `${rider.name} is fourth`;
}

function localCoverageLines(
  event: RaceCommentaryEvent,
  requiredRiders: RaceCommentaryRiderFact[],
) {
  const [first, second] = requiredRiders;
  if (!first || !second) {
    return [];
  }
  const firstClause = localPositionClause(first);
  const secondClause = localPositionClause(second);
  const wryAside = event.kind !== 'finish' && event.sequence % 5 === 0;
  const applyWryAside = (lines: string[]) => wryAside
    ? lines.map((line) => `${line.replace(/[.!]$/, '')}—calm clearly stayed home.`)
    : lines;
  if (event.kind === 'lead-change') {
    return applyWryAside([
      `${first.name} takes over, while ${secondClause}.`,
      `${first.name} moves in front; ${secondClause} after the change.`,
    ]);
  }
  if (event.kind === 'pro-set') {
    return applyWryAside([
      `${first.name} goes Pro, while ${secondClause} in the chase.`,
      `Pro line for ${first.name}; ${secondClause} and stays involved.`,
    ]);
  }
  if (event.kind === 'final-push') {
    return applyWryAside([
      `${firstClause} toward the line, while ${secondClause}.`,
      `The final charge belongs to ${first.name}; ${secondClause} behind.`,
    ]);
  }
  if (wryAside) {
    return [
      `${firstClause}, while ${secondClause}—calm clearly stayed home.`,
      `${firstClause}; ${secondClause}. Nobody is making this simple.`,
      `${firstClause}, with ${secondClause} still ruining everyone’s quiet ride.`,
    ];
  }
  return [
    `${firstClause}, while ${secondClause} stays firmly in the race.`,
    `${firstClause}; ${secondClause} remains part of the fight.`,
    `${firstClause}, with ${secondClause} holding position in the chase.`,
  ];
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
    closeBattle && second
      ? `Nothing between ${leader} and ${second} in the ${phase}.`
      : `Smooth and fast, ${leader} controls the ${phase}.`,
    closeBattle && second
      ? `${leader} has company—${second} is charging through the ${phase}.`
      : `The advantage belongs to ${leader} through the ${phase}.`,
    ...(event.pedalReferenceAllowed
      ? [second
        ? `${leader} gets back on the pedals, with ${second} giving chase.`
        : `${leader} gets back on the pedals and drives toward the ${phase}.`]
      : []),
  ];
}

export function localCommentaryLine(
  event: RaceCommentaryEvent,
  recentLines: string[] = [],
  raceLines: string[] = [],
) {
  const leader = riderName(event, event.leaderPlayerId);
  const second = event.riders[1]?.name;
  const requiredRiders = requiredLocalCommentaryRiders(event, raceLines);
  const candidates: Record<RaceCommentaryEventKind, string[]> = {
    'race-start': [
      `Gate's down at ${event.trackName}. Here we go.`,
      `They're racing at ${event.trackName}, charging down the first straight.`,
      `A clean gate at ${event.trackName}, and the field is underway.`,
      `${event.trackName} comes alive as the gate drops.`,
      `Here we go at ${event.trackName}—the whole field launches.`,
    ],
    'positions-established': [
      `${leader} shows in front${second ? `, with ${second} close behind.` : '.'}`,
      `${leader} has the early advantage, and the race is taking shape.`,
      `${leader} leads the charge down the first straight.`,
      `${second ? `${second} gives chase, but ` : ''}${leader} has the early lead.`,
      `Out front early, it's ${leader}${second ? ` with ${second} pressing.` : '.'}`,
    ],
    'lead-change': [
      `${leader} makes the move and takes over.`,
      `Here comes ${leader}, moving through to the front.`,
      `${leader} finds a way past. We have a new leader.`,
      `What a move from ${leader}—straight into the lead!`,
      `The race turns as ${leader} sweeps to the front.`,
    ],
    'pedal-zone': courseActionLines(event, leader, second),
    'pro-set': [
      `${leader} commits to the Pro Set, with ${second ?? 'the field'} still in pursuit.`,
      `${leader} takes the blue Pro line and holds the advantage.`,
      `Pro Set for ${leader}. ${second ? `${second} stays close.` : 'A confident line through the split.'}`,
      `${leader} chooses the Pro line${second ? `, and ${second} keeps chasing.` : '.'}`,
      `Through the split, ${leader} goes Pro and stays in command.`,
    ],
    'final-push': [
      `${leader} leads them into the last straight.`,
      `Final drive to the line, with ${leader} holding the advantage.`,
      `${leader} is out front, but ${second ? `${second} is not done yet.` : 'the race is not over.'}`,
      `${second ? `${second} is coming, but ` : ''}${leader} still owns the last straight.`,
      `It's ${leader} in front with the stripe rushing closer.`,
    ],
    finish: [
      `${leader} gets it done at ${event.trackName}.`,
      `${leader} takes the win.`,
      `${leader} brings it home and wins the race.`,
      `Across the stripe, it's ${leader} with the victory!`,
      `${leader} holds on and takes it at ${event.trackName}!`,
    ],
  };
  const coverageLines = localCoverageLines(event, requiredRiders);
  return pickLine(
    coverageLines.length > 0 ? coverageLines : candidates[event.kind],
    event,
    recentLines,
    raceLines,
  );
}
