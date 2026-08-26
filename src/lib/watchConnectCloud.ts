import {
  watchConnectSessionDurationMs,
  type WatchConnectConnection,
  type WatchConnectConnectionState,
  type WatchConnectEnrollment,
  type WatchConnectScope,
} from './watchConnect';
import {
  clubTabletSessionHeader,
  normalizeClubTabletWatchConnectStatus,
} from './clubTabletStorage';

export type WatchConnectCredentials = Readonly<{
  connectionId: string;
  pairingId: string;
  relaySessionId: string;
  ingestToken: string;
  expiresAt: number;
}>;

export type WatchConnectEnrollmentInput = Readonly<{
  requestId: string;
  installId: string;
  scope: WatchConnectScope;
  clubId?: string;
  liveStudioConsent?: boolean;
  sessionStudioConsent?: boolean;
}>;

export type WatchConnectConnectionInput = Readonly<{
  requestId: string;
  enrollmentId: string;
  installId: string;
}>;

export type WatchConnectStudioProjectionState =
  | 'not-set-up'
  | 'ready'
  | 'connected'
  | 'expired'
  | 'membership-required';

export type WatchConnectStudioProjection = Readonly<{
  clubId: string;
  studioRiderId: string;
  riderName: string;
  state: WatchConnectStudioProjectionState;
  enrollment: WatchConnectEnrollment | null;
  connection: WatchConnectConnection | null;
}>;

export type WatchConnectCloudSnapshot = Readonly<{
  enrollments: readonly WatchConnectEnrollment[];
  connections: readonly WatchConnectConnection[];
}>;

const enrollmentStates = new Set<WatchConnectEnrollment['state']>([
  'trusted',
  'revoked',
  'membership-required',
]);
const connectionStates = new Set<WatchConnectConnectionState>([
  'connecting',
  'connected',
  'expired',
  'stopped',
  'revoked',
  'membership-required',
]);
const studioProjectionStates = new Set<WatchConnectStudioProjectionState>([
  'not-set-up',
  'ready',
  'connected',
  'expired',
  'membership-required',
]);

function identifier(value: unknown, maximumLength = 160) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

function timestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function scope(value: unknown): WatchConnectScope | null {
  return value === 'personal' || value === 'studio' ? value : null;
}

function nullableIdentifier(value: unknown) {
  if (value == null) return null;
  return identifier(value) || null;
}

function validRequestId(value: string) {
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{24,160}$/u.test(normalized) ? normalized : '';
}

export function normalizeWatchConnectInstallId(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^wci_[a-f0-9]{64}$/u.test(normalized) ? normalized : '';
}

export function normalizeWatchConnectEnrollment(value: unknown): WatchConnectEnrollment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const normalizedScope = scope(item.scope);
  const clubId = nullableIdentifier(item.clubId);
  const studioRiderId = nullableIdentifier(item.studioRiderId);
  const state = enrollmentStates.has(item.state as WatchConnectEnrollment['state'])
    ? item.state as WatchConnectEnrollment['state']
    : null;
  const createdAt = timestamp(item.createdAt);
  const updatedAt = timestamp(item.updatedAt);
  if (
    !id
    || !normalizedScope
    || !state
    || createdAt == null
    || updatedAt == null
    || updatedAt < createdAt
    || (normalizedScope === 'personal' && (clubId != null || studioRiderId != null))
    || (normalizedScope === 'studio' && (!clubId || !studioRiderId))
  ) return null;
  return {
    id,
    scope: normalizedScope,
    clubId,
    studioRiderId,
    state,
    liveStudioConsent: normalizedScope === 'studio' && item.liveStudioConsent === true,
    sessionStudioConsent: normalizedScope === 'studio' && item.sessionStudioConsent === true,
    createdAt,
    updatedAt,
  };
}

export function normalizeWatchConnectConnection(value: unknown): WatchConnectConnection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const enrollmentId = identifier(item.enrollmentId);
  const normalizedScope = scope(item.scope);
  const clubId = nullableIdentifier(item.clubId);
  const studioRiderId = nullableIdentifier(item.studioRiderId);
  const state = connectionStates.has(item.state as WatchConnectConnectionState)
    ? item.state as WatchConnectConnectionState
    : null;
  const connectedAt = timestamp(item.connectedAt);
  const connectedUntil = timestamp(item.connectedUntil);
  const remainingMs = timestamp(item.remainingMs);
  if (
    !id
    || !enrollmentId
    || !normalizedScope
    || !state
    || connectedAt == null
    || connectedUntil == null
    || connectedUntil - connectedAt !== watchConnectSessionDurationMs
    || remainingMs == null
    || remainingMs > watchConnectSessionDurationMs
    || (normalizedScope === 'personal' && (clubId != null || studioRiderId != null))
    || (normalizedScope === 'studio' && (!clubId || !studioRiderId))
  ) return null;
  return {
    id,
    enrollmentId,
    scope: normalizedScope,
    clubId,
    studioRiderId,
    state,
    connectedAt,
    connectedUntil,
    remainingMs,
    liveStudioConsent: normalizedScope === 'studio' && item.liveStudioConsent === true,
    sessionStudioConsent: normalizedScope === 'studio' && item.sessionStudioConsent === true,
  };
}

export function normalizeWatchConnectCredentials(
  value: unknown,
  connection: WatchConnectConnection,
): WatchConnectCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const connectionId = identifier(item.connectionId);
  const pairingId = identifier(item.pairingId);
  const relaySessionId = identifier(item.relaySessionId);
  const ingestToken = identifier(item.ingestToken, 1_024);
  const expiresAt = timestamp(item.expiresAt);
  if (
    connectionId !== connection.id
    || !pairingId
    || relaySessionId !== `watch-connect:${connection.id}`
    || !ingestToken
    || expiresAt !== connection.connectedUntil
  ) return null;
  return { connectionId, pairingId, relaySessionId, ingestToken, expiresAt };
}

export function normalizeWatchConnectStudioProjection(value: unknown): WatchConnectStudioProjection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const clubId = identifier(item.clubId);
  const studioRiderId = identifier(item.studioRiderId);
  const riderName = identifier(item.riderName, 120);
  const state = studioProjectionStates.has(item.state as WatchConnectStudioProjectionState)
    ? item.state as WatchConnectStudioProjectionState
    : null;
  const enrollment = item.enrollment == null ? null : normalizeWatchConnectEnrollment(item.enrollment);
  const connection = item.connection == null ? null : normalizeWatchConnectConnection(item.connection);
  if (
    !clubId
    || !studioRiderId
    || !riderName
    || !state
    || (enrollment && (
      enrollment.scope !== 'studio'
      || enrollment.clubId !== clubId
      || enrollment.studioRiderId !== studioRiderId
    ))
    || (connection && (
      connection.scope !== 'studio'
      || connection.clubId !== clubId
      || connection.studioRiderId !== studioRiderId
      || connection.enrollmentId !== enrollment?.id
    ))
  ) return null;
  return { clubId, studioRiderId, riderName, state, enrollment, connection };
}

async function responseJson<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `${label} returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function loadWatchConnect(): Promise<WatchConnectCloudSnapshot> {
  const response = await fetch('/api/heart-rate/watch-connect', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await responseJson<{ enrollments?: unknown; connections?: unknown }>(
    response,
    'Watch Connect status',
  );
  return {
    enrollments: Array.isArray(payload.enrollments)
      ? payload.enrollments.flatMap((item) => {
        const normalized = normalizeWatchConnectEnrollment(item);
        return normalized ? [normalized] : [];
      })
      : [],
    connections: Array.isArray(payload.connections)
      ? payload.connections.flatMap((item) => {
        const normalized = normalizeWatchConnectConnection(item);
        return normalized ? [normalized] : [];
      })
      : [],
  };
}

export async function enrollWatchConnect(input: WatchConnectEnrollmentInput) {
  const requestId = validRequestId(input.requestId);
  const installId = normalizeWatchConnectInstallId(input.installId);
  const clubId = input.scope === 'studio' ? identifier(input.clubId) : '';
  if (!requestId || !installId || (input.scope === 'studio' && !clubId)) {
    throw new Error('Watch Connect needs a valid paired iPhone and request. Retry on that iPhone.');
  }
  const response = await fetch('/api/heart-rate/watch-connect/enrollments', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId,
      installId,
      scope: input.scope,
      ...(clubId ? { clubId } : {}),
      ...(input.scope === 'studio' ? {
        liveStudioConsent: input.liveStudioConsent === true,
        sessionStudioConsent: input.sessionStudioConsent === true,
      } : {}),
    }),
  });
  const payload = await responseJson<{ enrollment?: unknown; replayed?: unknown }>(
    response,
    'Watch Connect setup',
  );
  const enrollment = normalizeWatchConnectEnrollment(payload.enrollment);
  if (
    !enrollment
    || enrollment.scope !== input.scope
    || (input.scope === 'studio' && enrollment.clubId !== clubId)
    || (input.scope === 'studio' && (
      enrollment.liveStudioConsent !== (input.liveStudioConsent === true)
      || enrollment.sessionStudioConsent !== (input.sessionStudioConsent === true)
    ))
  ) throw new Error('Watch Connect setup returned an invalid response.');
  return { enrollment, replayed: payload.replayed === true };
}

/** Credentials are returned only for immediate native configuration. */
export async function createWatchConnectConnection(input: WatchConnectConnectionInput) {
  const requestId = validRequestId(input.requestId);
  const enrollmentId = identifier(input.enrollmentId);
  const installId = normalizeWatchConnectInstallId(input.installId);
  if (!requestId || !enrollmentId || !installId) {
    throw new Error('Watch Connect needs a valid trusted Watch and request.');
  }
  const response = await fetch('/api/heart-rate/watch-connect/connections', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, enrollmentId, installId }),
  });
  const payload = await responseJson<{
    connection?: unknown;
    credentials?: unknown;
    replayed?: unknown;
  }>(response, 'Watch Connect');
  const connection = normalizeWatchConnectConnection(payload.connection);
  const credentials = connection
    ? normalizeWatchConnectCredentials(payload.credentials, connection)
    : null;
  if (!connection || !credentials || connection.enrollmentId !== enrollmentId) {
    throw new Error('Watch Connect returned an invalid response.');
  }
  return { connection, credentials, replayed: payload.replayed === true };
}

export async function disconnectWatchConnectConnection(connectionId: string) {
  const normalizedId = identifier(connectionId);
  if (!normalizedId) throw new Error('Choose a valid Watch Connect session.');
  const response = await fetch(
    `/api/heart-rate/watch-connect/connections/${encodeURIComponent(normalizedId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  const payload = await responseJson<{ connection?: unknown }>(response, 'Watch Connect disconnect');
  const connection = normalizeWatchConnectConnection(payload.connection);
  if (!connection || connection.id !== normalizedId || connection.state !== 'stopped') {
    throw new Error('Watch Connect disconnect returned an invalid response.');
  }
  return connection;
}

export async function forgetWatchConnectEnrollment(enrollmentId: string) {
  const normalizedId = identifier(enrollmentId);
  if (!normalizedId) throw new Error('Choose a valid remembered Watch.');
  const response = await fetch(
    `/api/heart-rate/watch-connect/enrollments/${encodeURIComponent(normalizedId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  const payload = await responseJson<{ enrollment?: unknown }>(response, 'Watch Connect removal');
  const enrollment = normalizeWatchConnectEnrollment(payload.enrollment);
  if (!enrollment || enrollment.id !== normalizedId || enrollment.state !== 'revoked') {
    throw new Error('Watch Connect removal returned an invalid response.');
  }
  return enrollment;
}

export async function loadStudioWatchConnect(clubId: string) {
  const normalizedClubId = identifier(clubId);
  if (!normalizedClubId) throw new Error('Choose a valid studio.');
  const params = new URLSearchParams({ clubId: normalizedClubId });
  const response = await fetch(`/api/heart-rate/watch-connect/studio?${params}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const payload = await responseJson<{ athletes?: unknown; connections?: unknown }>(
    response,
    'Studio Watch Connect status',
  );
  const values = Array.isArray(payload.athletes)
    ? payload.athletes
    : Array.isArray(payload.connections)
      ? payload.connections
      : [];
  return values.flatMap((item) => {
    const normalized = normalizeWatchConnectStudioProjection(item);
    return normalized && normalized.clubId === normalizedClubId ? [normalized] : [];
  });
}

export async function disconnectStudioWatchConnectEnrollment(
  clubId: string,
  enrollmentId: string,
) {
  const normalizedClubId = identifier(clubId);
  const normalizedEnrollmentId = identifier(enrollmentId);
  if (!normalizedClubId || !normalizedEnrollmentId) {
    throw new Error('Choose a valid studio athlete Watch.');
  }
  const params = new URLSearchParams({ clubId: normalizedClubId });
  const response = await fetch(
    `/api/heart-rate/watch-connect/studio/enrollments/${encodeURIComponent(normalizedEnrollmentId)}?${params}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  const payload = await responseJson<{ athlete?: unknown }>(response, 'Studio Watch disconnect');
  const athlete = normalizeWatchConnectStudioProjection(payload.athlete);
  if (
    !athlete
    || athlete.clubId !== normalizedClubId
    || athlete.state !== 'not-set-up'
    || athlete.enrollment?.id !== normalizedEnrollmentId
    || athlete.enrollment.state !== 'revoked'
    || athlete.enrollment.liveStudioConsent
    || athlete.enrollment.sessionStudioConsent
    || athlete.connection?.state !== 'revoked'
    || athlete.connection.liveStudioConsent
    || athlete.connection.sessionStudioConsent
  ) throw new Error('Studio Watch disconnect returned an invalid response.');
  return athlete;
}

export async function loadClubTabletWatchConnectStatus(sessionToken: string) {
  const token = identifier(sessionToken, 2_048);
  if (!token) throw new Error('Choose the athlete on this tablet again.');
  const response = await fetch('/api/heart-rate/watch-connect/tablet-status', {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      [clubTabletSessionHeader]: token,
    },
  });
  const payload = await responseJson<{ watchConnect?: unknown }>(
    response,
    'Tablet Watch Connect status',
  );
  const status = normalizeClubTabletWatchConnectStatus(payload.watchConnect);
  if (!status) throw new Error('Tablet Watch Connect returned an invalid status.');
  return status;
}
