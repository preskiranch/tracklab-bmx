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
  'A clean release at',
  'The race comes alive at',
  'The gate releases them at',
] as const;

const startActions = [
  'the whole field launches',
  'the riders explode away together',
  'the pack powers into motion',
  'the opening sprint is on',
  'every rider snaps into the race',
  'the field surges away as one',
  'all lanes fire into action',
  'the opening battle starts now',
] as const;

export function localRaceStartLine(
  trackName: string,
  riderNames: string[],
  recentLines: string[] = [],
) {
  const soloActions = riderNames[0]
    ? [
      `${riderNames[0]} launches`,
      `${riderNames[0]} drives into the opening sprint`,
      `${riderNames[0]} is underway`,
      `${riderNames[0]} powers into the race`,
    ]
    : ['the race is underway', 'the opening sprint begins', 'here we go'];
  const actions = riderNames.length > 1 ? startActions : soloActions;
  const seed = stableCommentaryHash([
    trackName,
    riderNames.join('|'),
    recentLines.length,
    recentLines.at(-1) ?? '',
  ].join('|'));
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
  'breaks the pressure of',
  'moves cleanly past',
  'takes the spot from',
  'wins the position from',
  'forces the order to change on',
  'turns pressure into a pass on',
] as const;

const pressureActions = [
  'is all over',
  'keeps the pressure on',
  'runs wheel-to-wheel with',
  'stays right on the wheel of',
  'is locked together with',
  'keeps contact with',
  'refuses to let go of',
  'continues the chase of',
  'leaves no breathing room for',
  'keeps the battle alive with',
] as const;

const controlActions = [
  'keeps the advantage',
  'controls the front',
  'holds the race together',
  'keeps the line tidy',
  'stays composed out front',
  'carries the lead',
  'keeps the chase behind',
  'maintains the early edge',
] as const;

const winActions = [
  'gets the win',
  'takes it at the line',
  'brings it home',
  'claims the victory',
  'wins the run',
  'holds on for the win',
  'takes the race',
  'gets it done',
] as const;

const wryAsides = [
  'calm clearly stayed home',
  'nobody ordered a quiet race',
  'simple has left the building',
  'the quiet option is officially gone',
  'apparently calm missed the gate',
  'nobody is making this simple',
  'so much for a quiet lap',
  'the easy route has been declined',
] as const;

const phasePhrases: Record<RaceCommentaryCoursePhase, readonly string[]> = {
  'first-straight': [
    'down the first straight',
    'on the opening straight',
    'through the opening drive',
    'away from the gate',
  ],
  'turn-one': [
    'into turn one',
    'around the first turn',
    'through turn one',
    'at the opening corner',
  ],
  'second-straight': [
    'down the second straight',
    'through straight two',
    'on the second straight',
    'out of the first turn',
  ],
  'rhythm-section': [
    'through the rhythm section',
    'across the rhythm',
    'in the rhythm section',
    'through the middle of the lap',
  ],
  'final-turn': [
    'into the final turn',
    'around the last corner',
    'through the final turn',
    'at the last corner',
  ],
  'last-straight': [
    'down the last straight',
    'on the run to the stripe',
    'through the final straight',
    'with the line coming fast',
  ],
};

function withOptionalWit(
  line: string,
  event: RaceCommentaryEvent,
  recentLines: string[],
  raceLines: string[],
  variant: number,
) {
  if (event.kind === 'finish' || event.sequence % 5 !== 0) {
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
    ['shows out front', 'has the early advantage', 'leads the charge', 'sets the pace', 'is the early leader', 'holds the front'],
    event,
    recentLines,
    raceLines,
    variant,
    'order-lead',
  );
  const secondPhrase = second
    ? commentaryChoice(
      ['is in the two spot', 'runs second', 'gives chase', 'holds second', 'is next in line', 'stays close in second'],
      event,
      recentLines,
      raceLines,
      variant,
      'order-second',
    )
    : '';
  const thirdPhrase = third
    ? commentaryChoice(
      ['holds third', 'runs in three', 'has third', 'is third in the order', 'occupies the three spot', 'keeps third'],
      event,
      recentLines,
      raceLines,
      variant,
      'order-third',
    )
    : '';
  const fourthPhrase = fourth
    ? commentaryChoice(
      ['runs fourth', 'is fourth', 'stays involved in fourth', 'holds the fourth spot', 'keeps fighting from fourth', 'completes the order'],
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
  const leader = event.riders.find((rider) => rider.playerId === event.leaderPlayerId)
    ?? event.riders[0];
  const second = event.riders[1];
  const passing = event.riders.find((rider) => rider.playerId === event.passingPlayerId);
  const passed = event.riders.find((rider) => rider.playerId === event.passedPlayerId);
  const required = requiredLocalCommentaryRiders(event, raceLines);
  const phaseOptions = phasePhrases[event.coursePhase];

  return Array.from({ length: 36 }, (_, variant) => {
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
        ['There is the move', 'Position change', 'The pressure pays off', 'That battle breaks open', 'The order changes', 'A pass develops', 'Here comes the challenge', 'The opening appears'],
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
    } else if (event.kind === 'finish' && leader) {
      const finishHook = commentaryChoice(
        ['At the stripe', 'Across the line', 'Race complete', 'That settles it', 'The win is decided', 'Home to the line', 'Checkered and complete', 'The result is in'],
        event,
        recentLines,
        raceLines,
        variant,
        'finish-hook',
      );
      line = `${finishHook}—${leader.name} ${commentaryChoice(winActions, event, recentLines, raceLines, variant, 'finish-action')} at ${event.trackName}!`;
    } else if (event.kind === 'pro-set' && leader) {
      const action = commentaryChoice(
        ['commits to the Pro Set', 'takes the blue Pro line', 'chooses the bigger line', 'takes the alternate route', 'goes Pro through the split', 'selects the Pro branch', 'works the blue line', 'takes on the Pro side'],
        event,
        recentLines,
        raceLines,
        variant,
        'pro-action',
      );
      line = `${leader.name} ${action}${second ? `; ${second.name} ${commentaryChoice(chaseActions, event, recentLines, raceLines, variant, 'pro-chase')}` : ''}.`;
    } else if (event.kind === 'final-push' && leader) {
      const finalHook = commentaryChoice(
        ['Final charge', 'One last drive', 'The stripe is coming', 'Last straight now', 'The race turns for home', 'Everything to the line', 'The finish is in sight', 'No time left to wait'],
        event,
        recentLines,
        raceLines,
        variant,
        'final-hook',
      );
      line = `${finalHook}—${leader.name} ${commentaryChoice(controlActions, event, recentLines, raceLines, variant, 'final-lead')}${second ? `, but ${second.name} ${commentaryChoice(chaseActions, event, recentLines, raceLines, variant, 'final-chase')}` : ''}!`;
    } else if (leader && second && event.battleState !== 'clear-lead') {
      const front = required[0] ?? leader;
      const chaser = required[1] ?? second;
      const action = commentaryChoice(
        pressureActions,
        event,
        recentLines,
        raceLines,
        variant,
        'pressure-action',
      );
      line = `${phase}, ${chaser.name} ${action} ${front.name} for ${localOrdinal(front.rank)}!`;
    } else if (leader) {
      const focus = required[0] ?? leader;
      const partner = required[1];
      line = `${phase}, ${localPositionClause(focus)}${partner ? ` while ${localPositionClause(partner)}` : ` and ${commentaryChoice(controlActions, event, recentLines, raceLines, variant, 'control')}`}.`;
    } else {
      line = `The field keeps the race alive ${phase}.`;
    }

    return withOptionalWit(line, event, recentLines, raceLines, variant);
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
