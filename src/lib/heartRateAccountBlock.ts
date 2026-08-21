import type { HeartRatePairingClaim } from './heartRateCloud';
import type {
  NativeHeartRateRelayConfiguration,
  NativeHeartRateRelayState,
  NativeHeartRateStatus,
} from './nativeHeartRate';

export const heartRateAccountBlockQueryParameter = 'heartRateAccountBlock' as const;
export const heartRateAccountBlockWorkoutReadyTimeoutMs = 45_000;

type HeartRateStatusListenerHandle = Readonly<{
  remove: () => Promise<void>;
}>;

type HeartRateStatusListener = (
  listener: (status: NativeHeartRateStatus) => void,
) => Promise<HeartRateStatusListenerHandle>;

export type HeartRateAccountBlockConnectResult = Readonly<{
  pairingId: string;
  blockId: string;
  workoutSessionId: string;
  workoutStarted: boolean;
}>;

export class HeartRateAccountBlockConnectError extends Error {
  readonly pairingId: string | null;
  readonly blockId: string | null;
  readonly workoutStarted: boolean;
  readonly relayConfigured: boolean;

  constructor(
    message: string,
    progress: {
      pairingId?: string | null;
      blockId?: string | null;
      workoutStarted?: boolean;
      relayConfigured?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'HeartRateAccountBlockConnectError';
    this.pairingId = progress.pairingId ?? null;
    this.blockId = progress.blockId ?? null;
    this.workoutStarted = progress.workoutStarted === true;
    this.relayConfigured = progress.relayConfigured === true;
  }
}

export function normalizeHeartRateAccountBlockCode(value: unknown) {
  if (typeof value !== 'string') return '';
  const compact = value.trim().toUpperCase().replace(/[\s-]/gu, '');
  return /^[2-9A-HJ-NP-Z]{8}$/u.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : '';
}

export function parseHeartRateAccountBlockHandoffHref(
  href: string,
  expectedOrigin: string,
) {
  try {
    const url = new URL(href);
    const sameOrigin = url.origin === new URL(expectedOrigin).origin;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    const present = sameOrigin && fragment.has(heartRateAccountBlockQueryParameter);
    return {
      present,
      pairCode: present
        ? normalizeHeartRateAccountBlockCode(fragment.get(heartRateAccountBlockQueryParameter))
        : '',
    };
  } catch {
    return { present: false, pairCode: '' };
  }
}

export function heartRateAccountBlockHandoffHref(currentHref: string, pairCode: string) {
  try {
    const url = new URL(currentHref);
    const normalizedCode = normalizeHeartRateAccountBlockCode(pairCode);
    if (!normalizedCode || !['https:', 'http:'].includes(url.protocol)) return '';
    // AASA and the native parser intentionally authorize only the production
    // root path. Never mint a handoff that iOS cannot open as a universal link.
    url.pathname = '/';
    url.search = '';
    url.hash = new URLSearchParams({
      [heartRateAccountBlockQueryParameter]: normalizedCode,
    }).toString();
    return url.toString();
  } catch {
    return '';
  }
}

function workoutStateFailure(status: NativeHeartRateStatus) {
  return status.message || 'Apple Watch did not start the private TrackLab workout.';
}

/**
 * Waits for the real native Watch lifecycle rather than treating the immediate
 * `.connecting` response from `startWatchApp` as a failed workout. A listener is
 * registered before the authoritative state refresh so an active transition
 * cannot be lost between those two operations.
 */
export function waitForHeartRateAccountBlockWorkout({
  sessionId,
  initialStatus,
  getState,
  addStatusListener,
  timeoutMs = heartRateAccountBlockWorkoutReadyTimeoutMs,
  signal,
}: {
  sessionId: string;
  initialStatus: NativeHeartRateStatus;
  getState: () => Promise<NativeHeartRateStatus>;
  addStatusListener: HeartRateStatusListener;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<NativeHeartRateStatus> {
  const expectedSessionId = sessionId.trim();
  if (!expectedSessionId || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('TrackLab cannot wait for an invalid Apple Watch session.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let listenerHandle: HeartRateStatusListenerHandle | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const removeListener = () => {
      if (listenerHandle) void listenerHandle.remove().catch(() => undefined);
      listenerHandle = null;
    };
    const cleanup = () => {
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
      timeoutHandle = null;
      signal?.removeEventListener('abort', abort);
      removeListener();
    };
    const finish = (result: NativeHeartRateStatus | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const inspect = (status: NativeHeartRateStatus) => {
      if (settled) return;
      const exactSession = status.sessionId === expectedSessionId;
      if (status.state === 'active' || status.state === 'paused') {
        finish(exactSession
          ? status
          : new Error('A different Apple Watch workout became active. End it before retrying.'));
        return;
      }
      if (status.state === 'launching' || status.state === 'connecting') {
        if (status.sessionId != null && !exactSession) {
          finish(new Error('A different Apple Watch workout is connecting. End it before retrying.'));
        }
        return;
      }
      if (status.state === 'ending') {
        finish(new Error('The Apple Watch workout is ending. Retry after it has stopped.'));
        return;
      }
      finish(new Error(workoutStateFailure(status)));
    };
    const abort = () => finish(new Error('Waiting for Apple Watch was cancelled.'));

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    timeoutHandle = setTimeout(() => {
      finish(new Error('Apple Watch did not become active in time. Confirm the workout on Watch, then retry.'));
    }, timeoutMs);

    void addStatusListener(inspect).then(async (handle) => {
      if (settled) {
        await handle.remove().catch(() => undefined);
        return;
      }
      listenerHandle = handle;
      inspect(initialStatus);
      if (settled) return;
      try {
        inspect(await getState());
      } catch (error) {
        finish(new Error(error instanceof Error ? error.message : String(error)));
      }
    }).catch((error: unknown) => {
      finish(new Error(error instanceof Error ? error.message : String(error)));
    });
  });
}

export function removeHeartRateAccountBlockHandoffHref(currentHref: string) {
  try {
    const url = new URL(currentHref);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    fragment.delete(heartRateAccountBlockQueryParameter);
    url.hash = fragment.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

function connectFailure(
  error: unknown,
  progress: {
    pairingId: string | null;
    blockId: string | null;
    workoutStarted: boolean;
    relayConfigured: boolean;
  },
) {
  if (error instanceof HeartRateAccountBlockConnectError) return error;
  return new HeartRateAccountBlockConnectError(
    error instanceof Error ? error.message : String(error),
    progress,
  );
}

export async function connectHeartRateAccountBlock({
  accountId,
  pairCode,
  expectedPairingId = null,
  expectedBlockId = null,
  currentWorkout,
  baseUrl,
  claim,
  startWorkout,
  resumeWorkout,
  getWorkoutState,
  addWorkoutStatusListener,
  configureRelay,
  workoutReadyTimeoutMs,
  signal,
  now = Date.now,
}: {
  accountId: string;
  pairCode: string;
  expectedPairingId?: string | null;
  expectedBlockId?: string | null;
  currentWorkout: NativeHeartRateStatus | null;
  baseUrl: string;
  claim: (pairCode: string) => Promise<HeartRatePairingClaim>;
  startWorkout: (sessionId: string) => Promise<NativeHeartRateStatus>;
  resumeWorkout: () => Promise<NativeHeartRateStatus>;
  getWorkoutState?: () => Promise<NativeHeartRateStatus>;
  addWorkoutStatusListener?: HeartRateStatusListener;
  configureRelay: (configuration: NativeHeartRateRelayConfiguration) => Promise<NativeHeartRateRelayState>;
  workoutReadyTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<HeartRateAccountBlockConnectResult> {
  const normalizedCode = normalizeHeartRateAccountBlockCode(pairCode);
  const normalizedAccountId = accountId.trim();
  const progress = {
    pairingId: null as string | null,
    blockId: null as string | null,
    workoutStarted: false,
    relayConfigured: false,
  };
  if (!normalizedCode || !normalizedAccountId) {
    throw new HeartRateAccountBlockConnectError('This private Apple Watch handoff is invalid.');
  }

  try {
    const claimed = await claim(normalizedCode);
    const pairing = claimed.pairing;
    progress.pairingId = pairing.id;
    progress.blockId = pairing.sessionId;
    if (
      pairing.relayScope !== 'account-block'
      || pairing.activityType !== 'training-block'
      || pairing.riderId !== `account:${normalizedAccountId}`
      || pairing.playerId != null
      || (expectedPairingId != null && pairing.id !== expectedPairingId)
      || (expectedBlockId != null && pairing.sessionId !== expectedBlockId)
    ) {
      throw new Error('This private Apple Watch handoff does not belong to the signed-in TrackLab account.');
    }

    const workoutSessionId = `watch-account-block:${pairing.id}`;
    let workout = currentWorkout;
    if (workout?.state === 'active' || workout?.state === 'paused') {
      if (workout.sessionId !== workoutSessionId) {
        throw new Error('End the current Apple Watch workout before starting this private account block.');
      }
    } else if (workout?.state === 'launching' || workout?.state === 'connecting') {
      if (workout.sessionId !== workoutSessionId) {
        throw new Error('Wait for the current Apple Watch action to finish, then retry.');
      }
    } else if (workout?.state === 'ending') {
      throw new Error('Wait for the current Apple Watch action to finish, then retry.');
    } else {
      workout = await startWorkout(workoutSessionId);
      progress.workoutStarted = true;
    }
    if (workout.state === 'paused') {
      workout = await resumeWorkout();
    }
    if (workout.state === 'launching' || workout.state === 'connecting') {
      if (!getWorkoutState || !addWorkoutStatusListener) {
        throw new Error('TrackLab cannot verify the Apple Watch startup state. Retry after reopening the app.');
      }
      workout = await waitForHeartRateAccountBlockWorkout({
        sessionId: workoutSessionId,
        initialStatus: workout,
        getState: getWorkoutState,
        addStatusListener: addWorkoutStatusListener,
        ...(workoutReadyTimeoutMs != null ? { timeoutMs: workoutReadyTimeoutMs } : {}),
        ...(signal ? { signal } : {}),
      });
      if (workout.state === 'paused') workout = await resumeWorkout();
    }
    if (workout.state !== 'active' || workout.sessionId !== workoutSessionId) {
      throw new Error(workout.message || 'Apple Watch did not start the private TrackLab workout.');
    }

    const relay = await configureRelay({
      baseUrl,
      ingestToken: claimed.ingestToken,
      sessionId: pairing.sessionId,
      startedAt: now(),
      scope: 'account-block',
    });
    progress.relayConfigured = relay.configured;
    if (
      !relay.configured
      || relay.sessionId !== pairing.sessionId
      || relay.scope !== 'account-block'
    ) {
      throw new Error(relay.reason || 'The private account heart-rate relay could not start.');
    }

    return {
      pairingId: pairing.id,
      blockId: pairing.sessionId,
      workoutSessionId,
      workoutStarted: progress.workoutStarted,
    };
  } catch (error) {
    throw connectFailure(error, progress);
  }
}
