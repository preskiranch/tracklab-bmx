import type { PlayerSlot } from '../types';

export type ClubMonitorSprintBinding = Readonly<{
  clubId: string;
  studioRiderId: string;
  bikeDeviceId: number;
  sessionId: string;
  playerId: PlayerSlot['id'];
  startedAt: number;
}>;

export type ClubMonitorSprintReservation = Readonly<{
  clubId: string;
  studioRiderId: string;
  bikeDeviceId: number;
  sessionId: string;
  playerId: PlayerSlot['id'];
  /** Reservation clock only. The sprint clock starts later at the first watt. */
  armedAt: number;
}>;

export type ClubMonitorSprintMetrics = Readonly<{
  startedAt: number;
  endedAt: number;
  distanceMeters: number;
  averageWatts: number;
  peakWatts: number;
  averageCadence: number;
  peakCadence: number;
  averageSpeedKph: number;
  peakSpeedKph: number;
}>;

export type ClubMonitorSprintAuthorization = Readonly<{
  id: string;
  clubId: string;
  studioRiderId: string;
  bikeDeviceId: string;
  sessionId: string;
  playerId: PlayerSlot['id'];
  armedAt: number;
  startedAt: number | null;
  activatedAt: number | null;
  expiresAt: number;
}>;

export type AuthorizedClubMonitorSprint = Readonly<{
  authorization: ClubMonitorSprintAuthorization;
  /** One-use credential; callers must keep this in memory only. */
  saveToken: string;
}>;

export type ClubMonitorHeartRateSaveStatus =
  | 'created'
  | 'updated'
  | 'pending'
  | 'no-stream'
  | 'conflict'
  | 'not-club'
  | 'not-claimed'
  | 'unknown';

export type ClubMonitorSprintSaveResult = Readonly<{
  replayed: boolean;
  heartRate: Readonly<{ status: ClubMonitorHeartRateSaveStatus }>;
}>;

const clubMonitorHeartRateSaveStatuses = new Set<ClubMonitorHeartRateSaveStatus>([
  'created',
  'updated',
  'pending',
  'no-stream',
  'conflict',
  'not-club',
  'not-claimed',
]);

function normalizeClubMonitorHeartRateSaveStatus(value: unknown): ClubMonitorHeartRateSaveStatus {
  return typeof value === 'string'
    && clubMonitorHeartRateSaveStatuses.has(value as ClubMonitorHeartRateSaveStatus)
    ? value as ClubMonitorHeartRateSaveStatus
    : 'unknown';
}

function identifier(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/u.test(value.trim())
    ? value.trim()
    : '';
}

function timestamp(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function nullableTimestamp(value: unknown) {
  return value == null ? null : timestamp(value);
}

function normalizeAuthorization(value: unknown): ClubMonitorSprintAuthorization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = identifier(item.id);
  const clubId = identifier(item.clubId);
  const studioRiderId = identifier(item.studioRiderId);
  const sessionId = identifier(item.sessionId);
  const bikeDeviceId = typeof item.bikeDeviceId === 'string' && /^\d{1,16}$/u.test(item.bikeDeviceId)
    ? item.bikeDeviceId
    : '';
  const playerId = Number(item.playerId) as PlayerSlot['id'];
  // `armedAt ?? startedAt` keeps the brief one-phase compatibility window safe
  // while every new Monitor flow uses the two-phase reservation contract.
  const armedAt = timestamp(item.armedAt ?? item.startedAt);
  const startedAt = nullableTimestamp(item.startedAt);
  const activatedAt = nullableTimestamp(item.activatedAt);
  const expiresAt = timestamp(item.expiresAt);
  if (
    !id
    || !clubId
    || !studioRiderId
    || !sessionId
    || !bikeDeviceId
    || ![1, 2, 3, 4].includes(playerId)
    || armedAt == null
    || (item.startedAt != null && startedAt == null)
    || (item.activatedAt != null && activatedAt == null)
    || ((startedAt == null) !== (activatedAt == null))
    || (startedAt != null && startedAt < armedAt)
    || expiresAt == null
    || expiresAt <= armedAt
  ) return null;
  return {
    id,
    clubId,
    studioRiderId,
    bikeDeviceId,
    sessionId,
    playerId,
    armedAt,
    startedAt,
    activatedAt,
    expiresAt,
  };
}

async function monitorResponse<T>(response: Response, label: string) {
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `${label} returned ${response.status}`,
    );
  }
  return payload;
}

export async function authorizeClubMonitorSprint(
  binding: ClubMonitorSprintReservation | ClubMonitorSprintBinding,
): Promise<AuthorizedClubMonitorSprint> {
  const response = await fetch('/api/club-live/monitor-authorizations', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(binding),
  });
  const payload = await monitorResponse<{ authorization?: unknown; saveToken?: unknown }>(
    response,
    'Monitor View rider authorization',
  );
  const authorization = normalizeAuthorization(payload.authorization);
  const saveToken = typeof payload.saveToken === 'string' ? payload.saveToken.trim() : '';
  if (!authorization || !/^[a-zA-Z0-9_-]{40,180}$/u.test(saveToken)) {
    throw new Error('Monitor View rider authorization returned an invalid response.');
  }
  if (
    authorization.clubId !== binding.clubId
    || authorization.studioRiderId !== binding.studioRiderId
    || authorization.bikeDeviceId !== String(binding.bikeDeviceId)
    || authorization.sessionId !== binding.sessionId
    || authorization.playerId !== binding.playerId
    || authorization.armedAt !== ('armedAt' in binding ? binding.armedAt : binding.startedAt)
    || ('startedAt' in binding && authorization.startedAt !== binding.startedAt)
  ) {
    throw new Error('Monitor View rider authorization did not match the selected rider and Wattbike.');
  }
  return { authorization, saveToken };
}

/**
 * Atomically fixes the authoritative sprint clock to the first >=1W sample.
 * The one-use credential stays in memory and is returned for the final save.
 */
export async function activateAuthorizedClubMonitorSprint(
  authorized: AuthorizedClubMonitorSprint,
  startedAt: number,
): Promise<AuthorizedClubMonitorSprint> {
  if (!Number.isSafeInteger(startedAt) || startedAt < authorized.authorization.armedAt) {
    throw new Error('Choose a valid first-watt Monitor View sprint start.');
  }
  const response = await fetch(
    `/api/club-live/monitor-authorizations/${encodeURIComponent(authorized.authorization.id)}/activate`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-TrackLab-Monitor-Save-Token': authorized.saveToken,
      },
      body: JSON.stringify({ startedAt }),
    },
  );
  const payload = await monitorResponse<{ authorization?: unknown }>(
    response,
    'Monitor View first-watt activation',
  );
  const activation = normalizeAuthorization(payload.authorization);
  const reserved = authorized.authorization;
  if (
    !activation
    || activation.id !== reserved.id
    || activation.clubId !== reserved.clubId
    || activation.studioRiderId !== reserved.studioRiderId
    || activation.bikeDeviceId !== reserved.bikeDeviceId
    || activation.sessionId !== reserved.sessionId
    || activation.playerId !== reserved.playerId
    || activation.armedAt !== reserved.armedAt
    || activation.startedAt !== startedAt
    || activation.activatedAt == null
    || activation.expiresAt !== reserved.expiresAt
  ) {
    throw new Error('Monitor View first-watt activation did not match its reserved rider and Wattbike.');
  }
  return { authorization: activation, saveToken: authorized.saveToken };
}

export async function cancelClubMonitorSprintAuthorization(
  authorizationId: string,
  options: { keepalive?: boolean } = {},
) {
  const response = await fetch('/api/club-live/monitor-authorizations', {
    method: 'DELETE',
    keepalive: options.keepalive,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorizationId }),
  });
  await monitorResponse(response, 'Monitor View rider authorization cancellation');
}

export async function saveAuthorizedClubMonitorSprint(
  binding: ClubMonitorSprintBinding,
  result: ClubMonitorSprintMetrics,
  saveToken: string,
) {
  const response = await fetch('/api/club-live/monitor-training-sessions', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-TrackLab-Monitor-Save-Token': saveToken,
    },
    body: JSON.stringify({ ...binding, result }),
  });
  const payload = await monitorResponse<{
    replayed?: unknown;
    heartRate?: { status?: unknown };
  }>(response, 'Monitor View athlete history save');
  return {
    replayed: payload.replayed === true,
    heartRate: {
      status: normalizeClubMonitorHeartRateSaveStatus(payload.heartRate?.status),
    },
  } satisfies ClubMonitorSprintSaveResult;
}
