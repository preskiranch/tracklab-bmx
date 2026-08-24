import {
  clearStoredClubTabletDevice,
  clearStoredClubTabletSession,
  clearStoredClubTabletSessionIfCurrent,
  clubTabletSessionMatchesCurrentDevice,
  clubTabletSessionHeaders,
  clubTabletOutboxStorageKey,
  clubTabletText as text,
  normalizeClubTabletDevice as normalizeDevice,
  normalizeClubTabletDeviceCredential,
  normalizeClubTabletRoster,
  normalizeClubTabletSessionCredential,
  positiveClubTabletNumber as positiveNumber,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  storeClubTabletDevice,
  storeClubTabletSession,
  type ClubTabletAthlete,
  type ClubTabletDeviceCredential,
  type ClubTabletSession,
  type ClubTabletSessionCredential,
} from './clubTabletStorage';
import { recordedBikeMetricsAreAccepted } from './bikeSampleSanity';

export * from './clubTabletStorage';

export class ClubTabletRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClubTabletRequestError';
    this.status = status;
  }
}

async function tabletFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new ClubTabletRequestError(payload.error || `Club Tablet returned ${response.status}`, response.status);
  }
  return payload;
}

type ClubTabletOutboxKind = 'training' | 'race' | 'ghost';

type ClubTabletOutboxEntry = {
  id: string;
  kind: ClubTabletOutboxKind;
  deviceId: string;
  clubId: string;
  studioRiderId: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
};

function readClubTabletOutbox(): ClubTabletOutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(clubTabletOutboxStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<ClubTabletOutboxEntry>;
      const id = text(candidate.id, 240);
      const deviceId = text(candidate.deviceId, 120);
      const clubId = text(candidate.clubId, 120);
      const studioRiderId = text(candidate.studioRiderId, 120);
      if (!id || !deviceId || !clubId || !studioRiderId || !candidate.payload) return [];
      if (candidate.kind !== 'training' && candidate.kind !== 'race' && candidate.kind !== 'ghost') return [];
      return [{
        id,
        kind: candidate.kind,
        deviceId,
        clubId,
        studioRiderId,
        payload: candidate.payload,
        createdAt: positiveNumber(candidate.createdAt, Date.now()),
        attempts: Math.max(0, Math.floor(Number(candidate.attempts) || 0)),
      }];
    }).filter((entry) => Date.now() - entry.createdAt < 14 * 24 * 60 * 60 * 1_000).slice(-100);
  } catch {
    return [];
  }
}

function writeClubTabletOutbox(entries: ClubTabletOutboxEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(clubTabletOutboxStorageKey, JSON.stringify(entries.slice(-100)));
  } catch {
    // A blocked sessionStorage backend cannot retain retries, but must not cause
    // a completed remote save to fail or leak an athlete artifact elsewhere.
  }
}

function queueClubTabletArtifact(
  kind: ClubTabletOutboxKind,
  artifactId: string,
  payload: unknown,
  credential: NonNullable<ReturnType<typeof readStoredClubTabletSession>>,
) {
  const id = `${credential.deviceId}:${credential.session.studioRiderId}:${kind}:${text(artifactId, 180)}`;
  const entry: ClubTabletOutboxEntry = {
    id,
    kind,
    deviceId: credential.deviceId,
    clubId: credential.session.clubId,
    studioRiderId: credential.session.studioRiderId,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  const entries = readClubTabletOutbox().filter((candidate) => candidate.id !== id);
  entries.push(entry);
  writeClubTabletOutbox(entries);
  return entry;
}

async function sendClubTabletOutboxEntry(
  entry: ClubTabletOutboxEntry,
  credential: NonNullable<ReturnType<typeof readStoredClubTabletSession>>,
) {
  const path = entry.kind === 'training'
    ? '/api/club-tablet/training-sessions'
    : entry.kind === 'race'
      ? '/api/club-tablet/race-results'
      : '/api/club-tablet/ghosts';
  const payload = await tabletFetch(path, {
    method: 'POST',
    headers: clubTabletSessionHeaders(credential.sessionToken),
    body: JSON.stringify(entry.payload),
  });
  writeClubTabletOutbox(readClubTabletOutbox().filter((candidate) => candidate.id !== entry.id));
  return payload;
}

function outboxEntryMatchesSession(entry: ClubTabletOutboxEntry, credential: ClubTabletSessionCredential) {
  return entry.deviceId === credential.deviceId
    && entry.clubId === credential.session.clubId
    && entry.studioRiderId === credential.session.studioRiderId;
}

export async function flushClubTabletOutbox(credential = readStoredClubTabletSession()) {
  if (!credential || !clubTabletSessionMatchesCurrentDevice(credential)) return 0;
  let sent = 0;
  for (const entry of readClubTabletOutbox().filter((candidate) => outboxEntryMatchesSession(candidate, credential))) {
    if (!recordedBikeMetricsAreAccepted(entry.payload)) {
      writeClubTabletOutbox(readClubTabletOutbox().filter((candidate) => candidate.id !== entry.id));
      continue;
    }
    try {
      await sendClubTabletOutboxEntry(entry, credential);
      sent += 1;
    } catch {
      const entries = readClubTabletOutbox();
      writeClubTabletOutbox(entries.map((candidate) => (
        candidate.id === entry.id ? { ...candidate, attempts: candidate.attempts + 1 } : candidate
      )));
      break;
    }
  }
  return sent;
}

export async function saveClubTabletTrainingSession(
  session: unknown,
  localPlayerId: string | number,
  credential = readStoredClubTabletSession(),
) {
  if (!credential || !clubTabletSessionMatchesCurrentDevice(credential)) {
    throw new Error('No athlete is signed into this club tablet.');
  }
  const sessionId = session && typeof session === 'object' ? text((session as { id?: unknown }).id, 160) : '';
  if (!sessionId) throw new Error('The training session is missing its durable session ID.');
  const entry = queueClubTabletArtifact('training', sessionId, { session, localPlayerId }, credential);
  return sendClubTabletOutboxEntry(entry, credential);
}

export async function enrollClubTablet(name: string) {
  const payload = await tabletFetch('/api/club-tablet/devices', {
    method: 'POST',
    body: JSON.stringify({ name: text(name, 80) }),
  });
  const credential = normalizeClubTabletDeviceCredential(payload);
  if (!credential) throw new Error('TrackLab returned an invalid tablet authorization.');
  storeClubTabletDevice(credential);
  return credential;
}

export async function loadClubTabletDevices() {
  const payload = await tabletFetch('/api/club-tablet/devices') as { devices?: unknown };
  if (!Array.isArray(payload.devices)) {
    throw new Error('TrackLab returned an invalid club tablet list.');
  }
  return payload.devices.flatMap((value) => {
    const device = normalizeDevice(value);
    return device ? [device] : [];
  });
}

export async function revokeClubTabletDevice(deviceId: string) {
  await tabletFetch('/api/club-tablet/devices', {
    method: 'DELETE',
    body: JSON.stringify({ deviceId: text(deviceId, 120) }),
  });
  const current = readStoredClubTabletDevice();
  if (current?.device.id === deviceId) {
    clearStoredClubTabletSession();
    clearStoredClubTabletDevice();
  }
}

export async function loadClubTabletRoster(credential = readStoredClubTabletDevice()) {
  if (!credential) throw new Error('This tablet has not been authorized by the club owner.');
  const roster = normalizeClubTabletRoster(await tabletFetch('/api/club-tablet/roster', {
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
  }));
  if (!roster || roster.device.id !== credential.device.id) {
    throw new Error('TrackLab returned an invalid club tablet roster.');
  }
  return roster;
}

export async function startClubTabletSession(
  studioRiderId: string,
  bikeDeviceId: number,
  credential = readStoredClubTabletDevice(),
) {
  if (!credential) throw new Error('This tablet has not been authorized by the club owner.');
  const payload = await tabletFetch('/api/club-tablet/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
    // The cloud contract treats the monitor/device identifier as an opaque
    // string. Keep the app's numeric BLE identifier locally for assignments.
    body: JSON.stringify({ studioRiderId, bikeDeviceId: String(Math.round(bikeDeviceId)) }),
  });
  const boundSession = normalizeClubTabletSessionCredential({
    ...payload,
    deviceId: credential.device.id,
  });
  if (!boundSession) throw new Error('TrackLab returned an invalid athlete session.');
  storeClubTabletSession(boundSession);
  return boundSession;
}

export async function refreshClubTabletSession(
  credential = readStoredClubTabletSession(),
  signal?: AbortSignal,
) {
  if (!credential) throw new Error('No athlete is signed into this club tablet.');
  if (!clubTabletSessionMatchesCurrentDevice(credential)) {
    clearStoredClubTabletSession();
    throw new Error('This athlete session belongs to a different club tablet.');
  }
  const payload = await tabletFetch('/api/club-tablet/sessions/current', {
    signal,
    headers: clubTabletSessionHeaders(credential.sessionToken),
  }) as Record<string, unknown>;
  const next = normalizeClubTabletSessionCredential({
    ...credential,
    ...payload,
    sessionToken: text(payload.sessionToken, 2048) || credential.sessionToken,
  });
  if (!next) throw new Error('TrackLab could not renew this athlete session.');
  storeClubTabletSession(next);
  return next;
}

export async function endClubTabletSession(credential = readStoredClubTabletSession()) {
  if (!credential) return;
  if (!clubTabletSessionMatchesCurrentDevice(credential)) {
    clearStoredClubTabletSession();
    return;
  }
  try {
    await tabletFetch('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: clubTabletSessionHeaders(credential.sessionToken),
    });
  } finally {
    clearStoredClubTabletSessionIfCurrent(credential);
  }
}

export async function saveClubTabletRaceResult(
  payload: {
    sessionId: string;
    trackId: string;
    trackName: string;
    summaries: unknown[];
    localPlayerId: string | number;
  },
  credential = readStoredClubTabletSession(),
) {
  if (!credential) throw new Error('No athlete is signed into this club tablet.');
  if (!clubTabletSessionMatchesCurrentDevice(credential)) throw new Error('This athlete session is no longer active on this tablet.');
  const entry = queueClubTabletArtifact('race', payload.sessionId, payload, credential);
  await sendClubTabletOutboxEntry(entry, credential);
}

export async function saveClubTabletGhost(
  ghost: unknown,
  localPlayerId: string | number,
  credential = readStoredClubTabletSession(),
) {
  if (!credential) throw new Error('No athlete is signed into this club tablet.');
  if (!clubTabletSessionMatchesCurrentDevice(credential)) throw new Error('This athlete session is no longer active on this tablet.');
  const ghostId = ghost && typeof ghost === 'object'
    ? text((ghost as { id?: unknown; sessionId?: unknown }).id, 160)
      || text((ghost as { sessionId?: unknown }).sessionId, 160)
    : '';
  if (!ghostId) throw new Error('The ghost is missing its durable ID.');
  const entry = queueClubTabletArtifact('ghost', ghostId, { ghost, localPlayerId }, credential);
  await sendClubTabletOutboxEntry(entry, credential);
}

export async function loadClubTabletGhosts(
  trackId: string,
  sprintConfiguration?: { distanceFeet: number; airSetting: number },
  credential = readStoredClubTabletSession(),
) {
  if (!credential || !clubTabletSessionMatchesCurrentDevice(credential)) {
    throw new Error('No athlete is signed into this club tablet.');
  }
  const params = new URLSearchParams({ trackId: text(trackId, 160) });
  if (sprintConfiguration) {
    params.set('sprintDistanceFeet', String(Math.max(1, Math.round(sprintConfiguration.distanceFeet))));
    params.set('sprintAirSetting', String(Math.max(1, Math.round(sprintConfiguration.airSetting))));
  }
  const payload = await tabletFetch(`/api/club-tablet/ghosts?${params.toString()}`, {
    headers: clubTabletSessionHeaders(credential.sessionToken),
  }) as { ghosts?: unknown };
  return Array.isArray(payload.ghosts) ? payload.ghosts : [];
}

export async function requestClubTabletMultiplayerTicket(
  credential = readStoredClubTabletSession(),
  signal?: AbortSignal,
) {
  if (!credential) return null;
  if (!clubTabletSessionMatchesCurrentDevice(credential)) return null;
  const payload = await tabletFetch('/api/club-tablet/multiplayer-ticket', {
    method: 'POST',
    signal,
    headers: clubTabletSessionHeaders(credential.sessionToken),
  }) as { ticket?: unknown; expiresAt?: unknown };
  const ticket = text(payload.ticket, 2048);
  const expiresAt = positiveNumber(payload.expiresAt);
  if (!ticket || !expiresAt) {
    throw new Error('TrackLab returned an invalid multiplayer ticket.');
  }
  return { ticket, expiresAt };
}

export function clubTabletAthleteDisplayName(athlete: ClubTabletAthlete | ClubTabletSession) {
  return text(athlete.athleteName, 80) || athlete.riderName;
}
