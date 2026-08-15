import type { TrainingActivityType, TrainingSession } from '../types';

export type TrainingHistoryResponse = {
  sessions: TrainingSession[];
  totals: {
    sessions: number;
    bmxRaces: number;
    straightSprints: number;
    exploreRides: number;
    distanceMeters: number;
    durationMs: number;
  };
};

export type TrainingSessionInput = Omit<TrainingSession, 'createdAt' | 'updatedAt' | 'source'> & {
  source?: TrainingSession['source'];
};

function trainingHistoryUrl(from?: number, to?: number) {
  const params = new URLSearchParams();
  if (Number.isFinite(from)) params.set('from', String(from));
  if (Number.isFinite(to)) params.set('to', String(to));
  params.set('limit', '1000');
  return `/api/training-sessions?${params.toString()}`;
}

function normalizeActivityType(value: unknown): TrainingActivityType {
  return value === 'straight-sprint' || value === 'explore' ? value : 'bmx-race';
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
    details: value.details && typeof value.details === 'object' ? value.details : {},
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
      distanceMeters: sessions.reduce((total, session) => total + session.distanceMeters, 0),
      durationMs: sessions.reduce((total, session) => total + session.durationMs, 0),
    },
  };
}

export async function saveTrainingSession(session: TrainingSessionInput) {
  const response = await fetch('/api/training-sessions', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
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

export function downloadTrainingSession(session: TrainingSession, format: 'json' | 'csv') {
  const day = new Date(session.startedAt).toISOString().slice(0, 10);
  const base = `tracklab-${session.activityType}-${day}-${session.id.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}`;
  if (format === 'json') {
    downloadFile(`${base}.json`, 'application/json', `${JSON.stringify(session, null, 2)}\n`);
    return;
  }
  const rows: Array<[string, unknown]> = [
    ['Session ID', session.id],
    ['Activity', session.activityType],
    ['Title', session.title],
    ['Started', new Date(session.startedAt).toISOString()],
    ['Ended', new Date(session.endedAt).toISOString()],
    ['Duration seconds', Math.round(session.durationMs / 1_000)],
    ['Distance meters', Number(session.distanceMeters.toFixed(2))],
    ['Track', session.trackName ?? ''],
    ['Details', session.details],
  ];
  downloadFile(`${base}.csv`, 'text/csv;charset=utf-8', `Field,Value\n${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`);
}
