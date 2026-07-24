import { racePositionsAreEstablished } from './racePositionDisplay';
import {
  commentaryRiderNameParts,
  commentaryRiderNameForms,
  selectCommentaryRiderName,
} from './commentaryNames';
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
  | 'race-update'
  | 'lead-change'
  | 'position-change'
  | 'pedal-zone'
  | 'pro-set'
  | 'final-push'
  | 'rider-finish'
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

export type RaceCommentaryCloseBattleFact = {
  frontPlayerId: PlayerSlot['id'];
  behindPlayerId: PlayerSlot['id'];
  position: number;
  gapMeters: number;
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
  passingPlayerId?: PlayerSlot['id'];
  passedPlayerId?: PlayerSlot['id'];
  finishingPlayerId?: PlayerSlot['id'];
  zoneName?: string;
  splitName?: string;
  coursePhase: RaceCommentaryCoursePhase;
  battleState: RaceCommentaryBattleState;
  closeBattles: RaceCommentaryCloseBattleFact[];
  pedalReferenceAllowed: boolean;
  riders: RaceCommentaryRiderFact[];
};

export function maximumRaceCommentaryEventAgeMs(kind: RaceCommentaryEventKind) {
  if (kind === 'race-start') {
    return 2_500;
  }
  if (kind === 'lead-change' || kind === 'position-change') {
    return 2_750;
  }
  if (kind === 'finish' || kind === 'rider-finish') {
    return 60_000;
  }
  if (kind === 'race-update') {
    return 6_500;
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
    ?? events.find((event) => event.kind === 'rider-finish')
    ?? events.find((event) => event.kind === 'race-start')
    ?? events.find((event) => event.kind === 'lead-change')
    ?? events.find((event) => event.kind === 'position-change')
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
  runningOrderPlayerIds: PlayerSlot['id'][];
  leaderZoneId: string | null;
  leaderCoursePhase: RaceCommentaryCoursePhase | null;
  lastCourseCallProgress: number;
  courseCallCount: number;
  finalPushCalled: boolean;
  calledProBranches: Set<string>;
  finishedPlayerIds: Set<PlayerSlot['id']>;
  lastAnnouncerCallAt: number;
};

export const continuousRaceCommentaryIntervalMs = 2_500;

export function createRaceCommentaryTracker(): RaceCommentaryTracker {
  return {
    raceState: 'ready',
    sequence: 0,
    positionsEstablished: false,
    leaderPlayerId: null,
    runningOrderPlayerIds: [],
    leaderZoneId: null,
    leaderCoursePhase: null,
    lastCourseCallProgress: 0,
    courseCallCount: 0,
    finalPushCalled: false,
    calledProBranches: new Set(),
    finishedPlayerIds: new Set(),
    lastAnnouncerCallAt: 0,
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

function closeBattlesForFacts(
  facts: RaceCommentaryRiderFact[],
): RaceCommentaryCloseBattleFact[] {
  return facts.slice(0, -1).flatMap((frontRider, index) => {
    const behindRider = facts[index + 1];
    const gapMeters = Math.max(0, frontRider.distanceMeters - behindRider.distanceMeters);
    if (gapMeters > 1.25) {
      return [];
    }
    return [{
      frontPlayerId: frontRider.playerId,
      behindPlayerId: behindRider.playerId,
      position: frontRider.rank,
      gapMeters: Number(gapMeters.toFixed(2)),
    }];
  });
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
    closeBattles: closeBattlesForFacts(facts),
    pedalReferenceAllowed: false,
    riders: facts,
    ...extra,
  };
}

function resetTrackerForReady(tracker: RaceCommentaryTracker) {
  tracker.positionsEstablished = false;
  tracker.leaderPlayerId = null;
  tracker.runningOrderPlayerIds = [];
  tracker.leaderZoneId = null;
  tracker.leaderCoursePhase = null;
  tracker.lastCourseCallProgress = 0;
  tracker.courseCallCount = 0;
  tracker.finalPushCalled = false;
  tracker.calledProBranches.clear();
  tracker.finishedPlayerIds.clear();
  tracker.lastAnnouncerCallAt = 0;
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
    tracker.runningOrderPlayerIds = ordered.map((rider) => rider.playerId);
    events.push(eventFor(tracker, snapshot, 'positions-established', now));
  } else if (positionsEstablished) {
    const nextOrderPlayerIds = ordered.map((rider) => rider.playerId);
    const orderChanged = nextOrderPlayerIds.some(
      (playerId, index) => tracker.runningOrderPlayerIds[index] !== playerId,
    );
    if (orderChanged) {
      const previousOrderPlayerIds = tracker.runningOrderPlayerIds;
      const previousLeaderPlayerId = tracker.leaderPlayerId;
      const nextLeaderPlayerId = ordered[0]?.playerId ?? null;
      if (
        previousLeaderPlayerId != null
        && nextLeaderPlayerId != null
        && nextLeaderPlayerId !== previousLeaderPlayerId
      ) {
        events.push(eventFor(tracker, snapshot, 'lead-change', now, {
          previousLeaderPlayerId,
        }));
      } else {
        const passingRider = nextOrderPlayerIds
          .map((playerId, nextIndex) => ({
            playerId,
            nextIndex,
            previousIndex: previousOrderPlayerIds.indexOf(playerId),
          }))
          .filter(({ previousIndex, nextIndex }) => (
            previousIndex >= 0 && previousIndex > nextIndex
          ))
          .sort((left, right) => left.nextIndex - right.nextIndex)[0];
        const passedPlayerId = passingRider
          ? previousOrderPlayerIds[passingRider.nextIndex]
          : undefined;
        if (
          passingRider
          && passedPlayerId != null
          && passedPlayerId !== passingRider.playerId
        ) {
          events.push(eventFor(tracker, snapshot, 'position-change', now, {
            passingPlayerId: passingRider.playerId,
            passedPlayerId,
          }));
        }
      }
      tracker.leaderPlayerId = nextLeaderPlayerId;
      tracker.runningOrderPlayerIds = nextOrderPlayerIds;
    }
  }

  const leader = ordered[0];
  const fieldComplete = ordered.length > 0
    && ordered.every((rider) => rider.finishedAt != null);
  if (positionsEstablished && leader && !fieldComplete) {
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

  const newlyFinishedRiders = ordered.filter((rider) => (
    rider.finishedAt != null && !tracker.finishedPlayerIds.has(rider.playerId)
  ));
  newlyFinishedRiders.forEach((newlyFinishedRider) => {
    const kind = tracker.finishedPlayerIds.size === 0 ? 'finish' : 'rider-finish';
    tracker.finishedPlayerIds.add(newlyFinishedRider.playerId);
    events.push(eventFor(tracker, snapshot, kind, now, {
      finishingPlayerId: newlyFinishedRider.playerId,
    }));
  });

  if (snapshot.raceState === 'racing' && positionsEstablished && !fieldComplete) {
    if (events.length > 0) {
      tracker.lastAnnouncerCallAt = now;
    } else if (
      tracker.lastAnnouncerCallAt > 0
      && now - tracker.lastAnnouncerCallAt >= continuousRaceCommentaryIntervalMs
    ) {
      events.push(eventFor(tracker, snapshot, 'race-update', now));
      tracker.lastAnnouncerCallAt = now;
    }
  }

  tracker.raceState = snapshot.raceState;
  const finishEvents = events.filter((event) => (
    event.kind === 'finish' || event.kind === 'rider-finish'
  ));
  return finishEvents.length > 0
    ? [
      ...finishEvents,
      ...events.filter((event) => !finishEvents.includes(event)),
    ].slice(0, 4)
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
  const leftTokens = lineTokens(leftLine);
  const rightTokens = lineTokens(rightLine);
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      shared += 1;
    }
  });
  const tokenScore = shared / (left.size + right.size - shared);
  const bigrams = (tokens: string[]) => (
    tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`)
  );
  const leftBigrams = new Set(bigrams(leftTokens));
  const rightBigrams = new Set(bigrams(rightTokens));
  let sharedBigrams = 0;
  leftBigrams.forEach((bigram) => {
    if (rightBigrams.has(bigram)) {
      sharedBigrams += 1;
    }
  });
  const bigramScore = leftBigrams.size > 0 && rightBigrams.size > 0
    ? sharedBigrams / (leftBigrams.size + rightBigrams.size - sharedBigrams)
    : 0;
  const openingScore = leftTokens.slice(0, 3).join(' ') === rightTokens.slice(0, 3).join(' ')
    ? 0.9
    : leftTokens.slice(0, 2).join(' ') === rightTokens.slice(0, 2).join(' ')
      ? 0.72
      : leftTokens[0] === rightTokens[0]
        ? 0.42
        : 0;
  return Math.max(openingScore, tokenScore * 0.82, bigramScore);
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
  const memoryLines = [...recentLines, ...raceLines];
  const ranked = [...new Set(candidates.filter(Boolean))]
    .map((candidate) => ({
      candidate,
      repeatsRaceSection: lineRepeatsRecentRaceSection(candidate, raceLines),
      similarity: memoryLines.reduce(
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
  const seed = stableCommentaryHash([
    event.id,
    event.sequence,
    recentLines.length,
    recentLines.at(-1) ?? '',
    raceLines.at(-1) ?? '',
  ].join('|'));
  return pool[seed % pool.length] ?? ranked[0]?.candidate ?? '';
}

function stableCommentaryHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function commentaryChoice<T>(
  values: readonly T[],
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
  variant: number,
  salt: string,
) {
  const seed = stableCommentaryHash([
    event.id,
    event.sequence,
    event.kind,
    recentLines.length,
    recentLines.at(-1) ?? '',
    raceLines.at(-1) ?? '',
    variant,
    salt,
  ].join('|'));
  return values[seed % values.length];
}

function lineMentionsLocalRider(line: string, rider: RaceCommentaryRiderFact) {
  const lineWords = new Set(lineTokens(line));
  const nameForms = commentaryRiderNameForms(rider.name);
  const legalFirstName = commentaryRiderNameParts(rider.name).legalName.split(/\s+/)[0];
  const aliases = [
    ...nameForms,
    legalFirstName,
  ].map(lineTokens);
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
  const frontRiders = riders.filter((rider) => rider.rank <= 2);
  const trailingRiders = riders.filter((rider) => rider.rank >= 3);
  const mentionCounts = new Map(riders.map((rider) => [
    rider.playerId,
    raceLines.reduce(
      (count, line) => count + (lineMentionsLocalRider(line, rider) ? 1 : 0),
      0,
    ),
  ]));
  const trailingFocus = [...trailingRiders].sort((left, right) => (
    (mentionCounts.get(left.playerId) ?? 0) - (mentionCounts.get(right.playerId) ?? 0)
    || left.rank - right.rank
  ))[0];
  return [...new Map(
    [...frontRiders, trailingFocus]
      .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
      .map((rider) => [rider.playerId, rider]),
  ).values()].slice(0, limit);
}

function closeBattleRiders(
  event: RaceCommentaryEvent,
  raceLines: string[],
) {
  const mentionCounts = new Map(event.riders.map((rider) => [
    rider.playerId,
    raceLines.reduce(
      (count, line) => count + (lineMentionsLocalRider(line, rider) ? 1 : 0),
      0,
    ),
  ]));
  const battle = [...event.closeBattles].sort((left, right) => {
    const leftMentions = (mentionCounts.get(left.frontPlayerId) ?? 0)
      + (mentionCounts.get(left.behindPlayerId) ?? 0);
    const rightMentions = (mentionCounts.get(right.frontPlayerId) ?? 0)
      + (mentionCounts.get(right.behindPlayerId) ?? 0);
    return left.gapMeters - right.gapMeters
      || left.position - right.position
      || leftMentions - rightMentions;
  })[0];
  if (!battle) {
    return [];
  }
  return [battle.frontPlayerId, battle.behindPlayerId]
    .map((playerId) => event.riders.find((rider) => rider.playerId === playerId))
    .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider));
}

function requiredLocalCommentaryRiders(
  event: RaceCommentaryEvent,
  raceLines: string[],
) {
  const focusRiders = selectLocalCommentaryFocusRiders(event, raceLines, 3);
  const battleRiders = closeBattleRiders(event, raceLines);
  const leader = event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    ?? event.riders[0];
  if (event.kind === 'race-start') return [];
  if (event.kind === 'positions-established') {
    return [...event.riders].sort((left, right) => left.rank - right.rank);
  }
  if (event.kind === 'finish' || event.kind === 'rider-finish') {
    const finisher = event.riders.find(
      (rider) => rider.playerId === event.finishingPlayerId,
    );
    return finisher ? [finisher] : leader ? [leader] : [];
  }
  if (event.kind === 'lead-change') {
    const previousLeader = event.riders.find(
      (rider) => rider.playerId === event.previousLeaderPlayerId,
    );
    return [...new Map(
      [leader, previousLeader, ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 3);
  }
  if (event.kind === 'position-change') {
    const passingRider = event.riders.find(
      (rider) => rider.playerId === event.passingPlayerId,
    );
    const passedRider = event.riders.find(
      (rider) => rider.playerId === event.passedPlayerId,
    );
    return [...new Map(
      [passingRider, passedRider, leader, ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 3);
  }
  if (event.kind === 'pro-set' || event.kind === 'final-push') {
    return [...new Map(
      [leader, ...event.riders.filter((rider) => rider.rank === 2), ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 3);
  }
  return [...new Map(
    [leader, ...battleRiders, ...focusRiders]
      .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
      .map((rider) => [rider.playerId, rider]),
  ).values()].slice(0, 3);
}

function localPositionClause(rider: RaceCommentaryRiderFact) {
  if (rider.rank === 1) return `${rider.name} leads`;
  if (rider.rank === 2) return `${rider.name} runs second`;
  if (rider.rank === 3) return `${rider.name} holds third`;
  return `${rider.name} is fourth`;
}

function localOrdinal(rank: number) {
  if (rank === 1) return 'the lead';
  if (rank === 2) return 'second';
  if (rank === 3) return 'third';
  return 'fourth';
}

function localFieldResultLine(riders: RaceCommentaryRiderFact[]) {
  const clauses = [...riders]
    .sort((left, right) => left.rank - right.rank)
    .map((rider) => {
      if (rider.rank === 1) return `${rider.name} wins`;
      if (rider.rank === 2) return `${rider.name} takes second`;
      if (rider.rank === 3) return `${rider.name} takes third`;
      return `${rider.name} takes fourth`;
    });
  const result = clauses.length <= 1
    ? clauses[0] ?? 'the field is complete'
    : `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}`;
  return `The field is home—${result}.`;
}

function withRequiredRiderCoverage(
  line: string,
  requiredRiders: RaceCommentaryRiderFact[],
) {
  const missingRiders = requiredRiders.filter((rider) => (
    !lineMentionsLocalRider(line, rider)
  ));
  if (missingRiders.length === 0) {
    return line;
  }
  const clauses = missingRiders.map(localPositionClause);
  return `${line} ${clauses.join(' while ')}.`;
}

const leadHeadlines = [
  'New leader',
  'The order flips',
  'Out front now',
  'That changes the race',
  'The front changes hands',
  'There is the move',
  'The pressure breaks through',
  'A decisive pass',
  'The race turns',
  'The challenge lands',
  'A new name at the front',
  'The lead is gone',
] as const;

const leadActions = [
  'takes charge',
  'takes command',
  'seizes the lead',
  'takes over out front',
  'moves into the lead',
  'claims the front',
  'hits the front',
  'takes control',
  'goes to the lead',
  'comes through for the lead',
  'finds the front',
  'powers into the lead',
] as const;

const chaseActions = [
  'drops into the two spot',
  'gives chase from second',
  'responds from second',
  'stays in the hunt',
  'slots into second',
  'keeps the leader honest',
  'holds the two spot',
  'comes back in the chase',
  'regroups in second',
  'remains right in this race',
] as const;

const rearBattleActions = [
  'fight side-by-side for third',
  'run bar-to-bar for third',
  'are locked in a fight for third',
  'have nothing between them for third',
  'keep the third-place battle alive',
  'scrap for third',
  'are wheel-to-wheel for third',
  'trade pressure for third',
  'stay locked together for third',
  'duel for third',
] as const;

const rearBattleLinks = [
  'behind them',
  'further back',
  'and look at the battle behind',
  'with the chase still unsettled',
  'while the pack stays busy',
  'and the fight behind is alive',
  'with no peace in the chase',
  'while third remains up for grabs',
  'and there is more action behind',
  'with the rear battle still raging',
  'while nobody behind is giving an inch',
  'and the order is far from settled',
] as const;

// A single four-rider lead-change call can take more than 170,000 valid
// sentence paths before rider names, track phase, or optional wit are varied.
export const localCommentaryCombinationCount = (
  leadHeadlines.length
  * leadActions.length
  * chaseActions.length
  * rearBattleActions.length
  * rearBattleLinks.length
);

const startOpeningFragments = [
  `Gate's down at`,
  `They're racing at`,
  'Race on at',
  'Here we go at',
  'The field is away at',
  'The gate releases them at',
  'A clean break gets this moving at',
  'Four riders charge away at',
  'The track comes alive at',
  'The opening battle is underway at',
] as const;

const startActions = [
  'the whole field launches',
  'the riders explode away together',
  'the pack powers into motion',
  'the opening sprint is on',
  'every rider snaps into the race',
  'the field drives hard off the hill',
  'every lane comes alive',
  'the first charge begins',
  'they break together and the race is alive',
  'the battle starts immediately',
] as const;

export function localRaceStartLine(
  trackName: string,
  riderNames: string[],
  recentLines: string[] = [],
) {
  const seed = stableCommentaryHash([
    trackName,
    riderNames.join('|'),
    recentLines.length,
    recentLines.at(-1) ?? '',
  ].join('|'));
  const spokenRiderNames = riderNames.map((name, index) => (
    selectCommentaryRiderName(name, ((seed + index * 263) % 1000) / 1000)
  ));
  const fieldNames = spokenRiderNames.length > 1
    ? `${spokenRiderNames.slice(0, -1).join(', ')} and ${spokenRiderNames.at(-1)}`
    : spokenRiderNames[0] ?? '';
  const soloActions = spokenRiderNames[0]
    ? [
      `${spokenRiderNames[0]} launches`,
      `${spokenRiderNames[0]} drives into the opening sprint`,
      `${spokenRiderNames[0]} is underway`,
      `${spokenRiderNames[0]} powers into the race`,
    ]
    : ['the race is underway', 'the opening sprint begins', 'here we go'];
  const namedFieldActions = [
    `${fieldNames} launch together`,
    `${fieldNames} explode away from the gate`,
    `${fieldNames} power into the opening sprint`,
    `${fieldNames} are racing`,
  ];
  const actions = spokenRiderNames.length > 1 ? namedFieldActions : soloActions;
  const candidates = Array.from({ length: 24 }, (_, index) => (
    `${startOpeningFragments[(seed + index * 17) % startOpeningFragments.length]} ${trackName}—${actions[(seed + index * 29) % actions.length]}!`
  ));
  const novel = candidates.filter((candidate) => !recentLines.includes(candidate));
  const pool = novel.length > 0 ? novel : candidates;
  return pool[seed % pool.length];
}

const passActions = [
  'surges past',
  'finds a way by',
  'powers around',
  'comes through on',
  'gets the move done on',
  'edges ahead of',
  'sweeps by',
  'takes the position from',
  'threads through on',
  'wins the drag race against',
  'moves cleanly ahead of',
  'turns pressure into a pass on',
] as const;

const pressureActions = [
  'is all over',
  'keeps the pressure on',
  'runs wheel-to-wheel with',
  'stays right on the wheel of',
  'is locked together with',
  'refuses to let go of',
  'shadows every move from',
  'draws alongside',
  'keeps the gap pinned to',
  'stays within striking distance of',
  'has the line covered against',
  'keeps asking the question of',
] as const;

const controlActions = [
  'keeps the advantage',
  'controls the front',
  'holds the race together',
  'keeps the line tidy',
  'protects the lead',
  'dictates the pace up front',
  'stays composed in command',
  'keeps the chase behind',
  'owns the racing line',
  'holds firm at the head of the field',
] as const;

const winActions = [
  'gets the win',
  'takes it at the line',
  'brings it home',
  'claims the victory',
  'wins the run',
  'seals the result',
  'owns the stripe',
  'finishes the job',
  'holds on for victory',
  'takes the win at the stripe',
] as const;

const wryAsides = [
  'calm clearly stayed home',
  'nobody ordered a quiet race',
  'simple has left the building',
  'the quiet option is officially gone',
  'apparently calm missed the gate',
] as const;

const phasePhrases: Record<RaceCommentaryCoursePhase, readonly string[]> = {
  'first-straight': [
    'down the first straight',
    'on the opening straight',
    'through the opening drive',
    'away from the gate',
    'in the first charge',
    'with the opening sprint unfolding',
    'as the field leaves the hill',
  ],
  'turn-one': [
    'into turn one',
    'around the first turn',
    'through turn one',
    'at the first corner',
    'as the first berm tightens',
    'with the inside line in play',
    'through the opening bend',
  ],
  'second-straight': [
    'down the second straight',
    'through straight two',
    'on the second straight',
    'as the race stretches into straight two',
    'with the chase driving forward',
    'across the next set of obstacles',
    'on the run away from turn one',
  ],
  'rhythm-section': [
    'through the rhythm section',
    'across the rhythm',
    'in the rhythm section',
    'through the rollers',
    'as the rhythm opens up',
    'with timing deciding the line',
    'across the technical middle of the track',
  ],
  'final-turn': [
    'into the final turn',
    'around the last corner',
    'through the final turn',
    'at the last berm',
    'with one corner left',
    'as the field swings for home',
    'through the closing bend',
  ],
  'last-straight': [
    'down the last straight',
    'on the run to the stripe',
    'through the final straight',
    'with the finish coming fast',
    'on the charge for home',
    'as the stripe fills the view',
    'in the final drag race',
  ],
};

function withOptionalWit(
  line: string,
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
  variant: number,
) {
  if (event.kind === 'finish' || event.kind === 'rider-finish' || event.sequence % 5 !== 0) {
    return line;
  }
  const aside = commentaryChoice(
    wryAsides,
    event,
    recentLines,
    raceLines,
    variant,
    'wry',
  );
  return `${line.replace(/[.!]$/, '')}—${aside}.`;
}

function runningOrderLine(
  riders: RaceCommentaryRiderFact[],
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
  variant: number,
) {
  const [first, second, third, fourth] = riders;
  if (!first) {
    return `The field is underway at ${event.trackName}.`;
  }
  const lead = commentaryChoice(
    ['shows out front', 'has the early advantage', 'leads the charge', 'holds the front'],
    event,
    recentLines,
    raceLines,
    variant,
    'order-lead',
  );
  const secondPhrase = second
    ? commentaryChoice(
      ['is in the two spot', 'runs second', 'gives chase', 'stays close in second'],
      event,
      recentLines,
      raceLines,
      variant,
      'order-second',
    )
    : '';
  const thirdPhrase = third
    ? commentaryChoice(
      ['holds third', 'runs in three', 'occupies the three spot', 'keeps third'],
      event,
      recentLines,
      raceLines,
      variant,
      'order-third',
    )
    : '';
  const fourthPhrase = fourth
    ? commentaryChoice(
      ['runs fourth', 'stays involved in fourth', 'keeps fighting from fourth', 'completes the order'],
      event,
      recentLines,
      raceLines,
      variant,
      'order-fourth',
    )
    : '';
  const clauses = [
    `${first.name} ${lead}`,
    second ? `${second.name} ${secondPhrase}` : '',
    third ? `${third.name} ${thirdPhrase}` : '',
    fourth ? `${fourth.name} ${fourthPhrase}` : '',
  ].filter(Boolean);
  return `${clauses.slice(0, -1).join('; ')}${clauses.length > 1 ? '; and ' : ''}${clauses.at(-1)}.`;
}

function localCommentaryCandidates(
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
) {
  const nameSeed = stableCommentaryHash([
    event.id,
    event.sequence,
    recentLines.length,
    raceLines.length,
    'rider-name',
  ].join('|'));
  event = {
    ...event,
    riders: event.riders.map((rider, index) => ({
      ...rider,
      name: selectCommentaryRiderName(
        rider.name,
        ((nameSeed + index * 263) % 1000) / 1000,
      ),
    })),
  };
  const leader = event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    ?? event.riders[0];
  const second = event.riders[1];
  const passing = event.riders.find((rider) => rider.playerId === event.passingPlayerId);
  const passed = event.riders.find((rider) => rider.playerId === event.passedPlayerId);
  const finisher = event.riders.find((rider) => rider.playerId === event.finishingPlayerId);
  const required = requiredLocalCommentaryRiders(event, raceLines);
  const requiredPlayerIds = new Set(required.map((rider) => rider.playerId));
  const focusedBattle = [...event.closeBattles]
    .sort((left, right) => left.gapMeters - right.gapMeters)
    .find((battle) => (
      requiredPlayerIds.has(battle.frontPlayerId)
      && requiredPlayerIds.has(battle.behindPlayerId)
    ));
  const focusedBattleFront = focusedBattle
    ? event.riders.find((rider) => rider.playerId === focusedBattle.frontPlayerId)
    : undefined;
  const focusedBattleChaser = focusedBattle
    ? event.riders.find((rider) => rider.playerId === focusedBattle.behindPlayerId)
    : undefined;
  const phaseOptions = phasePhrases[event.coursePhase];

  return Array.from({ length: 72 }, (_, variant) => {
    const phase = commentaryChoice(
      phaseOptions,
      event,
      recentLines,
      raceLines,
      variant,
      'phase',
    );
    let line: string;

    if (event.kind === 'race-start') {
      const opening = commentaryChoice(
        startOpeningFragments,
        event,
        recentLines,
        raceLines,
        variant,
        'start-opening',
      );
      const launch = commentaryChoice(
        startActions,
        event,
        recentLines,
        raceLines,
        variant,
        'start-launch',
      );
      line = `${opening} ${event.trackName}—${launch}!`;
    } else if (event.kind === 'positions-established') {
      line = runningOrderLine(event.riders, event, recentLines, raceLines, variant);
    } else if (event.kind === 'lead-change' && leader && second) {
      const headline = commentaryChoice(
        leadHeadlines,
        event,
        recentLines,
        raceLines,
        variant,
        'lead-headline',
      );
      const leadAction = commentaryChoice(
        leadActions,
        event,
        recentLines,
        raceLines,
        variant,
        'lead-action',
      );
      const chaseAction = commentaryChoice(
        chaseActions,
        event,
        recentLines,
        raceLines,
        variant,
        'chase-action',
      );
      const third = required.find((rider) => rider.rank === 3);
      const fourth = required.find((rider) => rider.rank === 4);
      const rearBattle = third && fourth
        ? `; ${commentaryChoice(rearBattleLinks, event, recentLines, raceLines, variant, 'rear-link')}, ${third.name} and ${fourth.name} ${commentaryChoice(rearBattleActions, event, recentLines, raceLines, variant, 'rear-action')}`
        : '';
      line = `${headline}—${leader.name} ${leadAction}! ${second.name} ${chaseAction}${rearBattle}.`;
    } else if (event.kind === 'position-change' && passing && passed) {
      const hook = commentaryChoice(
        ['There is the move', 'The pressure pays off', 'The order changes', 'Here comes the challenge'],
        event,
        recentLines,
        raceLines,
        variant,
        'pass-hook',
      );
      const action = commentaryChoice(
        passActions,
        event,
        recentLines,
        raceLines,
        variant,
        'pass-action',
      );
      const extraRiders = required.filter((rider) => (
        rider.playerId !== passing.playerId && rider.playerId !== passed.playerId
      ));
      const extra = extraRiders.length >= 2
        ? `; ${extraRiders[0].name} and ${extraRiders[1].name} stay wheel-to-wheel elsewhere`
        : extraRiders[0]
          ? `; ${extraRiders[0].name} remains in the fight`
          : '';
      line = `${hook} ${phase}—${passing.name} ${action} ${passed.name} for ${localOrdinal(passing.rank)}${extra}!`;
    } else if (event.kind === 'rider-finish' && finisher) {
      if (event.riders.length > 0 && event.riders.every((rider) => rider.finished)) {
        line = localFieldResultLine(event.riders);
      } else {
        const placement = localOrdinal(finisher.rank);
        const placementAction = commentaryChoice(
          ['finishes', 'secures', 'crosses in', 'locks down'],
          event,
          recentLines,
          raceLines,
          variant,
          'placement-finish',
        );
        line = `${finisher.name} ${placementAction} ${placement} at the stripe!`;
      }
    } else if (event.kind === 'finish' && (finisher ?? leader)) {
      const winner = finisher ?? leader!;
      const finishHook = commentaryChoice(
        ['At the stripe', 'Across the line', 'That settles it', 'The win is decided', 'The result is in'],
        event,
        recentLines,
        raceLines,
        variant,
        'finish-hook',
      );
      line = `${finishHook}—${winner.name} ${commentaryChoice(winActions, event, recentLines, raceLines, variant, 'finish-action')} at ${event.trackName}!`;
    } else if (event.kind === 'pro-set' && leader) {
      const action = commentaryChoice(
        ['commits to the Pro Set', 'takes the blue Pro line', 'goes Pro through the split', 'works the blue line'],
        event,
        recentLines,
        raceLines,
        variant,
        'pro-action',
      );
      line = `${leader.name} ${action}${second ? `; ${second.name} ${commentaryChoice(chaseActions, event, recentLines, raceLines, variant, 'pro-chase')}` : ''}.`;
    } else if (event.kind === 'final-push' && leader) {
      const finalHook = commentaryChoice(
        ['Final charge', 'The stripe is coming', 'The race turns for home', 'Everything to the line'],
        event,
        recentLines,
        raceLines,
        variant,
        'final-hook',
      );
      line = `${finalHook}—${leader.name} ${commentaryChoice(controlActions, event, recentLines, raceLines, variant, 'final-lead')}${second ? `, but ${second.name} ${commentaryChoice(chaseActions, event, recentLines, raceLines, variant, 'final-chase')}` : ''}!`;
    } else if (focusedBattleFront && focusedBattleChaser) {
      if (
        leader
        && focusedBattleFront.rank === 3
        && focusedBattleChaser.rank === 4
      ) {
        line = `${phase}, ${leader.name} ${commentaryChoice(controlActions, event, recentLines, raceLines, variant, 'rear-lead')}; ${commentaryChoice(rearBattleLinks, event, recentLines, raceLines, variant, 'rear-link')}, ${focusedBattleFront.name} and ${focusedBattleChaser.name} ${commentaryChoice(rearBattleActions, event, recentLines, raceLines, variant, 'rear-action')}.`;
      } else {
        const action = commentaryChoice(
          pressureActions,
          event,
          recentLines,
          raceLines,
          variant,
          'focused-pressure-action',
        );
        line = `${phase}, ${focusedBattleChaser.name} ${action} ${focusedBattleFront.name} for ${localOrdinal(focusedBattleFront.rank)}!`;
      }
    } else if (leader && second && event.battleState !== 'clear-lead') {
      const action = commentaryChoice(
        pressureActions,
        event,
        recentLines,
        raceLines,
        variant,
        'pressure-action',
      );
      line = `${phase}, ${second.name} ${action} ${leader.name} for ${localOrdinal(leader.rank)}!`;
    } else if (leader) {
      const focus = required[0] ?? leader;
      const partner = required[1];
      line = `${phase}, ${localPositionClause(focus)}${partner ? ` while ${localPositionClause(partner)}` : ` and ${commentaryChoice(controlActions, event, recentLines, raceLines, variant, 'control')}`}.`;
    } else {
      line = `The field keeps the race alive ${phase}.`;
    }

    return withOptionalWit(
      withRequiredRiderCoverage(line, required),
      event,
      recentLines,
      raceLines,
      variant,
    );
  });
}

export function localCommentaryLine(
  event: RaceCommentaryEvent,
  recentLines: string[] = [],
  raceLines: string[] = [],
) {
  return pickLine(
    localCommentaryCandidates(event, recentLines, raceLines),
    event,
    recentLines,
    raceLines,
  );
}
