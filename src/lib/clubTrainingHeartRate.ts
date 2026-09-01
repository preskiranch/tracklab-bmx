import type {
  PrivateHeartRateSummary,
  PrivateHeartRateZoneSummary,
  TrainingActivityType,
  TrainingSession,
} from '../types';
import {
  loadClubHeartRateSummaryHistory,
  type ClubHeartRateHistoryItem,
} from './heartRateCloud';

export type ConsentedClubTrainingHeartRateState =
  | 'loading'
  | 'syncing'
  | 'saved'
  | 'not-recorded'
  | 'error';

/**
 * Club-owner result-grid projection. This is deliberately summary-only: it
 * cannot carry raw samples, account identity, a Watch stream id, or a pairing
 * id from the athlete-owned health record.
 */
export type ConsentedClubTrainingHeartRateProjection = Readonly<{
  access: 'club-consented-summary';
  displayedSessionId: string;
  canonicalSessionId: string;
  state: ConsentedClubTrainingHeartRateState;
  playerId: number | null;
  summary: PrivateHeartRateSummary | null;
  zoneSummaries: readonly PrivateHeartRateZoneSummary[];
}>;

export type ConsentedClubTrainingHeartRateTarget = Readonly<{
  access: 'club-consented-summary';
  displayedSessionId: string;
  canonicalSessionId: string;
  activityType: TrainingActivityType;
  clubId: string;
  clubName: string;
  studioRiderId: string;
}>;

export type ConsentedClubTrainingHeartRateBySession = ReadonlyMap<
  string,
  readonly ConsentedClubTrainingHeartRateProjection[]
>;

export const consentedClubTrainingHeartRateLoadConcurrency = 4;

function validId(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

export function consentedClubTrainingHeartRateTarget(
  session: Pick<TrainingSession, 'id' | 'club' | 'activityType'>,
): ConsentedClubTrainingHeartRateTarget | null {
  if (session.club?.role !== 'owner') return null;
  const displayedSessionId = validId(session.id, 512);
  const clubId = validId(session.club.id);
  const studioRiderId = validId(session.club.studioRiderId);
  if (!displayedSessionId || !clubId || !studioRiderId) return null;
  const prefix = `club-owner:${clubId}:${studioRiderId}:`;
  const canonicalSessionId = validId(
    displayedSessionId.startsWith(prefix)
      ? displayedSessionId.slice(prefix.length)
      : displayedSessionId,
  );
  return canonicalSessionId ? {
    access: 'club-consented-summary',
    displayedSessionId,
    canonicalSessionId,
    activityType: session.activityType,
    clubId,
    clubName: session.club.name,
    studioRiderId,
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

export function consentedClubTrainingHeartRatePlaceholder(
  target: ConsentedClubTrainingHeartRateTarget,
  state: Extract<ConsentedClubTrainingHeartRateState, 'loading' | 'not-recorded' | 'error' | 'syncing'>,
): ConsentedClubTrainingHeartRateProjection {
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

function itemSessionId(item: ClubHeartRateHistoryItem) {
  return 'trainingSessionId' in item ? item.trainingSessionId : item.sessionId;
}

export function projectConsentedClubTrainingHeartRateHistory(
  target: ConsentedClubTrainingHeartRateTarget,
  items: readonly ClubHeartRateHistoryItem[],
): readonly ConsentedClubTrainingHeartRateProjection[] {
  const exact = items.filter((item) => (
    itemSessionId(item) === target.canonicalSessionId
    && item.activityType === target.activityType
    && item.studioRiderId === target.studioRiderId
  ));
  if (exact.length === 0) {
    return [consentedClubTrainingHeartRatePlaceholder(target, 'not-recorded')];
  }
  const state: Extract<ConsentedClubTrainingHeartRateState, 'syncing' | 'saved'> =
    exact.some((item) => item.finalizedAt == null) ? 'syncing' : 'saved';
  return exact.map((item) => ({
    access: target.access,
    displayedSessionId: target.displayedSessionId,
    canonicalSessionId: target.canonicalSessionId,
    state,
    playerId: item.playerId,
    summary: copySummary(item.summary),
    zoneSummaries: item.zoneSummaries.map(copyZoneSummary),
  }));
}

export async function loadConsentedClubTrainingHeartRateHistory(
  target: ConsentedClubTrainingHeartRateTarget,
  options: Readonly<{ signal?: AbortSignal }> = {},
) {
  const items = await loadClubHeartRateSummaryHistory(
    target.clubId,
    target.canonicalSessionId,
    target.studioRiderId,
    options,
  );
  return projectConsentedClubTrainingHeartRateHistory(target, items);
}

/** Loads one selected day with a fixed request bound and exact rider/session joins. */
export async function loadConsentedClubTrainingHeartRateDay(
  targets: readonly ConsentedClubTrainingHeartRateTarget[],
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ConsentedClubTrainingHeartRateBySession> {
  const uniqueTargets = [...new Map(
    targets.map((target) => [target.displayedSessionId, target]),
  ).values()];
  const results = new Map<string, readonly ConsentedClubTrainingHeartRateProjection[]>();
  let nextIndex = 0;
  const loadNext = async (): Promise<void> => {
    while (nextIndex < uniqueTargets.length) {
      if (options.signal?.aborted) throw options.signal.reason;
      const target = uniqueTargets[nextIndex];
      nextIndex += 1;
      try {
        results.set(
          target.displayedSessionId,
          await loadConsentedClubTrainingHeartRateHistory(target, options),
        );
      } catch (error) {
        if (options.signal?.aborted) throw error;
        results.set(target.displayedSessionId, [
          consentedClubTrainingHeartRatePlaceholder(target, 'error'),
        ]);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(consentedClubTrainingHeartRateLoadConcurrency, uniqueTargets.length) },
    () => loadNext(),
  ));
  return results;
}

