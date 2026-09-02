import type { RecoveryActivityType, RecoveryEffortSummary } from './recoveryAlert';

export type RecoveryRaceSnapshot = Readonly<{
  activityType: Extract<RecoveryActivityType, 'bmx-race' | 'straight-sprint'>;
  sessionId: string;
  startedAt: number | null;
  source: 'live' | 'demo';
  players: readonly Readonly<{
    playerId: string | number;
    riderId?: string;
  }>[];
  riders: readonly Readonly<{
    playerId: string | number;
    finishedAt: number | null;
  }>[];
}>;

export type RecoveryGetPulledResult = Readonly<{
  id: string;
  riderId?: string;
  startedAt: number;
  endedAt: number;
  averageWatts: number;
  peakWatts: number;
  averageCadence: number;
  peakCadence: number;
  averageSpeedKph: number;
  peakSpeedKph: number;
}>;

export type RecoveryFinishSignal = Readonly<{
  requestId: string;
  athleteId: string;
  activityType: RecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  finishedAt: number;
  effortSummary: RecoveryEffortSummary;
}>;

function normalizedRequestPart(value: string, maximumLength: number) {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, maximumLength) || 'unknown';
}

function stableRequestHash(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export function recoveryRequestId(sessionId: string, repetitionId: string) {
  const identity = `${sessionId}\u0000${repetitionId}`;
  return `recovery_${normalizedRequestPart(sessionId, 56)}_${normalizedRequestPart(repetitionId, 40)}_${stableRequestHash(identity)}`;
}

export function recoverySubmissionRetryDelayMs(attempt: number) {
  return Math.min(60_000, 2_000 * (2 ** Math.min(5, Math.max(0, attempt - 1))));
}

export function recoverySubmissionCanRetry(attempt: number) {
  return attempt <= 6;
}

export function retainPendingRecoveryFinishSignals(
  pending: ReadonlyMap<string, RecoveryFinishSignal>,
  observed: readonly RecoveryFinishSignal[],
  maximum = 32,
) {
  const next = new Map(pending);
  observed.forEach((signal) => next.set(signal.requestId, signal));
  while (next.size > maximum) {
    const oldest = next.keys().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

/** Rider finish values are elapsed milliseconds from the exact gate drop. */
export function raceRecoveryFinishSignals(snapshot: RecoveryRaceSnapshot | null) {
  if (!snapshot || snapshot.source !== 'live' || snapshot.startedAt == null) return [];
  const startedAt = snapshot.startedAt;
  const playerById = new Map(snapshot.players.map((player) => [`${player.playerId}`, player]));
  return snapshot.riders.flatMap<RecoveryFinishSignal>((rider) => {
    if (rider.finishedAt == null || rider.finishedAt < 0) return [];
    const player = playerById.get(`${rider.playerId}`);
    if (!player?.riderId) return [];
    const repetitionId = `${snapshot.activityType}:${snapshot.sessionId}:player-${rider.playerId}`;
    return [{
      requestId: recoveryRequestId(snapshot.sessionId, repetitionId),
      athleteId: player.riderId,
      activityType: snapshot.activityType,
      sessionId: snapshot.sessionId,
      repetitionId,
      finishedAt: startedAt + rider.finishedAt,
      effortSummary: { finishTimeMs: rider.finishedAt },
    }];
  });
}

export function getPulledRecoveryFinishSignal(
  result: RecoveryGetPulledResult | null,
): RecoveryFinishSignal | null {
  if (!result?.riderId || result.endedAt < result.startedAt) return null;
  const identitySeed = `${result.id}\u0000${result.startedAt}\u0000${result.endedAt}`;
  const opaqueIdentity = `${stableRequestHash(`session\u0000${identitySeed}`)}${stableRequestHash(`rep\u0000${identitySeed}`)}`;
  const sessionId = `recovery-pull-${opaqueIdentity}`;
  const repetitionId = `get-pulled-rep-${opaqueIdentity}`;
  return {
    requestId: recoveryRequestId(sessionId, repetitionId),
    athleteId: result.riderId,
    activityType: 'get-pulled',
    sessionId,
    repetitionId,
    finishedAt: result.endedAt,
    effortSummary: {
      workDurationMs: result.endedAt - result.startedAt,
      averagePowerWatts: result.averageWatts,
      peakPowerWatts: result.peakWatts,
      peakCadenceRpm: result.peakCadence,
      peakSpeedMps: result.peakSpeedKph / 3.6,
    },
  };
}
