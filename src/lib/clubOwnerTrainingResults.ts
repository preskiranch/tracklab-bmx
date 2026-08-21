import type { PlayerSlot, TrainingActivityType } from '../types';
import type { TrainingSessionInput } from './trainingHistory';
import type {
  ClubOwnerTrainingAssignment,
  ClubOwnerTrainingAuthorization,
  ClubOwnerTrainingRiderWindow,
} from './clubOwnerTrainingHistory';

export type ClubOwnerTrainingActivityType = Exclude<TrainingActivityType, 'monitor-sprint'>;

export type ClubOwnerActiveClockSegment = Readonly<{
  startedAt: number;
  endedAt: number;
  activeElapsedAtStartMs: number;
}>;

export type ClubOwnerAssignedTrainingPayload = Readonly<{
  assignmentId: string;
  studioRiderId: string;
  bikeDeviceId: string;
  playerId: PlayerSlot['id'];
  riderWindow: ClubOwnerTrainingRiderWindow;
  /**
   * A one-rider preview of the canonical history shape. This is deliberately
   * not sent to the group completion endpoint; the server remains the sole
   * identity and persistence authority.
   */
  session: TrainingSessionInput;
}>;

export type ClubOwnerTrainingResultBuild = Readonly<{
  /** One sanitized shared result for the atomic server-side split. */
  session: TrainingSessionInput;
  riderWindows: readonly ClubOwnerTrainingRiderWindow[];
  /** One and only one scoped result per authorized rider/player assignment. */
  athletePayloads: readonly ClubOwnerAssignedTrainingPayload[];
}>;

export type BuildClubOwnerTrainingResultsOptions = Readonly<{
  /** Required for Explore. Keyed by the server-issued assignment ID. */
  exploreActiveClockSegmentsByAssignmentId?: Readonly<Record<string, readonly ClubOwnerActiveClockSegment[]>>;
  /**
   * Explicit stop clocks for riders who started but did not finish. Missing
   * assignments are treated as finished and must have their normal finish data.
   */
  dnfByAssignmentId?: Readonly<Record<string, Readonly<{ endedAt: number }>>>;
}>;

const supportedActivities = new Set<ClubOwnerTrainingActivityType>([
  'bmx-race',
  'straight-sprint',
  'get-pulled',
  'explore',
]);

const forbiddenNormalizedKeys = new Set([
  'profilekey',
  'cloudprofilekey',
  'clubtabletprofilekey',
  'ownerkey',
  'accountkey',
  'authkey',
  'userkey',
  'completiontoken',
  'savetoken',
  'pairingtoken',
  'bearertoken',
  'hr',
  'hrsamples',
  'hrsummary',
  'hrzones',
  'bpm',
  'healthkit',
  'applehealth',
]);

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isForbiddenKey(key: string) {
  const normalized = normalizedKey(key);
  return forbiddenNormalizedKeys.has(normalized)
    || normalized.includes('heart')
    || normalized.includes('bpm')
    || normalized.includes('pulse')
    || normalized.startsWith('hr')
    || normalized.includes('healthkit')
    || normalized.includes('applehealth')
    || normalized.includes('profile')
    || normalized.endsWith('token');
}

/** Refuse private HR, credentials, and account/profile routing keys at any depth. */
export function assertClubOwnerTrainingHasNoPrivateFields(value: unknown) {
  const visited = new Set<object>();
  const visit = (current: unknown, path: string, depth: number) => {
    if (depth > 24) throw new Error(`Club training data is nested too deeply at ${path}.`);
    if (!current || typeof current !== 'object') return;
    if (visited.has(current)) throw new Error(`Club training data contains a cycle at ${path}.`);
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    } else {
      Object.entries(current as Record<string, unknown>).forEach(([key, item]) => {
        if (isForbiddenKey(key)) {
          throw new Error(`Club training data cannot include private field "${key}".`);
        }
        visit(item, `${path}.${key}`, depth + 1);
      });
    }
    visited.delete(current);
  };
  visit(value, 'session', 0);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} must be a valid timestamp or count.`);
  return number;
}

function finiteNumber(value: unknown, label: string, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) throw new Error(`${label} must be a valid number.`);
  return number;
}

function optionalFiniteNumber(value: unknown, label: string, minimum = 0): number | null {
  return value == null ? null : finiteNumber(value, label, minimum);
}

function identifier(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/u.test(text)) {
    throw new Error(`${label} must be a valid identifier.`);
  }
  return text;
}

function playerId(value: unknown, label: string): PlayerSlot['id'] {
  const number = Number(value) as PlayerSlot['id'];
  if (![1, 2, 3, 4].includes(number)) throw new Error(`${label} must be Player 1 through Player 4.`);
  return number;
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function optionalIdentifier(value: unknown) {
  if (value == null || value === '') return undefined;
  return identifier(value, 'Training track');
}

function validateAssignments(
  authorization: Pick<ClubOwnerTrainingAuthorization, 'activityType' | 'assignments'>,
): readonly ClubOwnerTrainingAssignment[] {
  if (!supportedActivities.has(authorization.activityType)) {
    throw new Error('Club owner training supports BMX Race, Straight Sprint, Get Pulled, and Explore only.');
  }
  if (!Array.isArray(authorization.assignments)
    || authorization.assignments.length < 1
    || authorization.assignments.length > 4) {
    throw new Error('Choose between one and four club rider assignments.');
  }
  const assignmentIds = new Set<string>();
  const riderIds = new Set<string>();
  const bikeIds = new Set<string>();
  const playerIds = new Set<number>();
  authorization.assignments.forEach((assignment, index) => {
    const id = identifier(assignment.id, `Assignment ${index + 1}`);
    const rider = identifier(assignment.studioRiderId, `Assignment ${index + 1} rider`);
    const bike = String(assignment.bikeDeviceId).trim();
    const player = playerId(assignment.playerId, `Assignment ${index + 1} player`);
    if (!bike || !/^\d{1,16}$/u.test(bike)) throw new Error(`Assignment ${index + 1} Wattbike is invalid.`);
    if (assignmentIds.has(id) || riderIds.has(rider) || bikeIds.has(bike) || playerIds.has(player)) {
      throw new Error('Each club assignment must use a unique rider, Wattbike, player, and assignment.');
    }
    if (assignment.startedAt == null || assignment.activatedAt == null) {
      throw new Error(`Player ${player} was not activated at the first watt.`);
    }
    const startedAt = safeInteger(assignment.startedAt, `Player ${player} start`);
    const activatedAt = safeInteger(assignment.activatedAt, `Player ${player} activation`);
    if (activatedAt < startedAt) throw new Error(`Player ${player} activation is before its first watt.`);
    assignmentIds.add(id);
    riderIds.add(rider);
    bikeIds.add(bike);
    playerIds.add(player);
  });
  return authorization.assignments;
}

function sanitizeSessionShell(session: TrainingSessionInput, details: Record<string, unknown>): TrainingSessionInput {
  const id = identifier(session.id, 'Training session');
  const startedAt = safeInteger(session.startedAt, 'Training session start');
  const endedAt = safeInteger(session.endedAt, 'Training session end');
  if (endedAt < startedAt) throw new Error('Training session end cannot be before its start.');
  const activityType = session.activityType as ClubOwnerTrainingActivityType;
  if (!supportedActivities.has(activityType)) throw new Error('This activity cannot use club group history.');
  const trackId = optionalIdentifier(session.trackId);
  return {
    id,
    activityType,
    title: text(session.title, 'Club training session'),
    startedAt,
    endedAt,
    durationMs: safeInteger(session.durationMs, 'Training session duration'),
    distanceMeters: finiteNumber(session.distanceMeters, 'Training session distance'),
    ...(trackId ? { trackId } : {}),
    ...(typeof session.trackName === 'string' && session.trackName.trim()
      ? { trackName: session.trackName.trim().slice(0, 240) }
      : {}),
    source: 'live',
    details,
  };
}

function rowsByAuthorizedPlayer(
  rawRows: unknown,
  assignments: readonly ClubOwnerTrainingAssignment[],
  label: string,
) {
  const assigned = new Set(assignments.map((assignment) => assignment.playerId));
  const byPlayer = new Map<PlayerSlot['id'], Record<string, unknown>>();
  array(rawRows, label).forEach((raw, index) => {
    const row = object(raw, `${label} row ${index + 1}`);
    const player = playerId(row.playerId, `${label} row ${index + 1} player`);
    if (!assigned.has(player)) return;
    if (byPlayer.has(player)) throw new Error(`${label} contains duplicate Player ${player} rows.`);
    byPlayer.set(player, row);
  });
  assignments.forEach((assignment) => {
    if (!byPlayer.has(assignment.playerId)) {
      throw new Error(`${label} is missing Player ${assignment.playerId}.`);
    }
  });
  return byPlayer;
}

function sanitizeRaceSummary(row: Record<string, unknown>) {
  const player = playerId(row.playerId, 'Race summary player');
  const summary = {
    playerId: player,
    rank: safeInteger(row.rank, `Player ${player} rank`, 1),
    finishTimeMs: optionalFiniteNumber(row.finishTimeMs, `Player ${player} finish time`),
    thirtyFootTimeMs: optionalFiniteNumber(row.thirtyFootTimeMs, `Player ${player} 30-foot time`),
    distanceMeters: finiteNumber(row.distanceMeters, `Player ${player} distance`),
    sampleCount: safeInteger(row.sampleCount, `Player ${player} sample count`),
    topSpeedKph: optionalFiniteNumber(row.topSpeedKph, `Player ${player} top speed`),
    averageSpeedKph: optionalFiniteNumber(row.averageSpeedKph, `Player ${player} average speed`),
    topCadence: optionalFiniteNumber(row.topCadence, `Player ${player} top cadence`),
    averageCadence: optionalFiniteNumber(row.averageCadence, `Player ${player} average cadence`),
    topWatts: optionalFiniteNumber(row.topWatts, `Player ${player} top power`),
    averageWatts: optionalFiniteNumber(row.averageWatts, `Player ${player} average power`),
  };
  if (summary.rank > 4 || summary.sampleCount > 1_000_000) {
    throw new Error(`Player ${player} race rank or sample count is outside the four-bike result.`);
  }
  assertBoundedMetricPair(summary.averageSpeedKph, summary.topSpeedKph, 200, `Player ${player} speed`);
  assertBoundedMetricPair(summary.averageCadence, summary.topCadence, 320, `Player ${player} cadence`);
  assertBoundedMetricPair(summary.averageWatts, summary.topWatts, 5_000, `Player ${player} power`);
  return summary;
}

function assertBoundedMetricPair(
  average: number | null,
  peak: number | null,
  maximum: number,
  label: string,
) {
  if ((average ?? 0) > (peak ?? 0) || (peak ?? 0) > maximum) {
    throw new Error(`${label} metrics are outside the supported recording range.`);
  }
}

function sanitizeZoneRider(row: Record<string, unknown>) {
  const player = playerId(row.playerId, 'Zone rider');
  return {
    playerId: player,
    sampleCount: safeInteger(row.sampleCount, `Player ${player} zone sample count`),
    entryElapsedMs: optionalFiniteNumber(row.entryElapsedMs, `Player ${player} zone entry`),
    exitElapsedMs: optionalFiniteNumber(row.exitElapsedMs, `Player ${player} zone exit`),
    durationMs: optionalFiniteNumber(row.durationMs, `Player ${player} zone duration`),
    topSpeedKph: optionalFiniteNumber(row.topSpeedKph, `Player ${player} zone top speed`),
    averageSpeedKph: optionalFiniteNumber(row.averageSpeedKph, `Player ${player} zone average speed`),
    topCadence: optionalFiniteNumber(row.topCadence, `Player ${player} zone top cadence`),
    averageCadence: optionalFiniteNumber(row.averageCadence, `Player ${player} zone average cadence`),
    topWatts: optionalFiniteNumber(row.topWatts, `Player ${player} zone top power`),
    averageWatts: optionalFiniteNumber(row.averageWatts, `Player ${player} zone average power`),
  };
}

function sanitizeRaceZones(rawZones: unknown, assignments: readonly ClubOwnerTrainingAssignment[]) {
  const seenIds = new Set<string>();
  let previousStart = -1;
  return array(rawZones, 'Race zones').map((raw, zoneIndex) => {
    const zone = object(raw, `Race zone ${zoneIndex + 1}`);
    const zoneId = identifier(zone.zoneId, `Race zone ${zoneIndex + 1}`);
    if (seenIds.has(zoneId)) throw new Error(`Race zones contain duplicate zone ${zoneId}.`);
    const startMeter = finiteNumber(zone.startMeter, `Race zone ${zoneIndex + 1} start`);
    const endMeter = finiteNumber(zone.endMeter, `Race zone ${zoneIndex + 1} end`);
    if (endMeter < startMeter || startMeter < previousStart) {
      throw new Error('Race zones must stay in their recorded track order.');
    }
    previousStart = startMeter;
    seenIds.add(zoneId);
    const riders = rowsByAuthorizedPlayer(zone.riders, assignments, `Race zone ${zoneIndex + 1} riders`);
    return {
      zoneId,
      zoneName: text(zone.zoneName, `Zone ${zoneIndex + 1}`),
      zoneType: zone.zoneType === 'recovery' || zone.zoneType === 'technical' ? zone.zoneType : 'pedal',
      startMeter,
      endMeter,
      riders: assignments.map((assignment) => sanitizeZoneRider(riders.get(assignment.playerId)!)),
    };
  });
}

function sanitizeReactionTimes(raw: unknown, assignments: readonly ClubOwnerTrainingAssignment[]) {
  if (raw == null) return {};
  const source = object(raw, 'Reaction times');
  return Object.fromEntries(assignments.flatMap((assignment) => {
    const value = source[String(assignment.playerId)];
    return value == null
      ? []
      : [[String(assignment.playerId), finiteNumber(value, `Player ${assignment.playerId} reaction time`)]];
  }));
}

function sanitizeSelectedMetrics(raw: unknown) {
  if (raw == null) return [];
  const allowed = new Set(['cadence', 'speed', 'power', 'reaction']);
  return array(raw, 'Selected metrics').flatMap((metric) => (
    typeof metric === 'string' && allowed.has(metric) ? [metric] : []
  ));
}

function copyOptionalRaceConfiguration(source: Record<string, unknown>) {
  return {
    ...(source.lapCount != null ? { lapCount: safeInteger(source.lapCount, 'Lap count', 1) } : {}),
    ...(source.routeVariantId != null
      ? { routeVariantId: identifier(source.routeVariantId, 'Route variant') }
      : {}),
    ...(source.sprintDistanceFeet != null
      ? { sprintDistanceFeet: finiteNumber(source.sprintDistanceFeet, 'Sprint distance', 1) }
      : {}),
    ...(source.sprintAirSetting != null
      ? { sprintAirSetting: safeInteger(source.sprintAirSetting, 'Sprint air setting') }
      : {}),
  };
}

function validateDnfAssignmentKeys(
  assignments: readonly ClubOwnerTrainingAssignment[],
  options: BuildClubOwnerTrainingResultsOptions,
) {
  const dnfByAssignment = options.dnfByAssignmentId;
  if (!dnfByAssignment) return;
  const known = new Set(assignments.map((assignment) => assignment.id));
  Object.keys(dnfByAssignment).forEach((assignmentId) => {
    if (!known.has(assignmentId)) throw new Error('Club DNF clocks include an unauthorized assignment.');
  });
}

function dnfEndedAt(
  assignment: ClubOwnerTrainingAssignment,
  options: BuildClubOwnerTrainingResultsOptions,
  sessionEndedAt: number,
) {
  const outcome = options.dnfByAssignmentId?.[assignment.id];
  if (!outcome) return null;
  const endedAt = safeInteger(outcome.endedAt, `Player ${assignment.playerId} DNF clock`);
  if (assignment.startedAt == null || endedAt <= assignment.startedAt) {
    throw new Error(`Player ${assignment.playerId} DNF must occur after first-watt activation.`);
  }
  if (endedAt > sessionEndedAt) throw new Error(`Player ${assignment.playerId} DNF ends after the shared session.`);
  return endedAt;
}

function dnfScopedZones(
  zones: ReturnType<typeof sanitizeRaceZones>,
  riderIndex: number,
  activeDurationMs: number,
  player: PlayerSlot['id'],
) {
  let previousExitElapsedMs = 0;
  return zones.flatMap((zone) => {
    const rider = zone.riders[riderIndex];
    if (rider.entryElapsedMs == null) return [];
    if (rider.entryElapsedMs < previousExitElapsedMs || rider.entryElapsedMs > activeDurationMs) {
      throw new Error(`Player ${player} has a zone entry after the DNF clock.`);
    }
    const exitElapsedMs = rider.exitElapsedMs ?? activeDurationMs;
    const durationMs = rider.durationMs ?? exitElapsedMs - rider.entryElapsedMs;
    if (
      exitElapsedMs < rider.entryElapsedMs
      || exitElapsedMs > activeDurationMs
      || durationMs !== exitElapsedMs - rider.entryElapsedMs
    ) {
      throw new Error(`Player ${player} has an invalid zone exit or duration after the DNF clock.`);
    }
    previousExitElapsedMs = exitElapsedMs;
    return [{ ...zone, riders: [{ ...rider, exitElapsedMs, durationMs }] }];
  });
}

function raceBuild(
  session: TrainingSessionInput,
  assignments: readonly ClubOwnerTrainingAssignment[],
  options: BuildClubOwnerTrainingResultsOptions,
): ClubOwnerTrainingResultBuild {
  const rawDetails = object(session.details, 'Race details');
  const summariesByPlayer = rowsByAuthorizedPlayer(rawDetails.summaries, assignments, 'Race summaries');
  const summaries = assignments.map((assignment) => sanitizeRaceSummary(summariesByPlayer.get(assignment.playerId)!));
  const zones = sanitizeRaceZones(rawDetails.zoneResults ?? [], assignments);
  const reactions = sanitizeReactionTimes(rawDetails.reactionTimesByPlayer, assignments);
  const baseDetails = {
    summaries,
    zoneResults: zones,
    reactionTimesByPlayer: reactions,
    selectedMetrics: sanitizeSelectedMetrics(rawDetails.selectedMetrics),
    ...copyOptionalRaceConfiguration(rawDetails),
  };
  const sharedSession = sanitizeSessionShell(session, baseDetails);
  const athletePayloads = assignments.map((assignment, index) => {
    const summary = summaries[index];
    const startedAt = assignment.startedAt!;
    const stoppedAt = dnfEndedAt(assignment, options, sharedSession.endedAt);
    if (summary.finishTimeMs == null && stoppedAt == null) {
      throw new Error(`Player ${assignment.playerId} has no finish or DNF clock.`);
    }
    if (summary.finishTimeMs != null && stoppedAt != null) {
      throw new Error(`Player ${assignment.playerId} cannot be both finished and DNF.`);
    }
    const resultStatus = stoppedAt == null ? 'finished' as const : 'dnf' as const;
    const durationMs = stoppedAt == null
      ? safeInteger(summary.finishTimeMs, `Player ${assignment.playerId} finish clock`)
      : stoppedAt - startedAt;
    const endedAt = stoppedAt ?? startedAt + durationMs;
    if (!Number.isSafeInteger(endedAt)) throw new Error(`Player ${assignment.playerId} finish clock is invalid.`);
    if (resultStatus === 'finished' && durationMs <= 0) {
      throw new Error(`Player ${assignment.playerId} finish clock must be after first watt.`);
    }
    if (resultStatus === 'dnf' && summary.distanceMeters > sharedSession.distanceMeters) {
      throw new Error(`Player ${assignment.playerId} DNF distance exceeds the shared result.`);
    }
    const riderWindow: ClubOwnerTrainingRiderWindow = {
      assignmentId: assignment.id,
      status: resultStatus,
      endedAt,
    };
    const scopedZones = resultStatus === 'dnf'
      ? dnfScopedZones(zones, index, durationMs, assignment.playerId)
      : zones.map((zone) => ({ ...zone, riders: [zone.riders[index]] }));
    const scopedSummary = { ...summary, resultStatus };
    return {
      assignmentId: assignment.id,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: assignment.bikeDeviceId,
      playerId: assignment.playerId,
      riderWindow,
      session: sanitizeSessionShell({
        ...sharedSession,
        startedAt,
        endedAt,
        durationMs,
        distanceMeters: summary.distanceMeters,
      }, {
        ...baseDetails,
        summaries: [scopedSummary],
        zoneResults: scopedZones,
        reactionTimesByPlayer: Object.prototype.hasOwnProperty.call(reactions, String(assignment.playerId))
          ? { [String(assignment.playerId)]: reactions[String(assignment.playerId)] }
          : {},
      }),
    } satisfies ClubOwnerAssignedTrainingPayload;
  });
  return {
    session: sharedSession,
    riderWindows: athletePayloads.map((payload) => payload.riderWindow),
    athletePayloads,
  };
}

function sanitizeGetPulledRider(row: Record<string, unknown>) {
  const player = playerId(row.playerId, 'Get Pulled rider');
  const rider = {
    playerId: player,
    distanceMeters: finiteNumber(row.distanceMeters, `Player ${player} distance`),
    averageWatts: finiteNumber(row.averageWatts, `Player ${player} average power`),
    peakWatts: finiteNumber(row.peakWatts, `Player ${player} peak power`),
    averageCadence: finiteNumber(row.averageCadence, `Player ${player} average cadence`),
    peakCadence: finiteNumber(row.peakCadence, `Player ${player} peak cadence`),
    averageSpeedKph: finiteNumber(row.averageSpeedKph, `Player ${player} average speed`),
    peakSpeedKph: finiteNumber(row.peakSpeedKph, `Player ${player} peak speed`),
  };
  assertBoundedMetricPair(rider.averageSpeedKph, rider.peakSpeedKph, 160, `Player ${player} speed`);
  assertBoundedMetricPair(rider.averageCadence, rider.peakCadence, 320, `Player ${player} cadence`);
  assertBoundedMetricPair(rider.averageWatts, rider.peakWatts, 5_000, `Player ${player} power`);
  return rider;
}

function getPulledBuild(
  session: TrainingSessionInput,
  assignments: readonly ClubOwnerTrainingAssignment[],
  options: BuildClubOwnerTrainingResultsOptions,
): ClubOwnerTrainingResultBuild {
  const rawDetails = object(session.details, 'Get Pulled details');
  const durationSeconds = finiteNumber(rawDetails.durationSeconds, 'Get Pulled duration', 1);
  const durationMs = durationSeconds * 1_000;
  if (!Number.isSafeInteger(durationMs)) throw new Error('Get Pulled duration must resolve to whole milliseconds.');
  const ridersByPlayer = rowsByAuthorizedPlayer(rawDetails.riders, assignments, 'Get Pulled riders');
  const riders = assignments.map((assignment) => sanitizeGetPulledRider(ridersByPlayer.get(assignment.playerId)!));
  const details = {
    durationSeconds,
    airSetting: safeInteger(rawDetails.airSetting, 'Get Pulled air setting'),
    riders,
  };
  const sharedSession = sanitizeSessionShell(session, details);
  const athletePayloads = assignments.map((assignment, index) => {
    const rider = riders[index];
    const startedAt = assignment.startedAt!;
    const plannedEndedAt = startedAt + durationMs;
    const stoppedAt = dnfEndedAt(assignment, options, sharedSession.endedAt);
    if (stoppedAt != null && stoppedAt >= plannedEndedAt) {
      throw new Error(`Player ${assignment.playerId} Get Pulled DNF must be before the planned finish.`);
    }
    const resultStatus = stoppedAt == null ? 'finished' as const : 'dnf' as const;
    const endedAt = stoppedAt ?? plannedEndedAt;
    if (!Number.isSafeInteger(endedAt)) throw new Error(`Player ${assignment.playerId} finish clock is invalid.`);
    if (resultStatus === 'dnf' && rider.distanceMeters > sharedSession.distanceMeters) {
      throw new Error(`Player ${assignment.playerId} Get Pulled DNF distance exceeds the shared result.`);
    }
    const riderWindow: ClubOwnerTrainingRiderWindow = { assignmentId: assignment.id, status: resultStatus, endedAt };
    const scopedRider = { ...rider, resultStatus };
    return {
      assignmentId: assignment.id,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: assignment.bikeDeviceId,
      playerId: assignment.playerId,
      riderWindow,
      session: sanitizeSessionShell({
        ...sharedSession,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        distanceMeters: rider.distanceMeters,
      }, { ...details, riders: [scopedRider] }),
    } satisfies ClubOwnerAssignedTrainingPayload;
  });
  return {
    session: sharedSession,
    riderWindows: athletePayloads.map((payload) => payload.riderWindow),
    athletePayloads,
  };
}

function sanitizeExploreRider(row: Record<string, unknown>) {
  const player = playerId(row.playerId, 'Explore rider');
  return {
    playerId: player,
    distanceMeters: finiteNumber(row.distanceMeters, `Player ${player} Explore distance`),
    averageSpeedMph: finiteNumber(row.averageSpeedMph, `Player ${player} Explore average speed`),
  };
}

export function validateClubOwnerExploreActiveClockSegments(
  assignment: ClubOwnerTrainingAssignment,
  rawSegments: readonly ClubOwnerActiveClockSegment[],
  sessionEndedAt: number,
): readonly ClubOwnerActiveClockSegment[] {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw new Error(`Player ${assignment.playerId} Explore ride needs at least one active-clock segment.`);
  }
  const expectedStart = assignment.startedAt;
  if (expectedStart == null) throw new Error(`Player ${assignment.playerId} was not activated.`);
  let expectedElapsed = 0;
  let previousEnd: number | null = null;
  return rawSegments.map((raw, index) => {
    const segment = object(raw, `Player ${assignment.playerId} Explore segment ${index + 1}`);
    const startedAt = safeInteger(segment.startedAt, `Player ${assignment.playerId} Explore segment start`);
    const endedAt = safeInteger(segment.endedAt, `Player ${assignment.playerId} Explore segment end`);
    const activeElapsedAtStartMs = safeInteger(
      segment.activeElapsedAtStartMs,
      `Player ${assignment.playerId} Explore active elapsed time`,
    );
    if (endedAt <= startedAt) throw new Error(`Player ${assignment.playerId} Explore segments must have positive duration.`);
    if (index === 0 && startedAt !== expectedStart) {
      throw new Error(`Player ${assignment.playerId} Explore clock must start at first-watt activation.`);
    }
    if (previousEnd != null && startedAt < previousEnd) {
      throw new Error(`Player ${assignment.playerId} Explore segments overlap or are out of order.`);
    }
    if (activeElapsedAtStartMs !== expectedElapsed) {
      throw new Error(`Player ${assignment.playerId} Explore active clock is not continuous.`);
    }
    if (endedAt > sessionEndedAt) {
      throw new Error(`Player ${assignment.playerId} Explore segment ends after the shared ride.`);
    }
    expectedElapsed += endedAt - startedAt;
    previousEnd = endedAt;
    return { startedAt, endedAt, activeElapsedAtStartMs };
  });
}

function exploreBuild(
  session: TrainingSessionInput,
  assignments: readonly ClubOwnerTrainingAssignment[],
  options: BuildClubOwnerTrainingResultsOptions,
): ClubOwnerTrainingResultBuild {
  const rawDetails = object(session.details, 'Explore details');
  const ridersByPlayer = rowsByAuthorizedPlayer(rawDetails.riders, assignments, 'Explore riders');
  const riders = assignments.map((assignment) => sanitizeExploreRider(ridersByPlayer.get(assignment.playerId)!));
  const details = {
    originLabel: text(rawDetails.originLabel, 'Route origin'),
    destinationLabel: text(rawDetails.destinationLabel, 'Route destination'),
    travelMode: rawDetails.travelMode === 'drive' ? 'drive' : 'bicycle',
    elevationGainMeters: finiteNumber(rawDetails.elevationGainMeters ?? 0, 'Explore elevation gain'),
    elevationLossMeters: finiteNumber(rawDetails.elevationLossMeters ?? 0, 'Explore elevation loss'),
    riders,
  };
  const sharedSession = sanitizeSessionShell(session, details);
  const segmentsByAssignment = options.exploreActiveClockSegmentsByAssignmentId;
  if (!segmentsByAssignment) throw new Error('Explore group history requires active-clock segments for every rider.');
  const knownAssignments = new Set(assignments.map((assignment) => assignment.id));
  Object.keys(segmentsByAssignment).forEach((assignmentId) => {
    if (!knownAssignments.has(assignmentId)) throw new Error('Explore active-clock segments include an unauthorized assignment.');
  });
  const athletePayloads = assignments.map((assignment, index) => {
    const rawSegments = segmentsByAssignment[assignment.id];
    if (!rawSegments) throw new Error(`Player ${assignment.playerId} Explore active-clock segments are missing.`);
    const activeClockSegments = validateClubOwnerExploreActiveClockSegments(
      assignment,
      rawSegments,
      sharedSession.endedAt,
    );
    const endedAt = activeClockSegments[activeClockSegments.length - 1].endedAt;
    const stoppedAt = dnfEndedAt(assignment, options, sharedSession.endedAt);
    if (stoppedAt != null && stoppedAt !== endedAt) {
      throw new Error(`Player ${assignment.playerId} Explore DNF clock must match the last active segment.`);
    }
    const resultStatus = stoppedAt == null ? 'finished' as const : 'dnf' as const;
    const durationMs = activeClockSegments.reduce((total, segment) => total + segment.endedAt - segment.startedAt, 0);
    const rider = riders[index];
    if (resultStatus === 'dnf' && rider.distanceMeters > sharedSession.distanceMeters) {
      throw new Error(`Player ${assignment.playerId} Explore DNF distance exceeds the shared result.`);
    }
    const riderWindow: ClubOwnerTrainingRiderWindow = {
      assignmentId: assignment.id,
      status: resultStatus,
      endedAt,
      activeClockSegments,
    };
    const scopedRider = { ...rider, resultStatus };
    return {
      assignmentId: assignment.id,
      studioRiderId: assignment.studioRiderId,
      bikeDeviceId: assignment.bikeDeviceId,
      playerId: assignment.playerId,
      riderWindow,
      session: sanitizeSessionShell({
        ...sharedSession,
        startedAt: assignment.startedAt!,
        endedAt,
        durationMs,
        distanceMeters: rider.distanceMeters,
      }, { ...details, riders: [scopedRider], activeClockSegments }),
    } satisfies ClubOwnerAssignedTrainingPayload;
  });
  return {
    session: sharedSession,
    riderWindows: athletePayloads.map((payload) => payload.riderWindow),
    athletePayloads,
  };
}

/**
 * Sanitizes one shared result and proves that it can be split into exactly one
 * result per authorized rider. Unknown identity-bearing fields and unscoped
 * race events are intentionally not copied.
 */
export function buildClubOwnerTrainingResults(
  authorization: Pick<ClubOwnerTrainingAuthorization, 'activityType' | 'assignments'>,
  session: TrainingSessionInput,
  options: BuildClubOwnerTrainingResultsOptions = {},
): ClubOwnerTrainingResultBuild {
  assertClubOwnerTrainingHasNoPrivateFields(session);
  const assignments = validateAssignments(authorization);
  validateDnfAssignmentKeys(assignments, options);
  if (session.activityType !== authorization.activityType) {
    throw new Error('The shared result activity does not match its club authorization.');
  }
  switch (authorization.activityType) {
    case 'bmx-race':
    case 'straight-sprint':
      return raceBuild(session, assignments, options);
    case 'get-pulled':
      return getPulledBuild(session, assignments, options);
    case 'explore':
      return exploreBuild(session, assignments, options);
  }
}

function comparableWindow(window: ClubOwnerTrainingRiderWindow) {
  return {
    assignmentId: window.assignmentId,
    status: window.status,
    endedAt: window.endedAt,
    ...(window.activeClockSegments ? {
      activeClockSegments: window.activeClockSegments.map((segment) => ({
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        activeElapsedAtStartMs: segment.activeElapsedAtStartMs,
      })),
    } : {}),
  };
}

/** Validates caller-supplied windows and returns the sanitized atomic payload. */
export function buildClubOwnerTrainingCompletion(
  authorization: Pick<ClubOwnerTrainingAuthorization, 'activityType' | 'assignments'>,
  session: TrainingSessionInput,
  riderWindows: readonly ClubOwnerTrainingRiderWindow[],
) {
  if (!Array.isArray(riderWindows)) throw new Error('Club rider windows must be an array.');
  riderWindows.forEach((window) => {
    if (window.status !== 'finished' && window.status !== 'dnf') {
      throw new Error('Every club rider window needs a finished or DNF status.');
    }
    if (authorization.activityType !== 'explore' && window.activeClockSegments != null) {
      throw new Error('Active-clock segments are allowed for Explore rider windows only.');
    }
  });
  const segments = Object.fromEntries(riderWindows.flatMap((window) => (
    window.activeClockSegments ? [[window.assignmentId, window.activeClockSegments]] : []
  )));
  const dnfByAssignmentId = Object.fromEntries(riderWindows.flatMap((window) => (
    window.status === 'dnf' ? [[window.assignmentId, { endedAt: window.endedAt }]] : []
  )));
  const build = buildClubOwnerTrainingResults(authorization, session, {
    dnfByAssignmentId,
    ...(authorization.activityType === 'explore'
      ? { exploreActiveClockSegmentsByAssignmentId: segments }
      : {}),
  });
  if (riderWindows.length !== build.riderWindows.length) {
    throw new Error('Club completion needs exactly one rider window per assignment.');
  }
  const expectedById = new Map(build.riderWindows.map((window) => [window.assignmentId, window]));
  const seen = new Set<string>();
  riderWindows.forEach((window) => {
    if (seen.has(window.assignmentId)) throw new Error('Club completion contains duplicate rider windows.');
    seen.add(window.assignmentId);
    const expected = expectedById.get(window.assignmentId);
    if (!expected || JSON.stringify(comparableWindow(expected)) !== JSON.stringify(comparableWindow(window))) {
      throw new Error('A club rider window does not match its authorized finish clock.');
    }
  });
  return build;
}
