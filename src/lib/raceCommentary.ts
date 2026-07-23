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
  | 'position-change'
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
};

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
    return leftMentions - rightMentions
      || right.position - left.position
      || left.gapMeters - right.gapMeters;
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
  const focusRiders = selectLocalCommentaryFocusRiders(event, raceLines, 2);
  const battleRiders = closeBattleRiders(event, raceLines);
  const leader = event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    ?? event.riders[0];
  if (event.kind === 'race-start') return [];
  if (event.kind === 'finish') return leader ? [leader] : [];
  if (event.kind === 'lead-change') {
    const previousLeader = event.riders.find(
      (rider) => rider.playerId === event.previousLeaderPlayerId,
    );
    return [...new Map(
      [leader, previousLeader, ...battleRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 4);
  }
  if (event.kind === 'position-change') {
    const passingRider = event.riders.find(
      (rider) => rider.playerId === event.passingPlayerId,
    );
    const passedRider = event.riders.find(
      (rider) => rider.playerId === event.passedPlayerId,
    );
    return [...new Map(
      [passingRider, passedRider, ...battleRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 4);
  }
  if (event.kind === 'pro-set' || event.kind === 'final-push') {
    return [...new Map(
      [leader, ...battleRiders, ...focusRiders]
        .filter((rider): rider is RaceCommentaryRiderFact => Boolean(rider))
        .map((rider) => [rider.playerId, rider]),
    ).values()].slice(0, 3);
  }
  return battleRiders.length > 0 ? battleRiders : focusRiders;
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

function localCoverageLines(
  event: RaceCommentaryEvent,
  requiredRiders: RaceCommentaryRiderFact[],
) {
  const [first, second, third, fourth] = requiredRiders;
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
    if (third && fourth) {
      return [
        `${first.name} takes charge! ${second.name} drops to second, while ${third.name} and ${fourth.name} fight for third.`,
        `New leader—${first.name}! ${second.name} gives chase as ${third.name} and ${fourth.name} run wheel-to-wheel.`,
        `${first.name} blasts into the lead! ${second.name} is second; behind them, ${third.name} and ${fourth.name} are locked together.`,
        `Oh, what a pass—${first.name} takes command! ${second.name} chases while ${third.name} and ${fourth.name} scrap for third.`,
        `${first.name} seizes the lead from ${second.name}! ${third.name} and ${fourth.name} are still side-by-side behind them.`,
        `The order flips—${first.name} is out front! ${second.name} responds as ${third.name} and ${fourth.name} duel for third.`,
      ];
    }
    return applyWryAside([
      `What a move—${first.name} takes over! ${secondClause} after the pass.`,
      `${first.name} storms to the front! ${second.name} is forced back to second.`,
      `New leader—${first.name} sweeps through! ${second.name} drops into the chase.`,
      `${first.name} takes charge with a brilliant pass! ${second.name} is now second.`,
      `There goes ${first.name}, straight into the lead! ${second.name} has to respond.`,
    ]);
  }
  if (event.kind === 'position-change') {
    return [
      `${first.name} surges past ${second.name} into ${localOrdinal(first.rank)}!`,
      `There’s the move—${first.name} takes ${localOrdinal(first.rank)} from ${second.name}!`,
      `${first.name} gets it done and moves ahead of ${second.name}!`,
      `What a pass from ${first.name}—${second.name} loses ${localOrdinal(first.rank)}!`,
      `${first.name} finds the opening and takes ${localOrdinal(first.rank)} from ${second.name}!`,
      `The pressure pays off—${first.name} powers ahead of ${second.name}!`,
    ];
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
  const closeBattle = event.closeBattles.some((battle) => (
    battle.frontPlayerId === first.playerId
    && battle.behindPlayerId === second.playerId
  ));
  if (closeBattle) {
    return applyWryAside([
      `${first.name} and ${second.name} are wheel-to-wheel for ${localOrdinal(first.rank)}!`,
      `Nothing between ${first.name} and ${second.name} in the fight for ${localOrdinal(first.rank)}.`,
      `${second.name} is all over ${first.name} in the battle for ${localOrdinal(first.rank)}.`,
      `${first.name} barely holds ${localOrdinal(first.rank)}—${second.name} is right alongside!`,
      `This battle is alive: ${first.name} and ${second.name}, side-by-side for ${localOrdinal(first.rank)}!`,
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
    'position-change': [
      `${riderName(event, event.passingPlayerId)} makes the pass and moves up!`,
      `${riderName(event, event.passingPlayerId)} finds a way through!`,
      `Position change—${riderName(event, event.passingPlayerId)} gets the move done!`,
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
