import type { RaceSummaryEntry, RaceZoneResult, TrainingActivityType, TrainingSession } from '../types';
import { readStoredClubTabletSession } from './clubTabletStorage';
import {
  acceptedBikeCadenceRpm,
  acceptedTrainingSpeedKph,
  acceptedTrainingSpeedMph,
  recordedBikeMetricKind,
} from './bikeSampleSanity';
export { recordedBikeMetricsAreAccepted } from './bikeSampleSanity';

export type TrainingHistoryResponse = {
  sessions: TrainingSession[];
  totals: {
    sessions: number;
    bmxRaces: number;
    straightSprints: number;
    exploreRides: number;
    getPulledTests: number;
    monitorSprints: number;
    distanceMeters: number;
    durationMs: number;
  };
};

export type TrainingSessionInput = Omit<TrainingSession, 'createdAt' | 'updatedAt' | 'source'> & {
  source?: TrainingSession['source'];
};

export type ClubTrainingSelection = {
  clubId: string;
  studioRiderId: string;
};

export type TrainingSessionRaceSummary = Partial<RaceSummaryEntry> & {
  playerId: RaceSummaryEntry['playerId'];
  riderId?: string;
  riderName?: string;
};

export function sanitizeRecordedBikeMetrics(value: unknown, depth = 0): unknown {
  if (depth > 32) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeRecordedBikeMetrics(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    const metricKind = recordedBikeMetricKind(key);
    if (metricKind === 'cadence') {
      return [key, nested == null ? null : acceptedBikeCadenceRpm(nested)];
    }
    if (metricKind === 'speed-kph') {
      return [key, nested == null ? null : acceptedTrainingSpeedKph(nested)];
    }
    if (metricKind === 'speed-mph') {
      return [key, nested == null ? null : acceptedTrainingSpeedMph(nested)];
    }
    if (metricKind === 'speed-mps') {
      const speedMps = Number(nested);
      return [key, nested == null || acceptedTrainingSpeedKph(speedMps * 3.6) == null ? null : speedMps];
    }
    return [key, sanitizeRecordedBikeMetrics(nested, depth + 1)];
  }));
}

function sanitizedTrainingSession(session: TrainingSession): TrainingSession {
  return {
    ...session,
    details: sanitizeRecordedBikeMetrics(session.details) as Record<string, unknown>,
  };
}

export function trainingSessionRaceSummaries(session: TrainingSession): TrainingSessionRaceSummary[] {
  const summaries = (sanitizeRecordedBikeMetrics(session.details) as { summaries?: unknown }).summaries;
  if (!Array.isArray(summaries)) return [];
  return summaries.filter((summary): summary is TrainingSessionRaceSummary => Boolean(
    summary
    && typeof summary === 'object'
    && Number.isFinite(Number((summary as TrainingSessionRaceSummary).playerId)),
  ));
}

export function trainingSessionZoneResults(session: TrainingSession): RaceZoneResult[] {
  const zoneResults = (sanitizeRecordedBikeMetrics(session.details) as { zoneResults?: unknown }).zoneResults;
  if (!Array.isArray(zoneResults)) return [];
  return zoneResults.filter((zone): zone is RaceZoneResult => Boolean(
    zone
    && typeof zone === 'object'
    && typeof (zone as RaceZoneResult).zoneId === 'string'
    && Array.isArray((zone as RaceZoneResult).riders),
  ));
}

export function trainingSessionReactionTimes(session: TrainingSession): Record<string, number> {
  const reactionTimes = (session.details as { reactionTimesByPlayer?: unknown }).reactionTimesByPlayer;
  if (!reactionTimes || typeof reactionTimes !== 'object' || Array.isArray(reactionTimes)) return {};
  return Object.fromEntries(Object.entries(reactionTimes).flatMap(([playerId, value]) => (
    Number.isFinite(Number(value)) ? [[playerId, Number(value)]] : []
  )));
}

function trainingHistoryUrl(from?: number, to?: number) {
  const params = new URLSearchParams();
  if (Number.isFinite(from)) params.set('from', String(from));
  if (Number.isFinite(to)) params.set('to', String(to));
  params.set('limit', '1000');
  return `/api/training-sessions?${params.toString()}`;
}

function normalizeActivityType(value: unknown): TrainingActivityType {
  return value === 'straight-sprint'
    || value === 'explore'
    || value === 'get-pulled'
    || value === 'monitor-sprint'
    ? value
    : 'bmx-race';
}

function normalizeTrainingSession(value: Partial<TrainingSession>): TrainingSession | null {
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const startedAt = Number(value.startedAt);
  const endedAt = Number(value.endedAt);
  if (!id || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return {
    id,
    activityType: normalizeActivityType(value.activityType),
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Training session',
    startedAt,
    endedAt,
    durationMs: Math.max(0, Number(value.durationMs) || endedAt - startedAt),
    distanceMeters: Math.max(0, Number(value.distanceMeters) || 0),
    ...(typeof value.trackId === 'string' && value.trackId ? { trackId: value.trackId } : {}),
    ...(typeof value.trackName === 'string' && value.trackName ? { trackName: value.trackName } : {}),
    source: value.source === 'imported' ? 'imported' : 'live',
    ...(value.club && typeof value.club === 'object' ? { club: value.club } : {}),
    details: value.details && typeof value.details === 'object'
      ? sanitizeRecordedBikeMetrics(value.details) as Record<string, unknown>
      : {},
    createdAt: Number(value.createdAt) || startedAt,
    updatedAt: Number(value.updatedAt) || endedAt,
  };
}

export async function loadTrainingHistory(from?: number, to?: number): Promise<TrainingHistoryResponse> {
  const response = await fetch(trainingHistoryUrl(from, to), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Training history returned ${response.status}`);
  const payload = await response.json() as Partial<TrainingHistoryResponse>;
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions.flatMap((value) => {
      const session = normalizeTrainingSession(value);
      return session ? [session] : [];
    })
    : [];
  return {
    sessions,
    totals: {
      sessions: sessions.length,
      bmxRaces: sessions.filter((session) => session.activityType === 'bmx-race').length,
      straightSprints: sessions.filter((session) => session.activityType === 'straight-sprint').length,
      exploreRides: sessions.filter((session) => session.activityType === 'explore').length,
      getPulledTests: sessions.filter((session) => session.activityType === 'get-pulled').length,
      monitorSprints: sessions.filter((session) => session.activityType === 'monitor-sprint').length,
      distanceMeters: sessions.reduce((total, session) => total + session.distanceMeters, 0),
      durationMs: sessions.reduce((total, session) => total + session.durationMs, 0),
    },
  };
}

export type SaveTrainingSessionOptions = {
  localPlayerId?: string | number | null;
};

function inferLocalPlayerId(
  session: TrainingSessionInput,
  clubSession?: ClubTrainingSelection | null,
): string | number | null {
  const details = session.details && typeof session.details === 'object'
    ? session.details as { summaries?: unknown; riders?: unknown }
    : {};
  const entries = Array.isArray(details.summaries)
    ? details.summaries
    : Array.isArray(details.riders) ? details.riders : [];
  const objects = entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  const match = clubSession
    ? objects.find((entry) => entry.riderId === clubSession.studioRiderId)
    : undefined;
  const candidate = match ?? (objects.length === 1 ? objects[0] : undefined);
  const playerId = candidate?.playerId;
  if (typeof playerId === 'string') return playerId;
  return Number.isFinite(Number(playerId)) ? Number(playerId) : null;
}

export async function saveTrainingSession(
  session: TrainingSessionInput,
  clubSession?: ClubTrainingSelection | null,
  options: SaveTrainingSessionOptions = {},
) {
  const tabletSession = readStoredClubTabletSession();
  const localPlayerId = options.localPlayerId ?? inferLocalPlayerId(session, clubSession);
  if (tabletSession && localPlayerId == null) {
    throw new Error('Club Tablet could not identify the local athlete result. The session was not saved to the wrong profile.');
  }
  if (tabletSession) {
    const payload = await import('./clubTablet').then(
      ({ saveClubTabletTrainingSession }) => saveClubTabletTrainingSession(session, localPlayerId!, tabletSession),
    ) as { session?: Partial<TrainingSession> };
    const saved = normalizeTrainingSession(payload.session ?? session);
    if (!saved) throw new Error('Training history returned an invalid session.');
    return saved;
  }
  const response = await fetch('/api/training-sessions', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session, ...(clubSession ? { clubSession } : {}) }),
  });
  if (!response.ok) throw new Error(`Training history save returned ${response.status}`);
  const payload = await response.json() as { session?: Partial<TrainingSession> };
  const saved = normalizeTrainingSession(payload.session ?? {});
  if (!saved) throw new Error('Training history returned an invalid session.');
  return saved;
}

function downloadFile(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvCell(value: unknown) {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function trainingSessionCsv(session: TrainingSession) {
  const safeSession = sanitizedTrainingSession(session);
  const reactionTimes = trainingSessionReactionTimes(safeSession);
  const summaryRows = trainingSessionRaceSummaries(safeSession).map((summary) => {
    return [
      summary.playerId,
      summary.riderId ?? '',
      summary.riderName ?? '',
      summary.rank ?? '',
      summary.finishTimeMs ?? '',
      summary.thirtyFootTimeMs ?? '',
      reactionTimes[String(summary.playerId)] ?? '',
      summary.distanceMeters ?? '',
      summary.sampleCount ?? '',
      summary.topSpeedKph ?? '',
      summary.averageSpeedKph ?? '',
      summary.topCadence ?? '',
      summary.averageCadence ?? '',
      summary.topWatts ?? '',
      summary.averageWatts ?? '',
    ];
  });
  const zoneRows = trainingSessionZoneResults(safeSession).flatMap((zone) => zone.riders.map((rider) => [
    zone.zoneId,
    zone.zoneName,
    zone.zoneType,
    zone.startMeter,
    zone.endMeter,
    rider.playerId,
    rider.sampleCount,
    rider.entryElapsedMs ?? '',
    rider.exitElapsedMs ?? '',
    rider.durationMs ?? '',
    rider.topSpeedKph ?? '',
    rider.averageSpeedKph ?? '',
    rider.topCadence ?? '',
    rider.averageCadence ?? '',
    rider.topWatts ?? '',
    rider.averageWatts ?? '',
  ]));
  const rows: Array<[string, unknown]> = [
    ['Session ID', safeSession.id],
    ['Activity', safeSession.activityType],
    ['Title', safeSession.title],
    ['Started', new Date(safeSession.startedAt).toISOString()],
    ['Ended', new Date(safeSession.endedAt).toISOString()],
    ['Duration seconds', safeSession.durationMs / 1_000],
    ['Distance meters', Number(safeSession.distanceMeters.toFixed(2))],
    ['Track', safeSession.trackName ?? ''],
    ['Training owner', safeSession.club ? `${safeSession.club.name} / ${safeSession.club.riderName}` : 'Personal'],
    ['Details', safeSession.details],
  ];
  const sections = [`Field,Value\n${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`];
  if (summaryRows.length > 0) {
    sections.push([
      [
        'Player ID', 'Studio rider ID', 'Rider', 'Rank', 'Finish ms', '30 ft ms', 'Reaction ms',
        'Distance meters', 'Analysis points', 'Top speed kph', 'Average speed kph',
        'Top cadence rpm', 'Average cadence rpm', 'Top watts', 'Average watts',
      ].map(csvCell).join(','),
      ...summaryRows.map((row) => row.map(csvCell).join(',')),
    ].join('\n'));
  }
  if (zoneRows.length > 0) {
    sections.push([
      [
        'Zone ID', 'Zone', 'Zone type', 'Start meter', 'End meter', 'Player ID', 'Analysis points',
        'Entry ms', 'Exit ms', 'Duration ms', 'Top speed kph', 'Average speed kph',
        'Top cadence rpm', 'Average cadence rpm', 'Top watts', 'Average watts',
      ].map(csvCell).join(','),
      ...zoneRows.map((row) => row.map(csvCell).join(',')),
    ].join('\n'));
  }
  return `${sections.join('\n\n')}\n`;
}

export function downloadTrainingSession(session: TrainingSession, format: 'json' | 'csv') {
  const safeSession = sanitizedTrainingSession(session);
  const day = new Date(safeSession.startedAt).toISOString().slice(0, 10);
  const base = `tracklab-${safeSession.activityType}-${day}-${safeSession.id.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}`;
  if (format === 'json') {
    downloadFile(`${base}.json`, 'application/json', `${JSON.stringify(safeSession, null, 2)}\n`);
    return;
  }
  downloadFile(`${base}.csv`, 'text/csv;charset=utf-8', trainingSessionCsv(safeSession));
}
