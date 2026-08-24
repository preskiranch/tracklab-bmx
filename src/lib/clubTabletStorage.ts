import { safeSetLocalStorage } from './browserStorage';
import { normalizeRiderPhotoDataUrl } from './riderPhotos';

export const clubTabletDeviceStorageKey = 'tracklab.club-tablet-device.v1';
export const clubTabletSessionStorageKey = 'tracklab.club-tablet-athlete-session.v1';
export const clubTabletOutboxStorageKey = 'tracklab.club-tablet-save-outbox.v1';
export const clubTabletSessionHeader = 'X-TrackLab-Club-Tablet-Session';

export type ClubTabletDevice = {
  id: string;
  name: string;
  clubId: string;
  clubName: string;
  createdAt?: number;
  lastSeenAt?: number;
  revokedAt?: number | null;
};

export type ClubTabletDeviceCredential = {
  device: ClubTabletDevice;
  deviceToken: string;
};

export type ClubTabletAthlete = {
  studioRiderId: string;
  riderName: string;
  athleteName: string | null;
  photoUrl?: string;
  status: 'claimed' | 'unclaimed';
  watchConnect?: ClubTabletWatchConnectStatus;
};

export type ClubTabletWatchConnectStatus = {
  recognized: boolean;
  state: 'not-set-up' | 'ready' | 'connected' | 'expired';
  connectedUntil: number | null;
  remainingMs: number;
  liveSharingEnabled: boolean;
};

export type ClubTabletRoster = {
  device: ClubTabletDevice;
  athletes: ClubTabletAthlete[];
};

export type ClubTabletSession = {
  clubId: string;
  clubName: string;
  studioRiderId: string;
  riderName: string;
  athleteName?: string | null;
  photoUrl?: string;
  bikeDeviceId: number;
  expiresAt: number;
};

export type ClubTabletSessionCredential = {
  /** Local enrollment that authorized this short-lived athlete identity. */
  deviceId: string;
  sessionToken: string;
  session: ClubTabletSession;
  heartbeatTtlMs: number;
  pollAfterMs: number;
};

export function clubTabletText(value: unknown, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function positiveClubTabletNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizeClubTabletDevice(value: unknown): ClubTabletDevice | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletDevice>;
  const id = clubTabletText(candidate.id, 120);
  const name = clubTabletText(candidate.name, 80);
  const clubId = clubTabletText(candidate.clubId, 120);
  const clubName = clubTabletText(candidate.clubName, 120);
  if (!id || !name || !clubId || !clubName) return null;
  const createdAt = positiveClubTabletNumber(candidate.createdAt);
  const lastSeenAt = positiveClubTabletNumber(candidate.lastSeenAt);
  const revokedAt = positiveClubTabletNumber(candidate.revokedAt);
  return {
    id,
    name,
    clubId,
    clubName,
    ...(createdAt ? { createdAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
  };
}

export function normalizeClubTabletDeviceCredential(value: unknown): ClubTabletDeviceCredential | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletDeviceCredential>;
  const device = normalizeClubTabletDevice(candidate.device);
  const deviceToken = clubTabletText(candidate.deviceToken, 2048);
  return device && deviceToken ? { device, deviceToken } : null;
}

function normalizeAthlete(value: unknown): ClubTabletAthlete | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletAthlete> & { claimed?: unknown };
  const studioRiderId = clubTabletText(candidate.studioRiderId, 120);
  const riderName = clubTabletText(candidate.riderName, 80);
  if (!studioRiderId || !riderName) return null;
  const athleteName = clubTabletText(candidate.athleteName, 80) || null;
  const photoUrl = normalizeRiderPhotoDataUrl(candidate.photoUrl);
  const status = candidate.status === 'claimed' || candidate.claimed === true ? 'claimed' : 'unclaimed';
  const watchConnect = status === 'claimed'
    ? normalizeClubTabletWatchConnectStatus(candidate.watchConnect)
    : null;
  return {
    studioRiderId,
    riderName,
    athleteName,
    ...(photoUrl ? { photoUrl } : {}),
    status,
    ...(watchConnect ? { watchConnect } : {}),
  };
}

export function normalizeClubTabletWatchConnectStatus(value: unknown): ClubTabletWatchConnectStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const state = item.state === 'not-set-up'
    || item.state === 'ready'
    || item.state === 'connected'
    || item.state === 'expired'
    ? item.state
    : null;
  const connectedUntilValue = item.connectedUntil == null ? null : Number(item.connectedUntil);
  const connectedUntil = connectedUntilValue == null
    ? null
    : Number.isFinite(connectedUntilValue) && connectedUntilValue >= 0
      ? Math.round(connectedUntilValue)
      : null;
  const remainingValue = Number(item.remainingMs);
  const remainingMs = Number.isFinite(remainingValue) && remainingValue >= 0
    ? Math.round(remainingValue)
    : null;
  if (
    !state
    || remainingMs == null
    || (state === 'connected' && connectedUntil == null)
    || (state !== 'connected' && item.connectedUntil != null && connectedUntil == null)
  ) return null;
  return {
    recognized: item.recognized === true,
    state,
    connectedUntil,
    remainingMs,
    // Older roster snapshots omit the field and therefore fail closed until
    // the exact athlete-session status endpoint confirms explicit consent.
    liveSharingEnabled: item.liveSharingEnabled === true,
  };
}

export function normalizeClubTabletRoster(value: unknown): ClubTabletRoster | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { device?: unknown; athletes?: unknown };
  const device = normalizeClubTabletDevice(candidate.device);
  if (!device || !Array.isArray(candidate.athletes)) return null;
  const athletes = candidate.athletes
    .flatMap((athlete) => {
      const normalized = normalizeAthlete(athlete);
      return normalized ? [normalized] : [];
    })
    .sort((left, right) => left.riderName.localeCompare(right.riderName, undefined, { sensitivity: 'base' }));
  return { device, athletes };
}

function normalizeSession(value: unknown): ClubTabletSession | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletSession>;
  const clubId = clubTabletText(candidate.clubId, 120);
  const clubName = clubTabletText(candidate.clubName, 120);
  const studioRiderId = clubTabletText(candidate.studioRiderId, 120);
  const riderName = clubTabletText(candidate.riderName, 80);
  const bikeDeviceId = positiveClubTabletNumber(candidate.bikeDeviceId);
  const expiresAt = positiveClubTabletNumber(candidate.expiresAt);
  if (!clubId || !clubName || !studioRiderId || !riderName || !bikeDeviceId || !expiresAt) return null;
  const athleteName = clubTabletText(candidate.athleteName, 80) || null;
  const photoUrl = normalizeRiderPhotoDataUrl(candidate.photoUrl);
  return {
    clubId,
    clubName,
    studioRiderId,
    riderName,
    athleteName,
    ...(photoUrl ? { photoUrl } : {}),
    bikeDeviceId,
    expiresAt,
  };
}

export function normalizeClubTabletSessionCredential(value: unknown): ClubTabletSessionCredential | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ClubTabletSessionCredential>;
  const deviceId = clubTabletText(candidate.deviceId, 120);
  const sessionToken = clubTabletText(candidate.sessionToken, 2048);
  const session = normalizeSession(candidate.session);
  if (!deviceId || !sessionToken || !session) return null;
  return {
    deviceId,
    sessionToken,
    session,
    heartbeatTtlMs: positiveClubTabletNumber(candidate.heartbeatTtlMs, 60_000),
    pollAfterMs: positiveClubTabletNumber(candidate.pollAfterMs, 15_000),
  };
}

function readStorage(storage: Storage | undefined, key: string) {
  if (!storage) return null;
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as unknown;
  } catch {
    return null;
  }
}

export function readStoredClubTabletDevice() {
  if (typeof window === 'undefined') return null;
  return normalizeClubTabletDeviceCredential(readStorage(window.localStorage, clubTabletDeviceStorageKey));
}

export function storeClubTabletDevice(credential: ClubTabletDeviceCredential) {
  safeSetLocalStorage(clubTabletDeviceStorageKey, JSON.stringify(credential));
}

export function clearStoredClubTabletDevice() {
  try {
    window.localStorage.removeItem(clubTabletDeviceStorageKey);
  } catch {
    // A blocked storage backend must not prevent the server-side authorization from ending.
  }
}

export function readStoredClubTabletSession() {
  if (typeof window === 'undefined') return null;
  const credential = normalizeClubTabletSessionCredential(
    readStorage(window.sessionStorage, clubTabletSessionStorageKey),
  );
  const device = readStoredClubTabletDevice();
  if (
    !credential
    || !device
    || credential.deviceId !== device.device.id
    || credential.session.clubId !== device.device.clubId
    || credential.session.expiresAt <= Date.now()
  ) {
    clearStoredClubTabletSession();
    return null;
  }
  return credential;
}

export function clubTabletSessionMatchesCurrentDevice(credential: ClubTabletSessionCredential | null | undefined) {
  if (!credential) return false;
  const device = readStoredClubTabletDevice();
  return Boolean(
    device
    && credential.deviceId === device.device.id
    && credential.session.clubId === device.device.clubId,
  );
}

export function storeClubTabletSession(credential: ClubTabletSessionCredential) {
  try {
    window.sessionStorage.setItem(clubTabletSessionStorageKey, JSON.stringify(credential));
  } catch {
    // The active React state still holds the short-lived identity if session storage is blocked.
  }
}

export function clearStoredClubTabletSession() {
  try {
    window.sessionStorage.removeItem(clubTabletSessionStorageKey);
    window.sessionStorage.removeItem(clubTabletOutboxStorageKey);
  } catch {
    // Ignore storage cleanup errors; server-side DELETE still revokes the identity.
    // Both values live in the same athlete-only sessionStorage scope so a shared
    // tablet never carries raw workout data into the next athlete's session.
  }
}

/**
 * Clears an athlete identity only while it is still the exact session that
 * initiated the cleanup. A delayed sign-out response for athlete A must never
 * erase athlete B after the shared tablet has already switched sessions.
 */
export function clearStoredClubTabletSessionIfCurrent(
  credential: ClubTabletSessionCredential | null | undefined,
) {
  if (!credential || typeof window === 'undefined') return false;
  const stored = normalizeClubTabletSessionCredential(
    readStorage(window.sessionStorage, clubTabletSessionStorageKey),
  );
  if (
    !stored
    || stored.deviceId !== credential.deviceId
    || stored.sessionToken !== credential.sessionToken
  ) return false;
  clearStoredClubTabletSession();
  return true;
}

export function currentClubTabletSessionToken() {
  return readStoredClubTabletSession()?.sessionToken ?? '';
}

export function clubTabletSessionHeaders(token = currentClubTabletSessionToken()): Record<string, string> {
  return token ? { [clubTabletSessionHeader]: token } : {};
}
