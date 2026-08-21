/**
 * Watch Connect is intentionally account/profile based. A Wattbike can be
 * disconnected, replaced, or re-indexed without changing the athlete's
 * trusted Watch or the four-hour connection that is already running.
 */
export const watchConnectSessionDurationMs = 4 * 60 * 60 * 1_000;

export type WatchConnectScope = 'personal' | 'studio';

export type WatchConnectEnrollment = Readonly<{
  id: string;
  scope: WatchConnectScope;
  clubId: string | null;
  studioRiderId: string | null;
  state: 'trusted' | 'revoked' | 'membership-required';
  liveStudioConsent: boolean;
  sessionStudioConsent: boolean;
  createdAt: number;
  updatedAt: number;
}>;

export type WatchConnectConnectionState =
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'stopped'
  | 'revoked'
  | 'membership-required';

export type WatchConnectConnection = Readonly<{
  id: string;
  enrollmentId: string;
  scope: WatchConnectScope;
  clubId: string | null;
  studioRiderId: string | null;
  state: WatchConnectConnectionState;
  connectedAt: number;
  connectedUntil: number;
  remainingMs: number;
  liveStudioConsent: boolean;
  sessionStudioConsent: boolean;
}>;

export type WatchConnectNativeState = Readonly<{
  state:
    | 'inactive'
    | 'connecting'
    | 'connected'
    | 'syncing'
    | 'reconnect'
    | 'disconnecting'
    | 'error';
  scope?: WatchConnectScope | null;
  connectionId: string | null;
  sessionId?: string | null;
  connectedUntil: number | null;
  remainingMs: number;
  requiresUserStart: boolean;
  reason?: string;
}>;

export type WatchConnectPhase =
  | 'connect'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'ended';

export type WatchConnectViewState = Readonly<{
  phase: WatchConnectPhase;
  connectedUntil: number | null;
  remainingMs: number;
  detail: string;
}>;

export type WatchConnectStartPlan = Readonly<{
  action: 'enroll-and-connect' | 'connect' | 'reuse';
  enrollmentId: string | null;
  connectionId: string | null;
}>;

function finiteTimestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

export function watchConnectRemainingMs(connectedUntil: unknown, now = Date.now()) {
  const end = finiteTimestamp(connectedUntil);
  const current = finiteTimestamp(now);
  return end == null || current == null ? 0 : Math.max(0, end - current);
}

export function formatWatchConnectTimeRemaining(remainingMs: number) {
  const totalMinutes = Math.max(1, Math.ceil(Math.max(0, remainingMs) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m left`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m left`;
}

export function watchConnectStatusLabel(state: WatchConnectViewState) {
  if (state.phase === 'connect') return 'Watch Connect';
  if (state.phase === 'connecting') return 'Connecting…';
  if (state.phase === 'connected') {
    return `Connected · ${formatWatchConnectTimeRemaining(state.remainingMs)}`;
  }
  if (state.phase === 'syncing') return 'Syncing…';
  return 'Session ended';
}

/**
 * Chooses the next single-button action. An expired four-hour connection does
 * not delete enrollment, so the next press creates a fresh session without
 * repeating Apple Health or studio setup.
 */
export function planWatchConnectStart({
  enrollment,
  connection,
  now = Date.now(),
}: {
  enrollment: WatchConnectEnrollment | null;
  connection: WatchConnectConnection | null;
  now?: number;
}): WatchConnectStartPlan {
  const trusted = enrollment?.state === 'trusted';
  const active = trusted
    && connection?.enrollmentId === enrollment.id
    && connection.state === 'connected'
    && watchConnectRemainingMs(connection.connectedUntil, now) > 0;
  if (active) {
    return {
      action: 'reuse',
      enrollmentId: enrollment.id,
      connectionId: connection.id,
    };
  }
  if (trusted) {
    return {
      action: 'connect',
      enrollmentId: enrollment.id,
      connectionId: null,
    };
  }
  return { action: 'enroll-and-connect', enrollmentId: null, connectionId: null };
}

/**
 * Combines server-authoritative expiry with optional paired-iPhone state. On a
 * studio tablet nativeState is null; the tablet still recognizes the exact
 * athlete's server connection.
 */
export function resolveWatchConnectViewState({
  enrollment,
  connection,
  nativeState = null,
  requiresNativeMatch = false,
  busy = false,
  now = Date.now(),
}: {
  enrollment: WatchConnectEnrollment | null;
  connection: WatchConnectConnection | null;
  nativeState?: WatchConnectNativeState | null;
  requiresNativeMatch?: boolean;
  busy?: boolean;
  now?: number;
}): WatchConnectViewState {
  const trusted = enrollment?.state === 'trusted';
  const remainingMs = connection?.state === 'connected'
    ? watchConnectRemainingMs(connection.connectedUntil, now)
    : 0;
  const connected = Boolean(
    trusted
    && connection?.enrollmentId === enrollment?.id
    && connection?.state === 'connected'
    && remainingMs > 0,
  );

  const finalizedDrain = trusted
    && connection != null
    && (nativeState?.state === 'syncing' || nativeState?.state === 'disconnecting')
    && nativeState.scope === connection.scope
    && nativeState.connectionId === connection.id
    && nativeState.sessionId === `watch-connect:${connection.id}`
    && nativeState.connectedUntil === connection.connectedUntil
    && (
      !['connecting', 'connected'].includes(connection.state)
      || watchConnectRemainingMs(connection.connectedUntil, now) === 0
    );
  if (finalizedDrain) {
    return {
      phase: 'ended',
      connectedUntil: connection.connectedUntil,
      remainingMs: 0,
      detail: 'Previous session is syncing privately. Press Watch Connect to start a new four-hour session.',
    };
  }
  if (nativeState?.state === 'syncing' || nativeState?.state === 'disconnecting') {
    return {
      phase: 'syncing',
      connectedUntil: connection?.connectedUntil ?? nativeState.connectedUntil,
      remainingMs,
      detail: 'Keep TrackLab open on the paired iPhone until heart rate finishes syncing.',
    };
  }
  if (busy || nativeState?.state === 'connecting') {
    return {
      phase: 'connecting',
      connectedUntil: connection?.connectedUntil ?? null,
      remainingMs,
      detail: 'Keep the paired iPhone and Apple Watch nearby while TrackLab connects.',
    };
  }
  if (
    connection?.state === 'connecting'
    && (
      nativeState == null
      || (
        nativeState.state === 'connected'
        && nativeState.scope === connection.scope
        && nativeState.connectionId === connection.id
        && nativeState.sessionId === `watch-connect:${connection.id}`
        && nativeState.connectedUntil === connection.connectedUntil
      )
    )
  ) {
    return {
      phase: 'connecting',
      connectedUntil: connection.connectedUntil,
      remainingMs: watchConnectRemainingMs(connection.connectedUntil, now),
      detail: 'Watch is recording; waiting for sync.',
    };
  }
  const nativeMatches = !requiresNativeMatch || Boolean(
    nativeState?.state === 'connected'
    && nativeState.scope === connection?.scope
    && nativeState.connectionId === connection?.id
    && nativeState.sessionId === `watch-connect:${connection?.id}`
    && nativeState.connectedUntil === connection?.connectedUntil,
  );
  if (
    connected
    && nativeMatches
    && nativeState?.state !== 'error'
    && nativeState?.state !== 'reconnect'
  ) {
    return {
      phase: 'connected',
      connectedUntil: connection!.connectedUntil,
      remainingMs,
      detail: 'Ready for every TrackLab program during this four-hour session.',
    };
  }
  if (
    trusted
    && (
      connection != null
      || nativeState?.state === 'error'
      || nativeState?.state === 'reconnect'
    )
  ) {
    return {
      phase: 'ended',
      connectedUntil: connection?.connectedUntil ?? nativeState?.connectedUntil ?? null,
      remainingMs: 0,
      detail: 'Press Watch Connect to start a new four-hour session. Setup does not repeat.',
    };
  }
  return {
    phase: 'connect',
    connectedUntil: null,
    remainingMs: 0,
    detail: 'Press once to connect this Watch for four hours.',
  };
}

/**
 * Owner/tablet recognition must use the claimed studio profile ID. Display
 * names and bike assignments are intentionally not inputs.
 */
export function watchConnectForStudioRider(
  clubId: string | null | undefined,
  studioRiderId: string | null | undefined,
  connections: readonly WatchConnectConnection[],
  now = Date.now(),
) {
  const normalizedClubId = clubId?.trim() ?? '';
  const normalizedRiderId = studioRiderId?.trim() ?? '';
  if (!normalizedClubId || !normalizedRiderId) return null;
  return [...connections]
    .filter((connection) => (
      connection.scope === 'studio'
      && connection.clubId === normalizedClubId
      && connection.studioRiderId === normalizedRiderId
      && connection.state === 'connected'
      && watchConnectRemainingMs(connection.connectedUntil, now) > 0
    ))
    .sort((left, right) => right.connectedUntil - left.connectedUntil)[0] ?? null;
}
