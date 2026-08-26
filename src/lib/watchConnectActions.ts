import type { WatchConnectConnection, WatchConnectEnrollment, WatchConnectScope } from './watchConnect';
import {
  createWatchConnectConnection,
  disconnectWatchConnectConnection,
  enrollWatchConnect,
  type WatchConnectCredentials,
  loadWatchConnect,
} from './watchConnectCloud';

export type WatchConnectIdentity = Readonly<{
  version: 1;
  installId: string;
}>;

export type WatchConnectNativeStartInput = WatchConnectCredentials & Readonly<{
  baseUrl: string;
  scope: WatchConnectScope;
}>;

export type WatchConnectNativeResult = Readonly<{
  state: 'inactive' | 'connecting' | 'connected' | 'syncing' | 'reconnect' | 'disconnecting' | 'error';
  scope: WatchConnectScope | null;
  connectionId: string | null;
  sessionId: string | null;
  connectedUntil: number | null;
  remainingMs: number;
  requiresUserStart: boolean;
  workoutReady: boolean;
  relayConfigured: boolean;
  reason?: string;
}>;

export type WatchConnectActionDependencies = Readonly<{
  getIdentity: () => Promise<WatchConnectIdentity>;
  getNativeState?: () => Promise<WatchConnectNativeResult>;
  /**
   * Publishes the credential-free server identity before native iOS starts.
   * The coordinator uses this exact connection to recognize the synchronous
   * `connecting` status that startNative may emit before its promise resolves.
   */
  onConnectionCreated?: (prepared: Readonly<{
    enrollment: WatchConnectEnrollment;
    connection: WatchConnectConnection;
    pairingId: string;
  }>) => void;
  startNative: (input: WatchConnectNativeStartInput) => Promise<WatchConnectNativeResult>;
  stopNative: () => Promise<WatchConnectNativeResult>;
  enroll?: typeof enrollWatchConnect;
  createConnection?: typeof createWatchConnectConnection;
  disconnectConnection?: typeof disconnectWatchConnectConnection;
}>;

export type StartWatchConnectInput = Readonly<{
  scope: WatchConnectScope;
  baseUrl: string;
  clubId?: string;
  existingEnrollment?: WatchConnectEnrollment;
  liveStudioConsent?: boolean;
  sessionStudioConsent?: boolean;
  enrollmentRequestId: string;
  connectionRequestId: string;
}>;

export class WatchConnectStartError extends Error {
  /** True when retrying the same IDs is necessary to recover an ambiguous response. */
  readonly reuseRequestIds: boolean;

  constructor(message: string, reuseRequestIds: boolean, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WatchConnectStartError';
    this.reuseRequestIds = reuseRequestIds;
  }
}

export function runWatchConnectSingleFlight<T>(
  holder: { current: Promise<T> | null },
  action: () => Promise<T>,
) {
  if (holder.current) return holder.current;
  const operation = action();
  holder.current = operation;
  void operation.finally(() => {
    if (holder.current === operation) holder.current = null;
  }).catch(() => undefined);
  return operation;
}

function startError(error: unknown, reuseRequestIds: boolean) {
  if (error instanceof WatchConnectStartError) return error;
  return new WatchConnectStartError(
    error instanceof Error ? error.message : String(error),
    reuseRequestIds,
    error,
  );
}

export function createWatchConnectRequestId(prefix = 'watch-connect') {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Watch Connect needs secure request support on this device.');
  }
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * The only first-use action. The server reuses trusted enrollment and active
 * connections, while native iOS reuses Health authorization, so every later
 * four-hour start is still the same single press.
 */
export async function startWatchConnectAction(
  input: StartWatchConnectInput,
  dependencies: WatchConnectActionDependencies,
): Promise<Readonly<{
  enrollment: WatchConnectEnrollment;
  connection: WatchConnectConnection;
  pairingId: string;
  native: WatchConnectNativeResult;
}>> {
  if (input.scope === 'studio' && input.sessionStudioConsent !== true) {
    throw new Error('Approve Training summaries before using Watch Connect with this studio.');
  }
  if (input.existingEnrollment && (
    input.existingEnrollment.state !== 'trusted'
    || input.existingEnrollment.scope !== input.scope
    || input.existingEnrollment.clubId !== (input.clubId ?? null)
  )) {
    throw new Error('Watch Connect could not reuse this saved setup.');
  }
  let identity: WatchConnectIdentity;
  try {
    identity = await dependencies.getIdentity();
  } catch (error) {
    throw startError(error, true);
  }
  const enroll = dependencies.enroll ?? enrollWatchConnect;
  const createConnection = dependencies.createConnection ?? createWatchConnectConnection;
  let enrolled: Awaited<ReturnType<typeof enroll>>;
  if (input.existingEnrollment) {
    enrolled = { enrollment: input.existingEnrollment, replayed: true };
  } else {
    try {
      enrolled = await enroll({
        requestId: input.enrollmentRequestId,
        installId: identity.installId,
        scope: input.scope,
        ...(input.clubId ? { clubId: input.clubId } : {}),
        ...(input.scope === 'studio' ? {
          liveStudioConsent: input.liveStudioConsent === true,
          sessionStudioConsent: true,
        } : {}),
      });
    } catch (error) {
      throw startError(error, true);
    }
  }
  let started: Awaited<ReturnType<typeof createConnection>>;
  try {
    started = await createConnection({
      requestId: input.connectionRequestId,
      enrollmentId: enrolled.enrollment.id,
      installId: identity.installId,
    });
  } catch (error) {
    throw startError(error, true);
  }
  // Native start can synchronously publish `connecting` through the Capacitor
  // listener before startNative resolves. Expose only the non-secret server
  // identity first so that status is recognized as this account's new start,
  // never mistaken for an earlier account that needs privacy cleanup.
  dependencies.onConnectionCreated?.({
    enrollment: enrolled.enrollment,
    connection: started.connection,
    pairingId: started.credentials.pairingId,
  });
  let native: WatchConnectNativeResult | null = null;
  try {
    native = await dependencies.startNative({
      ...started.credentials,
      baseUrl: input.baseUrl,
      scope: input.scope,
    });
    if (
      native.state !== 'connected'
      || !native.workoutReady
      || !native.relayConfigured
      || native.scope !== input.scope
      || native.connectionId !== started.connection.id
      || native.sessionId !== started.credentials.relaySessionId
      || native.connectedUntil !== started.connection.connectedUntil
    ) {
      throw new Error(native.reason || 'Watch Connect could not start on the paired Apple Watch.');
    }
  } catch (error) {
    const observed = native ?? await dependencies.getNativeState?.().catch(() => null) ?? null;
    if (observed?.connectionId === started.connection.id) {
      await dependencies.stopNative().catch(() => undefined);
    }
    const disconnect = dependencies.disconnectConnection ?? disconnectWatchConnectConnection;
    await disconnect(started.connection.id).catch(() => undefined);
    throw startError(error, false);
  }
  return {
    enrollment: enrolled.enrollment,
    connection: started.connection,
    pairingId: started.credentials.pairingId,
    native,
  };
}

export type StopWatchConnectResult = Readonly<{
  pendingSync: boolean;
  connection: WatchConnectConnection;
}>;

export type UpdateWatchConnectStudioConsentInput = Readonly<{
  enrollment: WatchConnectEnrollment;
  liveStudioConsent: boolean;
  enrollmentRequestId: string;
}>;

/**
 * Refreshes consent on the exact remembered studio enrollment. The existing
 * enrollment POST is intentionally reused so the server can atomically copy
 * the new choice to an active Watch pairing and stream without exposing any
 * relay credentials to JavaScript.
 */
export async function updateWatchConnectStudioConsentAction(
  input: UpdateWatchConnectStudioConsentInput,
  dependencies: Pick<WatchConnectActionDependencies, 'getIdentity' | 'enroll'>,
) {
  const current = input.enrollment;
  if (
    current.state !== 'trusted'
    || current.scope !== 'studio'
    || !current.clubId
    || !current.studioRiderId
    || current.sessionStudioConsent !== true
  ) {
    throw new Error('Choose a valid remembered studio Watch before changing Live BPM sharing.');
  }
  const identity = await dependencies.getIdentity();
  const enroll = dependencies.enroll ?? enrollWatchConnect;
  const refreshed = await enroll({
    requestId: input.enrollmentRequestId,
    installId: identity.installId,
    scope: 'studio',
    clubId: current.clubId,
    liveStudioConsent: input.liveStudioConsent,
    sessionStudioConsent: true,
  });
  const next = refreshed.enrollment;
  if (
    next.id !== current.id
    || next.state !== 'trusted'
    || next.scope !== 'studio'
    || next.clubId !== current.clubId
    || next.studioRiderId !== current.studioRiderId
    || next.liveStudioConsent !== input.liveStudioConsent
    || next.sessionStudioConsent !== true
  ) {
    throw new Error('Watch Connect could not confirm the updated studio sharing choice.');
  }
  return next;
}

/** Native queues final samples first; server visibility then stops immediately. */
export async function stopWatchConnectAction(
  connection: WatchConnectConnection,
  dependencies: WatchConnectActionDependencies,
): Promise<StopWatchConnectResult> {
  const native = await dependencies.stopNative();
  if (native.state === 'error') {
    throw new Error(native.reason || 'Watch Connect could not stop safely.');
  }
  const stopped = await finishWatchConnectDisconnect(connection, dependencies);
  return {
    ...stopped,
    pendingSync: native.state === 'syncing' || native.state === 'disconnecting',
  };
}

export async function finishWatchConnectDisconnect(
  connection: WatchConnectConnection,
  dependencies: Pick<WatchConnectActionDependencies, 'disconnectConnection'>,
): Promise<StopWatchConnectResult> {
  const disconnect = dependencies.disconnectConnection ?? disconnectWatchConnectConnection;
  return { pendingSync: false, connection: await disconnect(connection.id) };
}

export async function stopWatchConnectForAccountBoundary({
  getNativeState,
  stopNative,
  loadCloud = loadWatchConnect,
  disconnectConnection = disconnectWatchConnectConnection,
}: {
  getNativeState: () => Promise<WatchConnectNativeResult>;
  stopNative: () => Promise<WatchConnectNativeResult>;
  loadCloud?: typeof loadWatchConnect;
  disconnectConnection?: typeof disconnectWatchConnectConnection;
}) {
  const [native, cloud] = await Promise.all([
    getNativeState().catch(() => null),
    loadCloud().catch(() => null),
  ]);
  if (!native?.connectionId) return { stoppedNative: false, stoppedServer: false };
  const exact = cloud?.connections.find((connection) => (
    connection.id === native.connectionId
    && connection.connectedUntil === native.connectedUntil
    && (connection.state === 'connecting' || connection.state === 'connected')
  )) ?? null;
  if (['connecting', 'connected', 'syncing', 'disconnecting'].includes(native.state)) {
    await stopNative().catch(() => undefined);
  }
  if (exact) {
    // DELETE hides Connected immediately while the backend keeps its bounded
    // finalized-upload drain alive for the native outbox.
    await disconnectConnection(exact.id).catch(() => undefined);
  }
  return { stoppedNative: true, stoppedServer: Boolean(exact) };
}
