import {
  clearStoredClubTabletDevice,
  clearStoredClubTabletSession,
  clearStoredClubTabletSessionIfCurrent,
  clubTabletResultUploadHeader,
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
import { safeSetLocalStorage } from './browserStorage';
import { clearNativeAuthToken } from './nativeAuthSession';
import {
  forgetNativeClubTabletAuthorization,
  saveNativeClubTabletCredential,
} from './nativeClubTabletCredential';
import {
  normalizeWattbikeCapacityMessage,
  type WattbikeCapacityState,
} from './wattbikeCapacity';
import { flushClubTabletRecoveryOutbox } from './clubTabletRecoveryAlert';

export * from './clubTabletStorage';

export class ClubTabletRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClubTabletRequestError';
    this.status = status;
  }
}

const clubTabletNativePersistencePendingKey = 'tracklab.club-tablet-native-persistence-pending.v1';

type ClubTabletNativePersistencePending = Readonly<{
  version: 1;
  operation: 'enroll' | 'recover';
  deviceId: string;
  clubId: string;
  requestedName: string;
}>;

let volatileNativePersistencePending: ClubTabletNativePersistencePending | null = null;
let volatileNativePersistenceCredential: ClubTabletDeviceCredential | null = null;

function normalizeNativePersistencePending(value: unknown): ClubTabletNativePersistencePending | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletNativePersistencePending>;
  const operation = candidate.operation === 'enroll' || candidate.operation === 'recover'
    ? candidate.operation
    : null;
  const deviceId = text(candidate.deviceId, 120);
  const clubId = text(candidate.clubId, 120);
  const requestedName = text(candidate.requestedName, 80);
  if (candidate.version !== 1 || !operation || !deviceId || !clubId) return null;
  return { version: 1, operation, deviceId, clubId, requestedName };
}

function readNativePersistencePending() {
  if (volatileNativePersistencePending) return volatileNativePersistencePending;
  if (typeof window === 'undefined') return null;
  try {
    const pending = normalizeNativePersistencePending(JSON.parse(
      window.localStorage.getItem(clubTabletNativePersistencePendingKey) ?? 'null',
    ));
    volatileNativePersistencePending = pending;
    return pending;
  } catch {
    return null;
  }
}

function rememberNativePersistencePending(
  operation: ClubTabletNativePersistencePending['operation'],
  credential: ClubTabletDeviceCredential,
  requestedName = '',
) {
  const pending: ClubTabletNativePersistencePending = {
    version: 1,
    operation,
    deviceId: credential.device.id,
    clubId: credential.device.clubId,
    requestedName: text(requestedName, 80),
  };
  volatileNativePersistencePending = pending;
  volatileNativePersistenceCredential = credential;
  if (typeof window !== 'undefined') {
    safeSetLocalStorage(clubTabletNativePersistencePendingKey, JSON.stringify(pending));
  }
}

function forgetNativePersistencePending() {
  volatileNativePersistencePending = null;
  volatileNativePersistenceCredential = null;
  try {
    window.localStorage.removeItem(clubTabletNativePersistencePendingKey);
  } catch {
    // The in-memory marker is enough to prevent a duplicate request during
    // this run when browser storage is unavailable.
  }
}

async function persistClubTabletCredential(
  operation: ClubTabletNativePersistencePending['operation'],
  credential: ClubTabletDeviceCredential,
  requestedName = '',
) {
  storeClubTabletDevice(credential);
  rememberNativePersistencePending(operation, credential, requestedName);
  // Do not retire the administrator's native session unless the new kiosk
  // bearer is durably present in Keychain. The local credential and marker
  // intentionally remain available if both writes fail, allowing an exact
  // later retry without rotating the server credential a second time.
  let persistenceError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await saveNativeClubTabletCredential(credential);
      persistenceError = null;
      break;
    } catch (error) {
      persistenceError = error;
    }
  }
  if (persistenceError) throw persistenceError;
  forgetNativePersistencePending();
  await clearNativeAuthToken();
  return credential;
}

function pendingClubTabletCredential(
  operation: ClubTabletNativePersistencePending['operation'],
  expectedDeviceId = '',
  expectedName = '',
  expectedClubId = '',
) {
  const pending = readNativePersistencePending();
  const credential = readStoredClubTabletDevice() ?? volatileNativePersistenceCredential;
  if (
    !pending
    || pending.operation !== operation
    || !credential
    || pending.deviceId !== credential.device.id
    || pending.clubId !== credential.device.clubId
    || (expectedDeviceId && pending.deviceId !== expectedDeviceId)
    || (expectedName && pending.requestedName !== expectedName)
    || (expectedClubId && pending.clubId !== expectedClubId)
  ) return null;
  return credential;
}

function discardRejectedNativePersistencePending(
  credential: ClubTabletDeviceCredential,
) {
  const stored = readStoredClubTabletDevice();
  forgetNativePersistencePending();
  if (
    stored?.device.id === credential.device.id
    && stored.deviceToken === credential.deviceToken
  ) {
    clearStoredClubTabletDevice();
  }
}

async function validatePendingClubTabletCredential(
  credential: ClubTabletDeviceCredential,
) {
  try {
    await loadClubTabletRoster(credential);
  } catch (error) {
    // A definitive authorization response means the pending bearer can never
    // be committed safely. Forget only that matching local attempt so a newly
    // signed-in owner can perform a fresh recovery. Offline and server errors
    // retain it for a non-mutating retry.
    if (
      error instanceof ClubTabletRequestError
      && (error.status === 401 || error.status === 403)
    ) {
      discardRejectedNativePersistencePending(credential);
    }
    throw error;
  }
}

export type ClubTabletBikePresenceInput = Readonly<{
  deviceId: number;
  label: string;
}>;

type ClubTabletBikePresenceRequestOptions = Readonly<{
  keepalive?: boolean;
  signal?: AbortSignal;
}>;

export type ClubTabletPickerWattbikeCapacity = Readonly<{
  capacity: WattbikeCapacityState;
  expiresAt: number;
  pollAfterMs: number;
}>;

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
  bikeDeviceId: string;
  sessionToken: string;
  sessionExpiresAt: number;
  resultUploadToken: string;
  resultUploadExpiresAt: number;
  releaseAfterFlush: boolean;
  payload: unknown;
  createdAt: number;
  attempts: number;
};

function readClubTabletOutbox(): ClubTabletOutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(clubTabletOutboxStorageKey)
      ?? window.sessionStorage.getItem(clubTabletOutboxStorageKey)
      ?? '[]';
    const value = JSON.parse(stored) as unknown;
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
        bikeDeviceId: text(candidate.bikeDeviceId, 160),
        sessionToken: text(candidate.sessionToken, 2048),
        sessionExpiresAt: positiveNumber(candidate.sessionExpiresAt),
        resultUploadToken: text(candidate.resultUploadToken, 2048),
        resultUploadExpiresAt: positiveNumber(candidate.resultUploadExpiresAt),
        releaseAfterFlush: candidate.releaseAfterFlush === true,
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
    const serialized = JSON.stringify(entries.slice(-100));
    window.localStorage.setItem(clubTabletOutboxStorageKey, serialized);
    window.sessionStorage.removeItem(clubTabletOutboxStorageKey);
    if (window.localStorage.getItem(clubTabletOutboxStorageKey) !== serialized) {
      throw new Error('The tablet could not verify its local result queue.');
    }
  } catch {
    throw new Error('This tablet could not save the completed result locally. Free storage space and try again.');
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
    bikeDeviceId: String(credential.session.bikeDeviceId),
    sessionToken: credential.sessionToken,
    sessionExpiresAt: credential.session.expiresAt,
    resultUploadToken: credential.resultUploadToken ?? '',
    resultUploadExpiresAt: credential.resultUploadExpiresAt ?? 0,
    releaseAfterFlush: false,
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
  sessionToken = '',
) {
  const path = entry.kind === 'training'
    ? '/api/club-tablet/training-sessions'
    : entry.kind === 'race'
      ? '/api/club-tablet/race-results'
      : '/api/club-tablet/ghosts';
  const device = readStoredClubTabletDevice();
  const payload = await tabletFetch(path, {
    method: 'POST',
    headers: {
      ...clubTabletSessionHeaders(sessionToken),
      ...(device?.device.id === entry.deviceId && entry.resultUploadToken ? {
        Authorization: `Bearer ${device.deviceToken}`,
        [clubTabletResultUploadHeader]: entry.resultUploadToken,
      } : {}),
    },
    body: JSON.stringify(entry.payload),
  });
  writeClubTabletOutbox(readClubTabletOutbox().filter((candidate) => candidate.id !== entry.id));
  return payload;
}

function outboxEntryMatchesSession(entry: ClubTabletOutboxEntry, credential: ClubTabletSessionCredential) {
  return entry.deviceId === credential.deviceId
    && entry.clubId === credential.session.clubId
    && entry.studioRiderId === credential.session.studioRiderId
    && (!entry.sessionToken || entry.sessionToken === credential.sessionToken);
}

function incrementClubTabletOutboxAttempt(entryId: string) {
  writeClubTabletOutbox(readClubTabletOutbox().map((candidate) => (
    candidate.id === entryId ? { ...candidate, attempts: candidate.attempts + 1 } : candidate
  )));
}

function retryableClubTabletArtifactError(error: unknown) {
  return !(error instanceof ClubTabletRequestError)
    || error.status === 401
    || error.status === 403
    || error.status === 408
    || error.status === 429
    || error.status >= 500;
}

async function saveQueuedClubTabletArtifact(
  entry: ClubTabletOutboxEntry,
  credential: ClubTabletSessionCredential,
) {
  try {
    return await sendClubTabletOutboxEntry(entry, credential.sessionToken);
  } catch (error) {
    if (!retryableClubTabletArtifactError(error)) {
      writeClubTabletOutbox(readClubTabletOutbox().filter((candidate) => candidate.id !== entry.id));
      throw error;
    }
    incrementClubTabletOutboxAttempt(entry.id);
    return { queued: true } as const;
  }
}

function markClubTabletOutboxReleasePending(credential: ClubTabletSessionCredential) {
  let pending = 0;
  writeClubTabletOutbox(readClubTabletOutbox().map((entry) => {
    if (!outboxEntryMatchesSession(entry, credential)) return entry;
    pending += 1;
    return {
      ...entry,
      sessionToken: entry.sessionToken || credential.sessionToken,
      sessionExpiresAt: entry.sessionExpiresAt || credential.session.expiresAt,
      resultUploadToken: entry.resultUploadToken || credential.resultUploadToken || '',
      resultUploadExpiresAt: entry.resultUploadExpiresAt || credential.resultUploadExpiresAt || 0,
      releaseAfterFlush: true,
    };
  }));
  return pending;
}

export function pendingClubTabletReleaseCount() {
  const deviceId = readStoredClubTabletDevice()?.device.id;
  if (!deviceId) return 0;
  return readClubTabletOutbox().filter((entry) => (
    entry.deviceId === deviceId && entry.releaseAfterFlush
  )).length;
}

async function finishDeferredClubTabletRelease(entry: ClubTabletOutboxEntry) {
  if (!entry.releaseAfterFlush || !entry.sessionToken) return;
  const stillPending = readClubTabletOutbox().some((candidate) => (
    candidate.deviceId === entry.deviceId
    && candidate.sessionToken === entry.sessionToken
  ));
  if (stillPending) return;
  await tabletFetch('/api/club-tablet/sessions', {
    method: 'DELETE',
    headers: clubTabletSessionHeaders(entry.sessionToken),
  }).catch(() => undefined);
}

async function flushClubTabletOutboxNow(credential?: ClubTabletSessionCredential | null) {
  const device = readStoredClubTabletDevice();
  if (!device) return 0;
  if (credential && !clubTabletSessionMatchesCurrentDevice(credential)) return 0;
  let sent = 0;
  const activeCredential = credential ?? readStoredClubTabletSession();
  const candidates = readClubTabletOutbox().filter((entry) => (
    entry.deviceId === device.device.id
    && (!credential || outboxEntryMatchesSession(entry, credential))
  ));
  for (const entry of candidates) {
    if (!recordedBikeMetricsAreAccepted(entry.payload)) {
      writeClubTabletOutbox(readClubTabletOutbox().filter((candidate) => candidate.id !== entry.id));
      await finishDeferredClubTabletRelease(entry);
      continue;
    }
    const sessionToken = entry.sessionToken
      || (activeCredential && outboxEntryMatchesSession(entry, activeCredential)
        ? activeCredential.sessionToken
        : '');
    if (!sessionToken && !entry.resultUploadToken) continue;
    try {
      await sendClubTabletOutboxEntry(entry, sessionToken);
      sent += 1;
      await finishDeferredClubTabletRelease(entry);
    } catch {
      incrementClubTabletOutboxAttempt(entry.id);
      break;
    }
  }
  return sent;
}

let clubTabletOutboxFlushPromise: Promise<number> | null = null;

export function flushClubTabletOutbox(credential?: ClubTabletSessionCredential | null) {
  if (clubTabletOutboxFlushPromise) return clubTabletOutboxFlushPromise;
  clubTabletOutboxFlushPromise = flushClubTabletOutboxNow(credential)
    .finally(() => { clubTabletOutboxFlushPromise = null; });
  return clubTabletOutboxFlushPromise;
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
  return saveQueuedClubTabletArtifact(entry, credential);
}

export async function enrollClubTablet(name: string, clubId: string) {
  const safeName = text(name, 80);
  const safeClubId = text(clubId, 120);
  if (!safeClubId) throw new Error('TrackLab could not identify the owner club for this tablet.');
  const pendingCredential = pendingClubTabletCredential('enroll', '', safeName, safeClubId);
  if (pendingCredential) {
    // Revalidate the bearer before moving it into Keychain. An owner may have
    // revoked this row after the previous local write failed.
    await validatePendingClubTabletCredential(pendingCredential);
    return persistClubTabletCredential('enroll', pendingCredential, safeName);
  }
  const payload = await tabletFetch('/api/club-tablet/devices', {
    method: 'POST',
    body: JSON.stringify({ name: safeName }),
  });
  const credential = normalizeClubTabletDeviceCredential(payload);
  if (!credential) throw new Error('TrackLab returned an invalid tablet authorization.');
  // WKWebView data is origin-scoped and can be replaced when a native release
  // moves from hosted content to the packaged app. Keep the opaque enrollment
  // in the device-only native store as the durable source for future updates.
  return persistClubTabletCredential('enroll', credential, safeName);
}

export async function recoverClubTabletDevice(deviceId: string) {
  const safeDeviceId = text(deviceId, 120);
  if (!safeDeviceId) throw new Error('Choose the authorized tablet to restore.');
  const pendingCredential = pendingClubTabletCredential('recover', safeDeviceId);
  if (pendingCredential) {
    await validatePendingClubTabletCredential(pendingCredential);
    return persistClubTabletCredential('recover', pendingCredential);
  }
  const payload = await tabletFetch(`/api/club-tablet/devices/${encodeURIComponent(safeDeviceId)}/recover`, {
    method: 'POST',
  });
  const credential = normalizeClubTabletDeviceCredential(payload);
  if (!credential || credential.device.id !== safeDeviceId) {
    throw new Error('TrackLab returned an invalid tablet recovery.');
  }
  return persistClubTabletCredential('recover', credential);
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

export async function publishClubTabletBikePresence(
  bike: ClubTabletBikePresenceInput,
  credential = readStoredClubTabletDevice(),
  options: ClubTabletBikePresenceRequestOptions = {},
) {
  if (!credential) throw new Error('This tablet has not been authorized by the club owner.');
  const bikeDeviceId = Math.round(Number(bike.deviceId));
  const bikeLabel = text(bike.label, 120);
  if (!Number.isSafeInteger(bikeDeviceId) || bikeDeviceId <= 0 || !bikeLabel) {
    throw new Error('TrackLab could not identify the connected Wattbike.');
  }
  return tabletFetch('/api/club-tablet/bike-presence', {
    method: 'PUT',
    keepalive: options.keepalive,
    signal: options.signal,
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
    body: JSON.stringify({ bikeDeviceId, bikeLabel }),
  });
}

export async function clearClubTabletBikePresence(
  credential = readStoredClubTabletDevice(),
  options: ClubTabletBikePresenceRequestOptions = {},
) {
  if (!credential) return;
  await tabletFetch('/api/club-tablet/bike-presence', {
    method: 'DELETE',
    keepalive: options.keepalive,
    signal: options.signal,
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
  });
}

export async function claimClubTabletPickerWattbikeCapacity(
  credential = readStoredClubTabletDevice(),
  signal?: AbortSignal,
): Promise<ClubTabletPickerWattbikeCapacity> {
  if (!credential) throw new Error('This tablet has not been authorized by the club owner.');
  const payload = await tabletFetch('/api/club-tablet/wattbike-capacity', {
    method: 'PUT',
    signal,
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
  }) as Record<string, unknown>;
  const capacity = normalizeWattbikeCapacityMessage(payload.capacity);
  const expiresAt = positiveNumber(payload.expiresAt);
  const pollAfterMs = positiveNumber(payload.pollAfterMs);
  if (
    !capacity
    || capacity.requestedConnections !== 1
    || capacity.grantedConnections > 1
    || !expiresAt
    || !pollAfterMs
  ) {
    throw new Error('TrackLab returned an invalid Club Tablet Wattbike authorization.');
  }
  return {
    capacity,
    expiresAt,
    pollAfterMs: Math.max(2_000, Math.min(30_000, pollAfterMs)),
  };
}

export async function releaseClubTabletPickerWattbikeCapacity(
  credential = readStoredClubTabletDevice(),
  options: ClubTabletBikePresenceRequestOptions = {},
) {
  if (!credential) return false;
  const payload = await tabletFetch('/api/club-tablet/wattbike-capacity', {
    method: 'DELETE',
    keepalive: options.keepalive,
    signal: options.signal,
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
  }) as { released?: unknown };
  return payload.released === true;
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
    // An owner revoke is the one path that intentionally forgets the durable
    // native recovery hint as well as the current bearer.
    await forgetNativeClubTabletAuthorization().catch(() => undefined);
  }
}

export async function loadClubTabletRoster(
  credential = readStoredClubTabletDevice(),
  options: { signal?: AbortSignal } = {},
) {
  if (!credential) throw new Error('This tablet has not been authorized by the club owner.');
  const roster = normalizeClubTabletRoster(await tabletFetch('/api/club-tablet/roster', {
    signal: options.signal,
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
  // A previous athlete's durable result upload is independent of this new
  // interactive selection. Never make the next rider wait for that background
  // network request; the device-bound result token keeps the identities scoped.
  void flushClubTabletOutbox().catch(() => undefined);
  void flushClubTabletRecoveryOutbox({ keepalive: true }).catch(() => undefined);
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
    markClubTabletOutboxReleasePending(credential);
  } catch {
    // The completed artifact was already written before this handoff. A
    // storage-quota failure while marking the optional cleanup flag must not
    // keep the athlete or event seat selected on the server.
  }
  // Recovery finishes use the same original-athlete result capability as
  // recorded artifacts. Start any retained write before revoking the short
  // interactive bearer; it remains safe to finish after this DELETE.
  void flushClubTabletRecoveryOutbox({ keepalive: true }).catch(() => undefined);
  try {
    await tabletFetch('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: clubTabletSessionHeaders(credential.sessionToken),
    });
  } finally {
    clearStoredClubTabletSessionIfCurrent(credential);
    void flushClubTabletRecoveryOutbox({ keepalive: true }).catch(() => undefined);
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
  await saveQueuedClubTabletArtifact(entry, credential);
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
  await saveQueuedClubTabletArtifact(entry, credential);
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

/**
 * Opens the non-persistent multiplayer transport used by an authorized club
 * tablet while it is explicitly in demo mode. The exact in-memory device
 * credential must still match this browser's current authorization so an old
 * token cannot be revived after the tablet is restored or revoked.
 */
export async function requestClubTabletDemoMultiplayerTicket(
  credential = readStoredClubTabletDevice(),
  signal?: AbortSignal,
) {
  const current = readStoredClubTabletDevice();
  if (
    !credential
    || !current
    || current.device.id !== credential.device.id
    || current.device.clubId !== credential.device.clubId
    || current.deviceToken !== credential.deviceToken
  ) return null;
  const payload = await tabletFetch('/api/club-tablet/multiplayer-ticket', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${credential.deviceToken}` },
    body: JSON.stringify({ demo: true }),
  }) as { ticket?: unknown; expiresAt?: unknown };
  const ticket = text(payload.ticket, 2048);
  const expiresAt = positiveNumber(payload.expiresAt);
  if (!ticket || !expiresAt) {
    throw new Error('TrackLab returned an invalid demo multiplayer ticket.');
  }
  return { ticket, expiresAt };
}

/**
 * Revalidates (without extending) the selected athlete session and its
 * server-reserved Wattbike connection. Unlike refreshClubTabletSession this
 * must not keep an abandoned kiosk identity alive.
 */
export async function validateClubTabletSessionCapacity(
  credential = readStoredClubTabletSession(),
  signal?: AbortSignal,
) {
  if (!credential || !clubTabletSessionMatchesCurrentDevice(credential)) return false;
  await tabletFetch('/api/club-tablet/sessions', {
    signal,
    headers: clubTabletSessionHeaders(credential.sessionToken),
  });
  return true;
}

export function clubTabletAthleteDisplayName(athlete: ClubTabletAthlete | ClubTabletSession) {
  return text(athlete.athleteName, 80) || athlete.riderName;
}
