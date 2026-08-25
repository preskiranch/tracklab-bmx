import type {
  PrivateHeartRateSummary,
  PrivateHeartRateZoneSummary,
  TrainingActivityType,
  TrainingSession,
} from '../types';
import {
  loadPrivateHeartRateSessionHistoryResult,
  type PrivateHeartRateHistoryItem,
  type PrivateHeartRateSessionHistory,
} from './heartRateCloud';

export type PrivateTrainingHeartRateState =
  | 'loading'
  | 'syncing'
  | 'saved'
  | 'not-recorded'
  | 'error';

/**
 * The only Apple Watch history shape that may cross into training-history UI
 * or a private health export. It deliberately omits stream, pairing, rider,
 * studio-rider, club, and account identifiers.
 */
export type PrivateTrainingHeartRateProjection = Readonly<{
  access: 'athlete-private';
  displayedSessionId: string;
  canonicalSessionId: string;
  state: PrivateTrainingHeartRateState;
  playerId: number | null;
  summary: PrivateHeartRateSummary | null;
  zoneSummaries: readonly PrivateHeartRateZoneSummary[];
}>;

export type PrivateTrainingHeartRateTarget = Readonly<{
  access: 'athlete-private';
  displayedSessionId: string;
  canonicalSessionId: string;
  /** Request-only discriminator; omitted from every UI/export projection. */
  activityType: TrainingActivityType;
}>;

export type PrivateTrainingHeartRateBySession = ReadonlyMap<
  string,
  readonly PrivateTrainingHeartRateProjection[]
>;

export const privateTrainingHeartRateLoadConcurrency = 4;

function validSessionId(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

/** Returns null for club-owner projections: their route is consented summary-only. */
export function privateTrainingHeartRateTarget(
  session: Pick<TrainingSession, 'id' | 'club' | 'activityType'>,
): PrivateTrainingHeartRateTarget | null {
  // Account/club projections prepend trusted scope identifiers to a canonical
  // session that is itself capped at 160 characters.
  const displayedSessionId = validSessionId(session.id, 512);
  if (!displayedSessionId || session.club?.role === 'owner') return null;
  const projectedPrefix = session.club?.role === 'athlete'
    ? `club:${session.club.id}:`
    : '';
  const canonicalSessionId = validSessionId(
    projectedPrefix && displayedSessionId.startsWith(projectedPrefix)
      ? displayedSessionId.slice(projectedPrefix.length)
      : displayedSessionId,
  );
  return canonicalSessionId ? {
    access: 'athlete-private',
    displayedSessionId,
    canonicalSessionId,
    activityType: session.activityType,
  } : null;
}

function copySummary(summary: PrivateHeartRateSummary | null): PrivateHeartRateSummary | null {
  if (!summary) return null;
  return {
    sampleCount: summary.sampleCount,
    coverageMs: summary.coverageMs,
    coveragePercent: summary.coveragePercent,
    firstSampleElapsedMs: summary.firstSampleElapsedMs,
    lastSampleElapsedMs: summary.lastSampleElapsedMs,
    minimumBpm: summary.minimumBpm,
    averageBpm: summary.averageBpm,
    peakBpm: summary.peakBpm,
  };
}

function copyZoneSummary(zone: PrivateHeartRateZoneSummary): PrivateHeartRateZoneSummary {
  return {
    zoneId: zone.zoneId,
    ...(zone.zoneName ? { zoneName: zone.zoneName } : {}),
    startElapsedMs: zone.startElapsedMs,
    endElapsedMs: zone.endElapsedMs,
    summary: copySummary(zone.summary)!,
  };
}

export function privateTrainingHeartRatePlaceholder(
  target: PrivateTrainingHeartRateTarget,
  state: Extract<PrivateTrainingHeartRateState, 'loading' | 'not-recorded' | 'error' | 'syncing'>,
): PrivateTrainingHeartRateProjection {
  return {
    access: target.access,
    displayedSessionId: target.displayedSessionId,
    canonicalSessionId: target.canonicalSessionId,
    state,
    playerId: null,
    summary: null,
    zoneSummaries: [],
  };
}

function itemSessionId(item: PrivateHeartRateHistoryItem) {
  return 'trainingSessionId' in item ? item.trainingSessionId : item.sessionId;
}

function isExactTrainingHeartRateItem(item: PrivateHeartRateHistoryItem) {
  return 'trainingSessionId' in item || item.relayScope === 'session';
}

/**
 * Converts the owner-authorized cloud result into a strict least-data shape.
 * A malformed cross-session item is discarded even after the cloud client has
 * already applied its own exact-session filter.
 */
export function projectPrivateTrainingHeartRateHistory(
  target: PrivateTrainingHeartRateTarget,
  history: PrivateHeartRateSessionHistory,
): readonly PrivateTrainingHeartRateProjection[] {
  const items = history.items.filter((item) => (
    isExactTrainingHeartRateItem(item)
    &&
    itemSessionId(item) === target.canonicalSessionId
    && item.activityType === target.activityType
  ));
  if (items.length === 0) {
    return [privateTrainingHeartRatePlaceholder(
      target,
      history.status === 'syncing' ? 'syncing' : 'not-recorded',
    )];
  }
  const state: Extract<PrivateTrainingHeartRateState, 'syncing' | 'saved'> =
    items.some((item) => item.finalizedAt == null)
      ? 'syncing'
      : 'saved';
  return items.map((item) => ({
    access: target.access,
    displayedSessionId: target.displayedSessionId,
    canonicalSessionId: target.canonicalSessionId,
    state,
    playerId: item.playerId,
    summary: copySummary(item.summary),
    zoneSummaries: item.zoneSummaries.map(copyZoneSummary),
  }));
}

export async function loadPrivateTrainingHeartRateHistory(
  target: PrivateTrainingHeartRateTarget,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly PrivateTrainingHeartRateProjection[]> {
  const history = await loadPrivateHeartRateSessionHistoryResult(
    target.canonicalSessionId,
    options,
  );
  return projectPrivateTrainingHeartRateHistory(target, history);
}

/** Loads one selected day without opening an unbounded set of health requests. */
export async function loadPrivateTrainingHeartRateDay(
  targets: readonly PrivateTrainingHeartRateTarget[],
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ReadonlyMap<string, readonly PrivateTrainingHeartRateProjection[]>> {
  const uniqueTargets = [...new Map(
    targets.map((target) => [target.displayedSessionId, target]),
  ).values()];
  const results = new Map<string, readonly PrivateTrainingHeartRateProjection[]>();
  let nextIndex = 0;
  const loadNext = async (): Promise<void> => {
    while (nextIndex < uniqueTargets.length) {
      if (options.signal?.aborted) throw options.signal.reason;
      const target = uniqueTargets[nextIndex];
      nextIndex += 1;
      try {
        results.set(
          target.displayedSessionId,
          await loadPrivateTrainingHeartRateHistory(target, options),
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        results.set(target.displayedSessionId, [
          privateTrainingHeartRatePlaceholder(target, 'error'),
        ]);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(privateTrainingHeartRateLoadConcurrency, uniqueTargets.length) },
    () => loadNext(),
  ));
  return results;
}

/**
 * Exact player join. The legacy null-player fallback is safe only for a
 * genuinely single-rider session whose data-bearing projections are all null.
 */
export function privateTrainingHeartRateForPlayer(
  projections: readonly PrivateTrainingHeartRateProjection[],
  playerId: number,
  riderCount: number,
): readonly PrivateTrainingHeartRateProjection[] {
  const dataBearing = projections.filter((projection) => (
    projection.state === 'saved' || projection.state === 'syncing'
  ));
  const exact = dataBearing.filter((projection) => projection.playerId === playerId);
  if (exact.length > 0) return exact;
  return riderCount === 1 && dataBearing.length > 0
    && dataBearing.every((projection) => projection.playerId == null)
    ? dataBearing
    : [];
}

/** Exact source-zone join. Duplicate IDs fail closed instead of picking one. */
export function privateTrainingHeartRateZone(
  projection: PrivateTrainingHeartRateProjection,
  sourceZoneId: string,
  expectedWindow: Readonly<{ startElapsedMs: number; endElapsedMs: number }>,
): PrivateHeartRateZoneSummary | null {
  const normalizedZoneId = sourceZoneId.trim();
  if (!normalizedZoneId) return null;
  const matches = projection.zoneSummaries.filter((zone) => (
    zone.zoneId === normalizedZoneId
    && zone.startElapsedMs === expectedWindow.startElapsedMs
    && zone.endElapsedMs === expectedWindow.endElapsedMs
  ));
  return matches.length === 1 ? matches[0] : null;
}
