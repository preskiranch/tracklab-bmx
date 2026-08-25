import type { TrainingActivityType, TrainingSession } from '../types';
import {
  sanitizeRecordedBikeMetrics,
  trainingSessionRaceSummaries,
  trainingSessionReactionTimes,
  trainingSessionZoneResults,
} from './trainingHistory';

export type TrainingResultSheetId =
  | 'all'
  | 'race-sprint'
  | 'get-pulled'
  | 'explore'
  | 'monitor-sprint'
  | 'power-by-rep';

export type TrainingResultStatus = 'finished' | 'dnf' | 'saved';

export type TrainingResultRow = Readonly<{
  id: string;
  sessionId: string;
  sessionOrdinal: number;
  activityOrdinal: number;
  activityType: TrainingActivityType;
  title: string;
  trackName: string;
  startedAt: number;
  durationMs: number;
  plannedDurationMs: number | null;
  riderKey: string;
  riderId: string | null;
  playerId: string | number | null;
  riderName: string;
  status: TrainingResultStatus;
  rank: number | null;
  finishTimeMs: number | null;
  thirtyFootTimeMs: number | null;
  reactionTimeMs: number | null;
  distanceMeters: number | null;
  sampleCount: number | null;
  averageSpeedKph: number | null;
  peakSpeedKph: number | null;
  averageCadence: number | null;
  peakCadence: number | null;
  averageWatts: number | null;
  peakWatts: number | null;
  airSetting: number | null;
  routeOrigin: string;
  routeDestination: string;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  zoneCount: number;
}>;

export type TrainingPowerRepColumn = Readonly<{
  sessionId: string;
  label: string;
  title: string;
  startedAt: number;
  activityType: Exclude<TrainingActivityType, 'explore'>;
}>;

export type TrainingPowerRepRow = Readonly<{
  riderKey: string;
  riderName: string;
  peakWattsBySessionId: Readonly<Record<string, number | null>>;
}>;

export type TrainingPowerRepMatrix = Readonly<{
  columns: readonly TrainingPowerRepColumn[];
  rows: readonly TrainingPowerRepRow[];
}>;

export type TrainingResultSheetDefinition = Readonly<{
  id: TrainingResultSheetId;
  label: string;
  rowCount: number;
}>;

export const trainingActivityLabels: Readonly<Record<TrainingActivityType, string>> = {
  'bmx-race': 'BMX Race',
  'straight-sprint': 'Straight Sprint',
  explore: 'Explore',
  'get-pulled': 'Get Pulled',
  'monitor-sprint': 'Monitor Sprint',
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveOrNull(value: unknown): number | null {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function playerId(value: unknown): string | number | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const number = finite(value);
  return number != null ? number : null;
}

function riderIdentity(
  session: TrainingSession,
  source: Record<string, unknown>,
  rowIndex: number,
) {
  const id = text(source.riderId)
    || text(source.studioRiderId)
    || text(session.club?.studioRiderId);
  const player = playerId(source.playerId);
  const name = text(source.riderName)
    || text(source.name)
    || session.club?.riderName
    || 'Rider';
  const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, ' ');
  return {
    riderId: id || null,
    playerId: player,
    riderName: name,
    riderKey: id
      ? `id:${id}`
      : normalizedName && normalizedName !== 'rider'
        ? `name:${normalizedName}`
        : `session:${session.id}:row:${rowIndex}`,
  };
}

function resultStatus(source: Record<string, unknown>, finishTimeMs?: number | null): TrainingResultStatus {
  const explicit = text(source.resultStatus).toLocaleLowerCase();
  if (explicit === 'dnf') return 'dnf';
  if (explicit === 'finished') return 'finished';
  return finishTimeMs === null ? 'dnf' : 'finished';
}

function exploreActiveDuration(details: Record<string, unknown>, fallback: number) {
  if (!Array.isArray(details.activeClockSegments)) return fallback;
  const total = details.activeClockSegments.reduce((sum, candidate) => {
    const segment = objectValue(candidate);
    const startedAt = finite(segment.startedAt);
    const endedAt = finite(segment.endedAt);
    return startedAt != null && endedAt != null && endedAt > startedAt
      ? sum + endedAt - startedAt
      : sum;
  }, 0);
  return total > 0 ? total : fallback;
}

type RowBaseOptions = Partial<Omit<TrainingResultRow,
  | 'id'
  | 'sessionId'
  | 'sessionOrdinal'
  | 'activityOrdinal'
  | 'activityType'
  | 'title'
  | 'trackName'
  | 'startedAt'
  | 'riderKey'
  | 'riderId'
  | 'playerId'
  | 'riderName'
>>;

function trainingRow(
  session: TrainingSession,
  sessionOrdinal: number,
  activityOrdinal: number,
  source: Record<string, unknown>,
  rowIndex: number,
  values: RowBaseOptions = {},
): TrainingResultRow {
  const identity = riderIdentity(session, source, rowIndex);
  return {
    id: `${session.id}:${identity.riderKey}:${rowIndex}`,
    sessionId: session.id,
    sessionOrdinal,
    activityOrdinal,
    activityType: session.activityType,
    title: session.title,
    trackName: session.trackName ?? '',
    startedAt: session.startedAt,
    durationMs: session.durationMs,
    plannedDurationMs: null,
    ...identity,
    status: 'saved',
    rank: null,
    finishTimeMs: null,
    thirtyFootTimeMs: null,
    reactionTimeMs: null,
    distanceMeters: session.distanceMeters,
    sampleCount: null,
    averageSpeedKph: null,
    peakSpeedKph: null,
    averageCadence: null,
    peakCadence: null,
    averageWatts: null,
    peakWatts: null,
    airSetting: null,
    routeOrigin: '',
    routeDestination: '',
    elevationGainMeters: null,
    elevationLossMeters: null,
    zoneCount: 0,
    ...values,
  };
}

function raceRows(session: TrainingSession, sessionOrdinal: number, activityOrdinal: number) {
  const summaries = trainingSessionRaceSummaries(session);
  const reactions = trainingSessionReactionTimes(session);
  const zoneCount = trainingSessionZoneResults(session).length;
  if (summaries.length === 0) {
    return [trainingRow(session, sessionOrdinal, activityOrdinal, {}, 0, { zoneCount })];
  }
  return summaries.map((summary, index) => {
    const source = objectValue(summary);
    const finishTimeMs = positiveOrNull(summary.finishTimeMs);
    return trainingRow(session, sessionOrdinal, activityOrdinal, source, index, {
      status: resultStatus(source, finishTimeMs),
      rank: positiveOrNull(summary.rank),
      finishTimeMs,
      thirtyFootTimeMs: positiveOrNull(summary.thirtyFootTimeMs),
      reactionTimeMs: positiveOrNull(reactions[String(summary.playerId)]),
      distanceMeters: positiveOrNull(summary.distanceMeters) ?? session.distanceMeters,
      sampleCount: positiveOrNull(summary.sampleCount),
      averageSpeedKph: positiveOrNull(summary.averageSpeedKph),
      peakSpeedKph: positiveOrNull(summary.topSpeedKph),
      averageCadence: positiveOrNull(summary.averageCadence),
      peakCadence: positiveOrNull(summary.topCadence),
      averageWatts: positiveOrNull(summary.averageWatts),
      peakWatts: positiveOrNull(summary.topWatts),
      zoneCount,
    });
  });
}

function utilityRows(session: TrainingSession, sessionOrdinal: number, activityOrdinal: number) {
  const details = objectValue(sanitizeRecordedBikeMetrics(session.details));
  const riders = Array.isArray(details.riders)
    ? details.riders.map(objectValue)
    : [];
  const durationSeconds = positiveOrNull(details.durationSeconds);
  const plannedDurationMs = session.activityType === 'get-pulled' && durationSeconds != null
    ? durationSeconds * 1_000
    : null;
  if (riders.length === 0) {
    return [trainingRow(session, sessionOrdinal, activityOrdinal, {}, 0, {
      airSetting: positiveOrNull(details.airSetting),
      plannedDurationMs,
    })];
  }
  return riders.map((rider, index) => {
    const averageSpeedKph = positiveOrNull(rider.averageSpeedKph);
    const peakSpeedKph = positiveOrNull(rider.peakSpeedKph);
    const averageSpeedMph = positiveOrNull(rider.averageSpeedMph);
    const peakSpeedMph = positiveOrNull(rider.peakSpeedMph);
    return trainingRow(session, sessionOrdinal, activityOrdinal, rider, index, {
      status: resultStatus(rider),
      plannedDurationMs,
      distanceMeters: positiveOrNull(rider.distanceMeters) ?? session.distanceMeters,
      averageSpeedKph: averageSpeedKph ?? (averageSpeedMph == null ? null : averageSpeedMph * 1.609344),
      peakSpeedKph: peakSpeedKph ?? (peakSpeedMph == null ? null : peakSpeedMph * 1.609344),
      averageCadence: positiveOrNull(rider.averageCadence),
      peakCadence: positiveOrNull(rider.peakCadence),
      averageWatts: positiveOrNull(rider.averageWatts),
      peakWatts: positiveOrNull(rider.peakWatts),
      airSetting: positiveOrNull(details.airSetting),
    });
  });
}

function exploreRows(session: TrainingSession, sessionOrdinal: number, activityOrdinal: number) {
  const details = objectValue(sanitizeRecordedBikeMetrics(session.details));
  const riders = Array.isArray(details.riders)
    ? details.riders.map(objectValue)
    : [];
  const durationMs = exploreActiveDuration(details, session.durationMs);
  const common: RowBaseOptions = {
    durationMs,
    routeOrigin: text(details.originLabel),
    routeDestination: text(details.destinationLabel),
    elevationGainMeters: positiveOrNull(details.elevationGainMeters),
    elevationLossMeters: positiveOrNull(details.elevationLossMeters),
  };
  if (riders.length === 0) {
    return [trainingRow(session, sessionOrdinal, activityOrdinal, {}, 0, common)];
  }
  return riders.map((rider, index) => {
    const averageSpeedKph = positiveOrNull(rider.averageSpeedKph);
    const averageSpeedMph = positiveOrNull(rider.averageSpeedMph);
    return trainingRow(session, sessionOrdinal, activityOrdinal, rider, index, {
      ...common,
      status: resultStatus(rider),
      distanceMeters: positiveOrNull(rider.distanceMeters) ?? session.distanceMeters,
      averageSpeedKph: averageSpeedKph ?? (averageSpeedMph == null ? null : averageSpeedMph * 1.609344),
      elevationGainMeters: positiveOrNull(rider.elevationGainMeters) ?? common.elevationGainMeters,
      elevationLossMeters: positiveOrNull(rider.elevationLossMeters) ?? common.elevationLossMeters,
    });
  });
}

export function buildTrainingResultRows(sessions: readonly TrainingSession[]): TrainingResultRow[] {
  const ordered = [...sessions].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id));
  const activityCounts = new Map<TrainingActivityType, number>();
  return ordered.flatMap((session, index) => {
    const activityOrdinal = (activityCounts.get(session.activityType) ?? 0) + 1;
    activityCounts.set(session.activityType, activityOrdinal);
    const sessionOrdinal = index + 1;
    if (session.activityType === 'bmx-race' || session.activityType === 'straight-sprint') {
      return raceRows(session, sessionOrdinal, activityOrdinal);
    }
    if (session.activityType === 'explore') {
      return exploreRows(session, sessionOrdinal, activityOrdinal);
    }
    return utilityRows(session, sessionOrdinal, activityOrdinal);
  });
}

function powerColumnPrefix(activityType: Exclude<TrainingActivityType, 'explore'>) {
  if (activityType === 'bmx-race') return 'Race';
  if (activityType === 'get-pulled') return 'Pull';
  return 'Sprint';
}

export function buildTrainingPowerRepMatrix(
  sessions: readonly TrainingSession[],
  rows = buildTrainingResultRows(sessions),
): TrainingPowerRepMatrix {
  const rowSessionIds = new Set(rows.map((row) => row.sessionId));
  const counters = new Map<string, number>();
  const columns = [...sessions]
    .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    .flatMap((session): TrainingPowerRepColumn[] => {
      if (session.activityType === 'explore' || !rowSessionIds.has(session.id)) return [];
      const prefix = powerColumnPrefix(session.activityType);
      const number = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, number);
      return [{
        sessionId: session.id,
        label: `${prefix} ${number} peak W`,
        title: session.title,
        startedAt: session.startedAt,
        activityType: session.activityType,
      }];
    });
  const columnSessionIds = new Set(columns.map((column) => column.sessionId));
  const riders = new Map<string, { riderName: string; values: Record<string, number | null> }>();
  rows.forEach((row) => {
    if (row.peakWatts == null || !columnSessionIds.has(row.sessionId)) return;
    const current = riders.get(row.riderKey) ?? { riderName: row.riderName, values: {} };
    current.values[row.sessionId] = Math.max(current.values[row.sessionId] ?? 0, row.peakWatts);
    riders.set(row.riderKey, current);
  });
  return {
    columns,
    rows: [...riders.entries()]
      .map(([riderKey, rider]) => ({
        riderKey,
        riderName: rider.riderName,
        peakWattsBySessionId: Object.fromEntries(columns.map((column) => [
          column.sessionId,
          rider.values[column.sessionId] ?? null,
        ])),
      }))
      .sort((left, right) => left.riderName.localeCompare(right.riderName)),
  };
}

export function rowsForTrainingResultSheet(
  rows: readonly TrainingResultRow[],
  sheetId: Exclude<TrainingResultSheetId, 'power-by-rep'>,
) {
  if (sheetId === 'all') return [...rows];
  if (sheetId === 'race-sprint') {
    return rows.filter((row) => row.activityType === 'bmx-race' || row.activityType === 'straight-sprint');
  }
  return rows.filter((row) => row.activityType === sheetId);
}

export function availableTrainingResultSheets(
  sessions: readonly TrainingSession[],
  rows = buildTrainingResultRows(sessions),
  powerMatrix = buildTrainingPowerRepMatrix(sessions, rows),
): TrainingResultSheetDefinition[] {
  const sheets: TrainingResultSheetDefinition[] = [{ id: 'all', label: 'All results', rowCount: rows.length }];
  const add = (id: Exclude<TrainingResultSheetId, 'all' | 'power-by-rep'>, label: string) => {
    const rowCount = rowsForTrainingResultSheet(rows, id).length;
    if (rowCount > 0) sheets.push({ id, label, rowCount });
  };
  add('race-sprint', 'Race & sprint');
  add('get-pulled', 'Get Pulled');
  add('explore', 'Explore');
  add('monitor-sprint', 'Monitor');
  if (powerMatrix.columns.length >= 2 && powerMatrix.rows.length > 0) {
    sheets.push({ id: 'power-by-rep', label: 'Power by rep', rowCount: powerMatrix.rows.length });
  }
  return sheets;
}
