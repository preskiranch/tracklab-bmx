import type { HeartRateLiveEvent } from './heartRateCloud';
import {
  heartRateLiveFreshnessMs,
  heartRateLiveMaximumFutureSkewMs,
} from './heartRateCloud';
import type { NativeWatchConnectState } from './nativeHeartRate';
import {
  watchConnectRemainingMs,
  type WatchConnectConnection,
  type WatchConnectEnrollment,
} from './watchConnect';

export type WatchConnectIndicatorPhase =
  | 'checking'
  | 'connecting'
  | 'live'
  | 'syncing'
  | 'disconnected';

export type WatchConnectIndicatorState = Readonly<{
  phase: WatchConnectIndicatorPhase;
  label: string;
  detail: string;
}>;

function state(
  phase: WatchConnectIndicatorPhase,
  label: string,
  detail: string,
): WatchConnectIndicatorState {
  return { phase, label, detail };
}

export function watchConnectLiveEventIsFresh({
  accountId,
  connection,
  event,
  now = Date.now(),
}: {
  accountId: string;
  connection: WatchConnectConnection;
  event: HeartRateLiveEvent | null;
  now?: number;
}) {
  if (
    !event
    || event.riderId !== `account:${accountId}`
    || event.sessionId !== `watch-connect:${connection.id}`
    || event.recordedAt > now + heartRateLiveMaximumFutureSkewMs
    || now - event.recordedAt >= heartRateLiveFreshnessMs
    || (event.receivedAt != null && (
      event.receivedAt > now + heartRateLiveMaximumFutureSkewMs
      || event.recordedAt <= event.receivedAt - heartRateLiveFreshnessMs
      || event.recordedAt > event.receivedAt + heartRateLiveMaximumFutureSkewMs
    ))
    || (event.freshUntil != null && event.freshUntil <= now)
  ) return false;
  return true;
}

function nativeIdentityMatchesConnection(
  native: NativeWatchConnectState | null,
  connection: WatchConnectConnection,
) {
  return native?.scope === connection.scope
    && native.connectionId === connection.id
    && native.sessionId === `watch-connect:${connection.id}`
    && native.connectedUntil === connection.connectedUntil;
}

function nativeMatchesConnection(
  native: NativeWatchConnectState | null,
  connection: WatchConnectConnection,
) {
  return native?.state === 'connected'
    && nativeIdentityMatchesConnection(native, connection)
    && native.workoutReady
    && native.relayConfigured;
}

/**
 * A green indicator means an exact, freshness-bounded Watch sample is flowing
 * for this signed-in account. A four-hour server row alone is never called
 * live. The paired iPhone must also match native identity; an iPad is a
 * read-only observer of the same account-scoped cloud projection.
 */
export function resolveWatchConnectIndicatorState({
  accountId,
  hydratedAccountId,
  capable,
  enrollment,
  connection,
  native,
  readOnlyObserver,
  event,
  busy = false,
  now = Date.now(),
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  capable: boolean | null;
  enrollment: WatchConnectEnrollment | null;
  connection: WatchConnectConnection | null;
  native: NativeWatchConnectState | null;
  readOnlyObserver: boolean;
  event: HeartRateLiveEvent | null;
  busy?: boolean;
  now?: number;
}): WatchConnectIndicatorState {
  if (!accountId || hydratedAccountId !== accountId || capable == null) {
    return state('checking', 'Watch checking', 'Checking Apple Watch status.');
  }
  if (capable === false) {
    return state('disconnected', 'Watch unavailable', 'Apple Watch is not available on this device.');
  }
  if (native?.state === 'syncing' || native?.state === 'disconnecting') {
    return state('syncing', 'Watch syncing', 'The ended Watch session is syncing privately.');
  }
  if (!readOnlyObserver && (native?.state === 'error' || native?.state === 'reconnect')) {
    return state('disconnected', 'Watch disconnected', 'The paired iPhone lost its Apple Watch connection.');
  }
  if (!readOnlyObserver && native?.state === 'inactive' && connection && !busy) {
    return state('disconnected', 'Watch disconnected', 'The paired iPhone lost its Apple Watch connection.');
  }
  const trusted = enrollment?.state === 'trusted'
    && connection?.enrollmentId === enrollment.id;
  const cloudIdentityActive = trusted
    && (connection?.state === 'connecting' || connection?.state === 'connected')
    && watchConnectRemainingMs(connection.connectedUntil, now) > 0;
  const exactFreshEvent = Boolean(
    connection && watchConnectLiveEventIsFresh({ accountId, connection, event, now }),
  );
  // A fresh exact sample is stronger evidence than a cached `connecting` row.
  // This is common immediately after native start and on an iPad when SSE wins
  // the race with its next status snapshot.
  if (
    cloudIdentityActive
    && connection
    && (readOnlyObserver || nativeMatchesConnection(native, connection))
    && exactFreshEvent
  ) {
    return state(
      'live',
      'Watch live',
      readOnlyObserver
        ? 'Live through the paired iPhone.'
      : 'Apple Watch heart rate is live.',
    );
  }
  if (!readOnlyObserver && native?.state === 'connecting') {
    // During the actual start call, `connecting` is expected and remains an
    // honest in-flight state. Outside that call, native can also fall back to
    // `connecting` after an established mirrored transport drops. Bound that
    // state by the same first-sample/fresh-sample window so a frozen Watch can
    // never look as though it is reconnecting forever.
    if (busy) return state('connecting', 'Watch connecting', 'Apple Watch is connecting.');
    const exactActiveNative = Boolean(
      cloudIdentityActive
      && connection
      && nativeIdentityMatchesConnection(native, connection),
    );
    if (!exactActiveNative || !connection) {
      return state('disconnected', 'Watch disconnected', 'The paired iPhone lost its Apple Watch connection.');
    }
    const withinFirstSampleGrace = now - connection.connectedAt < heartRateLiveFreshnessMs;
    if (!exactFreshEvent && !withinFirstSampleGrace) {
      return state('disconnected', 'Watch signal lost', 'No fresh Apple Watch reading.');
    }
    return native.workoutReady && native.relayConfigured
      ? state('connecting', 'Watch reconnecting', 'Apple Watch heart rate is reconnecting.')
      : state('connecting', 'Watch connecting', 'Apple Watch is connecting.');
  }
  if (busy) {
    return state('connecting', 'Watch connecting', 'Apple Watch is connecting.');
  }
  if (connection?.state === 'connecting') {
    return now - connection.connectedAt >= heartRateLiveFreshnessMs
      ? state('disconnected', 'Watch signal lost', 'No fresh Apple Watch reading.')
      : state('connecting', 'Watch connecting', 'Apple Watch is connecting.');
  }
  const cloudActive = trusted
    && connection?.state === 'connected'
    && watchConnectRemainingMs(connection.connectedUntil, now) > 0;
  if (!cloudActive || !connection) {
    return state('disconnected', 'Watch disconnected', 'No live Apple Watch connection.');
  }
  if (!readOnlyObserver && !nativeMatchesConnection(native, connection)) {
    return state('disconnected', 'Watch disconnected', 'The paired iPhone lost its Apple Watch connection.');
  }
  if (event?.sessionId === `watch-connect:${connection.id}`) {
    return state('disconnected', 'Watch signal lost', 'No fresh Apple Watch reading.');
  }
  if (now - connection.connectedAt >= heartRateLiveFreshnessMs) {
    return state('disconnected', 'Watch signal lost', 'No fresh Apple Watch reading.');
  }
  return state('connecting', 'Waiting for Watch', 'Waiting for the first fresh Apple Watch reading.');
}
