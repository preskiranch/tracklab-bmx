import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { UseHeartRateResult } from '../hooks/useHeartRate';
import type {
  NativeHeartRateAvailability,
  NativeHeartRateRelaySnapshot,
  NativeHeartRateStatus,
  NativeWatchConnectState,
} from '../lib/nativeHeartRate';
import {
  createWatchConnectRequestId,
  finishWatchConnectDisconnect,
  runWatchConnectSingleFlight,
  startWatchConnectAction,
  WatchConnectStartError,
  type WatchConnectNativeResult,
} from '../lib/watchConnectActions';
import {
  disconnectWatchConnectConnection,
  forgetWatchConnectEnrollment,
  loadWatchConnect,
  type WatchConnectCloudSnapshot,
} from '../lib/watchConnectCloud';
import {
  mergeLiveHeartRateEvent,
  revokeHeartRatePairing,
  subscribeToHeartRateLive,
  type HeartRateLiveEvent,
} from '../lib/heartRateCloud';
import {
  resolveWatchConnectViewState,
  type WatchConnectConnection,
  type WatchConnectEnrollment,
  type WatchConnectScope,
} from '../lib/watchConnect';
import { reconcileWatchConnectAccount } from '../lib/watchConnectReconciliation';
import {
  resolveWatchConnectIndicatorState,
  watchConnectLiveEventIsFresh,
} from '../lib/watchConnectIndicator';
import { WatchConnectCard } from './WatchConnectCard';
import { WatchConnectIndicator } from './WatchConnectIndicator';
import { OwnerStudioWatchConnectSettings } from './OwnerStudioWatchConnectSettings';
import { watchAppNeedsInstall } from './watchAppInstall';

export const watchConnectSettingsAnchorId = 'watch';
export const watchConnectSettingsSlotId = 'watch-connect-settings-slot';
export const watchConnectIndicatorSlotId = 'watch-connect-indicator-slot';

export type StudioContext = Readonly<{
  clubId: string;
  clubName: string;
}>;

export type OwnedStudioContext = StudioContext;

export type WatchConnectCoordinatorProps = Readonly<{
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  accountId: string | null;
  accountName: string;
  settingsOpen: boolean;
  heartRate: UseHeartRateResult;
  studioContext?: StudioContext | null;
  studioContexts?: readonly StudioContext[];
  ownedStudio?: OwnedStudioContext | null;
  preferPersonal?: boolean;
  latestHeartRate?: HeartRateLiveEvent | null;
  actionPromises?: Set<Promise<void>>;
  onLegacyRelaySuppressionChange?: (suppressed: boolean) => void;
  onCapabilityChange?: (capable: boolean) => void;
  onAccountLiveHeartRateChange?: (reading: HeartRateLiveEvent | null | undefined) => void;
  onLiveHeartRateReadingsChange?: (readings: Record<string, HeartRateLiveEvent>) => void;
  knownPairingIds?: Set<string>;
  onMessage?: (message: string) => void;
  onOpenSettings?: () => void;
}>;

const emptySnapshot: WatchConnectCloudSnapshot = Object.freeze({
  enrollments: [],
  connections: [],
});

// The coordinator moves between the account-completion and full-app trees
// while profile data hydrates. Keep the native privacy operation keyed at the
// module boundary so that remount cannot issue a second clearAllRelays call.
// Successful keys stay sealed for this webview lifetime; failed keys are
// removed so the visible Watch Connect action can retry explicitly.
const watchConnectAccountBoundarySealFlights = new Map<string, Promise<void>>();

/**
 * Coalesces one operation for a stable privacy/account key. A successful
 * account-boundary seal remains remembered until the key changes; ordinary
 * refreshes opt out so the next scheduled poll can run normally.
 */
export function runWatchConnectKeyedSingleFlight<T>(
  flights: Map<string, Promise<T>>,
  key: string,
  action: () => Promise<T>,
  retainSuccess = false,
) {
  const active = flights.get(key);
  if (active) return active;
  const operation = action();
  flights.set(key, operation);
  void operation.then(
    () => {
      if (!retainSuccess && flights.get(key) === operation) flights.delete(key);
    },
    () => {
      if (flights.get(key) === operation) flights.delete(key);
    },
  );
  return operation;
}

function nativeResultFromState(state: NativeWatchConnectState): WatchConnectNativeResult {
  return {
    state: state.state,
    scope: state.scope,
    connectionId: state.connectionId,
    sessionId: state.sessionId,
    connectedUntil: state.connectedUntil,
    remainingMs: state.remainingMs,
    requiresUserStart: state.requiresUserStart,
    workoutReady: state.workoutReady,
    relayConfigured: state.relayConfigured,
    ...(state.reason ? { reason: state.reason } : {}),
  };
}

export const watchConnectNativeResultFromState = nativeResultFromState;

export function watchConnectNativeCapability(state: NativeWatchConnectState) {
  const reason = state.reason?.toLowerCase() ?? '';
  return !(state.state === 'inactive' && (
    reason.includes('install the latest tracklab build')
    || reason.includes('newer tracklab app build with the native heart-rate bridge')
    || reason.includes('available only in the native tracklab app')
    || reason.includes('unavailable in this tracklab app build')
    || reason.includes('not implemented')
    || reason.includes('unimplemented')
    || reason.includes('does not have an implementation')
  ));
}

export function unavailableWatchConnectDetail(
  availability: NativeHeartRateAvailability | null,
) {
  return availability?.platform === 'iphone'
    ? availability.reason || 'Check this iPhone\'s Apple Watch connection.'
    : 'Open TrackLab on the paired iPhone and press Watch Connect.';
}

export function watchConnectReadOnlyObserver(
  availability: NativeHeartRateAvailability | null,
) {
  return availability != null && availability.platform !== 'iphone';
}

export function activeWatchConnectTarget(
  snapshot: WatchConnectCloudSnapshot,
  now = Date.now(),
) {
  const trustedEnrollmentIds = new Set(snapshot.enrollments
    .filter((candidate) => candidate.state === 'trusted')
    .map((candidate) => candidate.id));
  return [...snapshot.connections]
    .filter((candidate) => (
      trustedEnrollmentIds.has(candidate.enrollmentId)
      && (candidate.state === 'connecting' || candidate.state === 'connected')
      && candidate.connectedUntil > now
    ))
    .sort((left, right) => right.connectedAt - left.connectedAt)[0] ?? null;
}

export function watchConnectHeartRateForConnection(
  latest: HeartRateLiveEvent | null,
  connection: WatchConnectConnection | null,
) {
  return latest && connection && latest.sessionId === `watch-connect:${connection.id}`
    ? latest
    : null;
}

export function nativeWatchConnectHeartRate({
  accountId,
  connection,
  knownPairingIds,
  latest,
  status,
  readOnlyObserver,
  now = Date.now(),
}: {
  accountId: string;
  connection: WatchConnectConnection | null;
  knownPairingIds?: ReadonlySet<string>;
  latest: UseHeartRateResult['latest'];
  status: NativeHeartRateStatus | null;
  readOnlyObserver: boolean;
  now?: number;
}): HeartRateLiveEvent | null {
  const native = status?.watchConnect;
  const sessionPrefix = 'watch-connect:';
  const pairingId = status?.sessionId?.startsWith(sessionPrefix)
    ? status.sessionId.slice(sessionPrefix.length)
    : '';
  if (
    readOnlyObserver
    || !connection
    || !['connecting', 'connected'].includes(connection.state)
    || connection.connectedUntil <= now
    || !pairingId
    || !knownPairingIds?.has(pairingId)
    || status?.state !== 'active'
    || latest?.sessionId !== status.sessionId
    || native?.state !== 'connected'
    || native.scope !== connection.scope
    || native.connectionId !== connection.id
    || native.sessionId !== `${sessionPrefix}${connection.id}`
    || native.connectedUntil !== connection.connectedUntil
    || !native.workoutReady
    || !native.relayConfigured
  ) return null;
  const event: HeartRateLiveEvent = {
    streamId: '',
    sessionId: `${sessionPrefix}${connection.id}`,
    relayScope: connection.scope === 'studio' ? 'studio-block' : 'account-block',
    riderId: `account:${accountId}`,
    playerId: null,
    bpm: latest.bpm,
    recordedAt: latest.recordedAt,
    receivedAt: latest.receivedAt,
    activeElapsedMs: null,
  };
  return watchConnectLiveEventIsFresh({ accountId, connection, event, now }) ? event : null;
}

export function watchConnectLegacyHeartRateIsBusy(
  status: NativeHeartRateStatus | null,
  relay: NativeHeartRateRelaySnapshot | null,
) {
  const isWatchConnect = (sessionId: string | null | undefined) => (
    sessionId?.startsWith('watch-connect:') === true
  );
  if (relay?.sessions.some((session) => !isWatchConnect(session.sessionId))) return true;
  if (relay?.configured && !isWatchConnect(relay.sessionId)) return true;
  return Boolean(
    status
    && ['launching', 'connecting', 'active', 'paused', 'ending'].includes(status.state)
    && !isWatchConnect(status.sessionId),
  );
}

export function watchConnectSuppressesLegacyRelay({
  accountId,
  hydratedAccountId,
  capable,
  snapshot,
  native,
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  capable: boolean | null;
  snapshot: WatchConnectCloudSnapshot;
  native: NativeWatchConnectState | null;
}) {
  if (!accountId || capable === false) return false;
  if (capable == null) return true;
  if (hydratedAccountId !== accountId) return true;
  return snapshot.enrollments.some((candidate) => candidate.state === 'trusted')
    || Boolean(native && ['connecting', 'connected', 'syncing', 'disconnecting'].includes(native.state));
}

export function defaultWatchConnectClubId({
  contexts,
  preferredClubId,
  preferPersonal,
}: {
  contexts: readonly StudioContext[];
  preferredClubId?: string | null;
  preferPersonal?: boolean;
}) {
  if (preferPersonal) return null;
  if (preferredClubId && contexts.some((context) => context.clubId === preferredClubId)) {
    return preferredClubId;
  }
  return contexts.length === 1 ? contexts[0].clubId : null;
}

export function watchConnectAccountRequestIsCurrent(
  requestedAccountId: string,
  currentAccountId: string | null,
) {
  return requestedAccountId === currentAccountId;
}

export function watchConnectCoordinatorRequestIsCurrent(
  requestedAccountId: string,
  currentAccountId: string | null,
  requestedGeneration: number,
  currentGeneration: number,
  currentAuthStatus: WatchConnectCoordinatorProps['authStatus'] = 'signed-in',
) {
  return watchConnectAccountRequestIsCurrent(requestedAccountId, currentAccountId)
    && requestedGeneration === currentGeneration
    && currentAuthStatus === 'signed-in';
}

export async function cleanupStaleWatchConnectStart({
  connection,
  pairingId,
  getNativeState,
  stopNative,
  disconnectConnection = disconnectWatchConnectConnection,
  revokePairing = revokeHeartRatePairing,
}: {
  connection: WatchConnectConnection;
  pairingId: string;
  getNativeState: () => Promise<NativeWatchConnectState>;
  stopNative: () => Promise<unknown>;
  disconnectConnection?: (connectionId: string) => Promise<unknown>;
  revokePairing?: (pairingId: string) => Promise<unknown>;
}) {
  const native = await getNativeState().catch(() => null);
  if (
    native?.connectionId === connection.id
    && native.sessionId === `watch-connect:${connection.id}`
    && native.connectedUntil === connection.connectedUntil
  ) await stopNative().catch(() => undefined);
  await Promise.all([
    disconnectConnection(connection.id).catch(() => undefined),
    revokePairing(pairingId).catch(() => undefined),
  ]);
}

export function watchConnectAccountBoundarySealKey({
  accountId,
  hydratedAccountId,
  connections,
  native,
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  connections: readonly WatchConnectConnection[];
  native: NativeWatchConnectState | null;
}) {
  if (!accountId || hydratedAccountId !== accountId || !native?.connectionId
    || !native.sessionId || native.connectedUntil == null) return null;
  const reconciliation = reconcileWatchConnectAccount({
    accountId,
    hydratedAccountId,
    connections,
    native,
  });
  const exactHistoricalIdentity = connections.some((connection) => (
    connection.id === native.connectionId
    && connection.scope === native.scope
    && connection.connectedUntil === native.connectedUntil
    && `watch-connect:${connection.id}` === native.sessionId
  ));
  // Native error/reconnect states still retain the prior credential identity.
  // Reconciliation intentionally treats those as restartable for the same
  // account; at an account boundary, however, an unmatched identity must be
  // sealed before the new account can create a connection.
  if (
    reconciliation !== 'foreign-native-session'
    && (!['error', 'reconnect'].includes(native.state) || exactHistoricalIdentity)
  ) return null;
  // Phase is intentionally excluded: connected -> disconnecting -> syncing is
  // one native identity and must never trigger another account-boundary seal.
  return JSON.stringify([
    accountId,
    native.connectionId,
    native.sessionId,
    native.connectedUntil,
  ]);
}

export function watchConnectCoordinatorBoundarySealKey({
  startInFlight,
  ...input
}: Parameters<typeof watchConnectAccountBoundarySealKey>[0] & { startInFlight: boolean }) {
  return startInFlight ? null : watchConnectAccountBoundarySealKey(input);
}

export function watchConnectStudioConsentForStart(
  enrollment: WatchConnectEnrollment | null,
  live: boolean,
  session: boolean,
) {
  return enrollment?.scope === 'studio' && enrollment.state === 'trusted'
    ? { live: enrollment.liveStudioConsent, session: enrollment.sessionStudioConsent }
    : { live, session };
}

export function watchConnectNeedsCredentialRecovery({
  accountId,
  hydratedAccountId,
  enrollment,
  connection,
  native,
  inFlight,
  now = Date.now(),
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  enrollment: WatchConnectEnrollment | null;
  connection: WatchConnectConnection | null;
  native: NativeWatchConnectState | null;
  inFlight: boolean;
  now?: number;
}) {
  const state = native;
  return !inFlight
    && Boolean(accountId && hydratedAccountId === accountId)
    && enrollment?.state === 'trusted'
    && connection?.state === 'connecting'
    && connection.enrollmentId === enrollment.id
    && connection.connectedUntil > now
    && state?.state === 'connecting'
    && state.scope === connection.scope
    && state.connectionId === connection.id
    && state.sessionId === `watch-connect:${connection.id}`
    && state.connectedUntil === connection.connectedUntil
    && state.relayConfigured === false;
}

export function watchConnectCanRetryCloudConnection({
  accountId,
  hydratedAccountId,
  connection,
  native,
}: {
  accountId: string | null;
  hydratedAccountId: string | null;
  connection: WatchConnectConnection | null;
  native: NativeWatchConnectState | null;
}) {
  return Boolean(
    accountId
    && hydratedAccountId === accountId
    && connection?.state === 'connecting'
    && (native == null || ['inactive', 'reconnect', 'error'].includes(native.state)),
  );
}

function newestEnrollment(
  snapshot: WatchConnectCloudSnapshot,
  scope: WatchConnectScope,
  clubId: string | null,
) {
  return [...snapshot.enrollments]
    .filter((candidate) => (
      candidate.scope === scope
      && candidate.clubId === clubId
      && candidate.state === 'trusted'
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

function newestConnection(
  snapshot: WatchConnectCloudSnapshot,
  enrollment: WatchConnectEnrollment | null,
) {
  if (!enrollment) return null;
  return [...snapshot.connections]
    .filter((candidate) => candidate.enrollmentId === enrollment.id)
    .sort((left, right) => right.connectedAt - left.connectedAt)[0] ?? null;
}

export function WatchConnectCoordinator({
  authStatus,
  accountId,
  accountName,
  settingsOpen,
  heartRate,
  studioContext = null,
  studioContexts = [],
  ownedStudio = null,
  preferPersonal = false,
  latestHeartRate = null,
  actionPromises,
  onLegacyRelaySuppressionChange,
  onCapabilityChange,
  onAccountLiveHeartRateChange,
  onLiveHeartRateReadingsChange,
  knownPairingIds,
  onMessage,
  onOpenSettings = () => undefined,
}: WatchConnectCoordinatorProps) {
  const [snapshot, setSnapshot] = useState<WatchConnectCloudSnapshot>(emptySnapshot);
  const [nativeState, setNativeState] = useState<NativeWatchConnectState | null>(heartRate.watchConnect);
  const [hydratedAccountId, setHydratedAccountId] = useState<string | null>(null);
  const [capable, setCapable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [sealingEarlierSession, setSealingEarlierSession] = useState(false);
  const [actionDetail, setActionDetail] = useState('');
  const [now, setNow] = useState(Date.now());
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [indicatorTarget, setIndicatorTarget] = useState<HTMLElement | null>(null);
  const [liveStudioConsent, setLiveStudioConsent] = useState(false);
  const [sessionStudioConsent, setSessionStudioConsent] = useState(false);
  const [recoveryRetryConnectionId, setRecoveryRetryConnectionId] = useState<string | null>(null);
  const contextsKey = studioContexts.map((context) => `${context.clubId}:${context.clubName}`).join('|');
  const [targetClubId, setTargetClubId] = useState<string | null>(() => defaultWatchConnectClubId({
    contexts: studioContexts,
    preferredClubId: studioContext?.clubId,
    preferPersonal,
  }));
  const requestIdsRef = useRef<{ enrollment: string; connection: string } | null>(null);
  const previousAccountIdRef = useRef(accountId);
  const previousAuthStatusRef = useRef(authStatus);
  const pendingStartConnectionRef = useRef<WatchConnectConnection | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const refreshFlightsRef = useRef(new Map<string, Promise<void>>());
  const refreshRequestGenerationRef = useRef(0);
  const accountBoundarySealRequestKeyRef = useRef<string | null>(null);
  const recoveryAttemptedConnectionRef = useRef<string | null>(null);
  const unmatchedLiveSessionRefreshRef = useRef<string | null>(null);
  const currentAccountIdRef = useRef(accountId);
  const currentAuthStatusRef = useRef(authStatus);
  const accountGenerationRef = useRef(0);
  const generationAccountIdRef = useRef(accountId);
  const generationAuthStatusRef = useRef(authStatus);
  if (generationAccountIdRef.current !== accountId || generationAuthStatusRef.current !== authStatus) {
    generationAccountIdRef.current = accountId;
    generationAuthStatusRef.current = authStatus;
    accountGenerationRef.current += 1;
  }
  currentAccountIdRef.current = accountId;
  currentAuthStatusRef.current = authStatus;
  const {
    availability,
    clearAllRelays,
    relayState,
    status,
    getWatchConnectIdentity,
    getWatchConnectState,
    startWatchConnect,
    stopWatchConnect,
    watchConnect,
    refreshAvailability,
  } = heartRate;

  const selectedStudioContext = studioContexts.find((context) => context.clubId === targetClubId)
    ?? (studioContext?.clubId === targetClubId ? studioContext : null);
  const scope: WatchConnectScope = selectedStudioContext ? 'studio' : 'personal';
  const clubId = selectedStudioContext?.clubId ?? null;
  const enrollment = useMemo(
    () => newestEnrollment(snapshot, scope, clubId),
    [clubId, scope, snapshot],
  );
  const connection = useMemo(
    () => newestConnection(snapshot, enrollment),
    [enrollment, snapshot],
  );
  const availabilityKnown = availability != null;
  const onIPhone = availability?.platform === 'iphone';
  const onPairedIPhone = onIPhone
    && availability.supported === true;
  const readOnlyObserver = watchConnectReadOnlyObserver(availability);
  const nativeDisplayState = nativeState ? nativeResultFromState(nativeState) : null;
  const actionBusy = busy || sealingEarlierSession;
  const viewState = resolveWatchConnectViewState({
    enrollment,
    connection,
    nativeState: readOnlyObserver ? null : nativeDisplayState,
    requiresNativeMatch: onPairedIPhone,
    busy: actionBusy,
    now,
  });
  const platformViewState = readOnlyObserver && viewState.phase === 'connected'
    ? {
      ...viewState,
      detail: 'Connected through the paired iPhone. Ready on this device for every TrackLab program during this four-hour session.',
    }
    : !onPairedIPhone && (viewState.phase === 'connect' || viewState.phase === 'ended')
    ? {
      ...viewState,
      detail: unavailableWatchConnectDetail(availability),
    }
    : viewState;
  const cardState = actionDetail && platformViewState.phase !== 'connected'
    ? { ...platformViewState, detail: actionDetail }
    : platformViewState;
  const activeAccountConnection = authStatus === 'signed-in' && hydratedAccountId === accountId
    ? activeWatchConnectTarget(snapshot, now)
    : null;
  const cloudAccountHeartRate = accountId && activeAccountConnection
    && watchConnectLiveEventIsFresh({
      accountId,
      connection: activeAccountConnection,
      event: latestHeartRate,
      now,
    })
    ? latestHeartRate
    : null;
  const nativeAccountHeartRate = useMemo(() => accountId ? nativeWatchConnectHeartRate({
      accountId,
      connection: activeAccountConnection,
      knownPairingIds,
      latest: heartRate.latest,
      status,
      readOnlyObserver,
      now,
    }) : null, [
    accountId,
    activeAccountConnection,
    heartRate.latest,
    knownPairingIds,
    now,
    readOnlyObserver,
    status,
  ]);
  const accountLiveHeartRate = activeAccountConnection
    ? cloudAccountHeartRate && (!nativeAccountHeartRate
      || cloudAccountHeartRate.recordedAt >= nativeAccountHeartRate.recordedAt)
      ? cloudAccountHeartRate
      : nativeAccountHeartRate
    : undefined;
  const exactLiveHeartRate = connection?.id === activeAccountConnection?.id
    ? accountLiveHeartRate ?? null
    : null;
  const indicatorState = resolveWatchConnectIndicatorState({
    accountId,
    hydratedAccountId,
    capable,
    enrollment,
    connection,
    native: nativeState,
    readOnlyObserver,
    event: exactLiveHeartRate,
    busy: actionBusy,
    now,
  });

  useLayoutEffect(() => {
    onAccountLiveHeartRateChange?.(accountLiveHeartRate);
  }, [accountLiveHeartRate, onAccountLiveHeartRateChange, snapshot]);

  useEffect(() => () => onAccountLiveHeartRateChange?.(undefined), [onAccountLiveHeartRateChange]);

  // The coordinator is also mounted on the membership landing page, before
  // the signed-in shell exists. Re-check after each render so the indicator
  // attaches as soon as that shell replaces the landing page.
  useEffect(() => {
    const nextTarget = typeof document === 'undefined'
      ? null
      : document.getElementById(watchConnectIndicatorSlotId);
    setIndicatorTarget((current) => current === nextTarget ? current : nextTarget);
  });

  useEffect(() => {
    setPortalTarget(settingsOpen && typeof document !== 'undefined'
      ? document.getElementById(watchConnectSettingsSlotId)
      : null);
  }, [settingsOpen]);

  useEffect(() => {
    if (
      !portalTarget
      || typeof window === 'undefined'
    ) return undefined;
    const anchor = portalTarget.closest<HTMLElement>(`#${watchConnectSettingsAnchorId}`);
    const settingsRoot = anchor?.closest<HTMLElement>('.platform-main');
    if (!anchor || !settingsRoot) return undefined;

    let followingDirectNavigation = false;
    let frame: number | null = null;
    let settleTimer: number | null = null;
    const settingsAreLoading = () => [...settingsRoot.querySelectorAll('.explore-loading')]
      .some((element) => element.textContent?.trim() === 'Loading settings…');
    const stopFollowing = () => {
      followingDirectNavigation = false;
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = null;
    };
    const scrollAndFocus = () => {
      frame = null;
      if (!followingDirectNavigation) return;
      const watchCard = anchor.querySelector<HTMLElement>('.watch-connect-card');
      const fallbackCard = anchor.querySelector<HTMLElement>(
        '.heart-rate-account-block, .heart-rate-settings-card',
      );
      const card = watchCard ?? fallbackCard;
      if (!card) return;
      card.scrollIntoView({ behavior: 'auto', block: 'start' });
      const navigation = document.querySelector<HTMLElement>('.side-nav');
      if (navigation) {
        const navigationStyle = window.getComputedStyle(navigation);
        const navigationRect = navigation.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        if (
          ['fixed', 'sticky'].includes(navigationStyle.position)
          && navigationRect.bottom > cardRect.top
          && navigationRect.top < cardRect.bottom
          && navigationRect.right > cardRect.left
          && navigationRect.left < cardRect.right
        ) {
          window.scrollBy({
            behavior: 'auto',
            top: cardRect.top - navigationRect.bottom - 12,
          });
        }
      }
      const action = watchCard?.querySelector<HTMLButtonElement>(
        '.watch-connect-card-actions button:not(:disabled)',
      );
      const focusTarget = action ?? card;
      if (!action && !card.hasAttribute('tabindex')) card.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
      if (window.location.hash === `#${watchConnectSettingsAnchorId}`) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
      }
      if (!settingsAreLoading()) {
        if (settleTimer != null) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(stopFollowing, 300);
      }
    };
    const schedule = () => {
      if (!followingDirectNavigation || frame != null) return;
      frame = window.requestAnimationFrame(scrollAndFocus);
    };
    const beginFollowing = () => {
      if (window.location.hash !== `#${watchConnectSettingsAnchorId}`) return;
      followingDirectNavigation = true;
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = null;
      schedule();
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(settingsRoot, { childList: true, subtree: true });
    const resize = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(schedule);
    resize?.observe(settingsRoot);
    window.addEventListener('hashchange', beginFollowing);
    beginFollowing();
    return () => {
      window.removeEventListener('hashchange', beginFollowing);
      mutations.disconnect();
      resize?.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
      if (settleTimer != null) window.clearTimeout(settleTimer);
    };
  }, [portalTarget]);

  useEffect(() => {
    setNativeState(watchConnect);
  }, [watchConnect]);

  useEffect(() => {
    setTargetClubId(defaultWatchConnectClubId({
      contexts: studioContexts,
      preferredClubId: studioContext?.clubId,
      preferPersonal,
    }));
    setLiveStudioConsent(false);
    setSessionStudioConsent(false);
    requestIdsRef.current = null;
    recoveryAttemptedConnectionRef.current = null;
    unmatchedLiveSessionRefreshRef.current = null;
    setRecoveryRetryConnectionId(null);
    // contextsKey avoids resetting the choice when App recreates the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, contextsKey, preferPersonal, studioContext?.clubId]);

  useEffect(() => {
    if (
      !nativeState?.connectionId
      || !['connecting', 'connected', 'syncing', 'disconnecting'].includes(nativeState.state)
    ) return;
    const exact = snapshot.connections.find((candidate) => (
      candidate.id === nativeState.connectionId
      && candidate.connectedUntil === nativeState.connectedUntil
    ));
    if (exact) setTargetClubId(exact.scope === 'studio' ? exact.clubId : null);
  }, [nativeState?.connectedUntil, nativeState?.connectionId, snapshot.connections]);

  useEffect(() => {
    if (!readOnlyObserver || hydratedAccountId !== accountId) return;
    const active = activeWatchConnectTarget(snapshot, now);
    if (active) setTargetClubId(active.scope === 'studio' ? active.clubId : null);
  }, [accountId, hydratedAccountId, now, readOnlyObserver, snapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => {
    if (authStatus !== 'signed-in' || !accountId) return Promise.resolve();
    const requestedAccountId = accountId;
    const requestedAccountGeneration = accountGenerationRef.current;
    const platformKey = onIPhone ? 'iphone' : readOnlyObserver ? 'observer' : 'unknown';
    const refreshKey = `${requestedAccountGeneration}:${requestedAccountId}:${platformKey}`;
    return runWatchConnectKeyedSingleFlight(refreshFlightsRef.current, refreshKey, async () => {
      const requestedRefreshGeneration = refreshRequestGenerationRef.current + 1;
      refreshRequestGenerationRef.current = requestedRefreshGeneration;
      const [cloudResult, nativeResult] = await Promise.allSettled([
        loadWatchConnect(),
        onIPhone ? getWatchConnectState() : Promise.resolve(null),
      ]);
      if (!watchConnectCoordinatorRequestIsCurrent(
        requestedAccountId,
        currentAccountIdRef.current,
        requestedAccountGeneration,
        accountGenerationRef.current,
      ) || requestedRefreshGeneration !== refreshRequestGenerationRef.current) return;
      if (readOnlyObserver) {
        setNativeState(null);
        setCapable(true);
        onCapabilityChange?.(true);
      } else if (nativeResult.status === 'fulfilled' && nativeResult.value) {
        const native = nativeResult.value;
        setNativeState(native);
        const nextCapable = watchConnectNativeCapability(native);
        setCapable(nextCapable);
        onCapabilityChange?.(nextCapable);
      } else if (availabilityKnown) {
        setCapable(false);
        onCapabilityChange?.(false);
      }
      if (cloudResult.status === 'rejected') throw cloudResult.reason;
      setSnapshot(cloudResult.value);
      setHydratedAccountId(requestedAccountId);
      setNow(Date.now());
    });
  }, [
    accountId,
    authStatus,
    availabilityKnown,
    getWatchConnectState,
    onCapabilityChange,
    onIPhone,
    readOnlyObserver,
  ]);

  useEffect(() => {
    if (
      !readOnlyObserver
      || !accountId
      || hydratedAccountId !== accountId
      || latestHeartRate?.riderId !== `account:${accountId}`
      || !latestHeartRate.sessionId.startsWith('watch-connect:')
    ) return;
    const sessionId = latestHeartRate.sessionId;
    const connectionId = sessionId.slice('watch-connect:'.length);
    if (snapshot.connections.some((candidate) => candidate.id === connectionId)) {
      if (unmatchedLiveSessionRefreshRef.current === sessionId) {
        unmatchedLiveSessionRefreshRef.current = null;
      }
      return;
    }
    if (unmatchedLiveSessionRefreshRef.current === sessionId) return;
    unmatchedLiveSessionRefreshRef.current = sessionId;
    void refresh().catch(() => undefined);
  }, [accountId, hydratedAccountId, latestHeartRate, readOnlyObserver, refresh, snapshot.connections]);

  useEffect(() => {
    if (authStatus !== 'signed-in' || !accountId) {
      setSnapshot(emptySnapshot);
      setActionDetail('');
      onLegacyRelaySuppressionChange?.(false);
      return undefined;
    }
    let cancelled = false;
    const run = () => refresh().catch((error: unknown) => {
      if (!cancelled) setActionDetail(error instanceof Error ? error.message : String(error));
    });
    void run();
    const timer = window.setInterval(run, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, authStatus, onLegacyRelaySuppressionChange, refresh]);

  useEffect(() => {
    const accountChanged = previousAccountIdRef.current !== accountId
      || previousAuthStatusRef.current !== authStatus;
    previousAccountIdRef.current = accountId;
    previousAuthStatusRef.current = authStatus;
    if (!accountChanged) return;
    requestIdsRef.current = null;
    pendingStartConnectionRef.current = null;
    connectPromiseRef.current = null;
    accountBoundarySealRequestKeyRef.current = null;
    recoveryAttemptedConnectionRef.current = null;
    unmatchedLiveSessionRefreshRef.current = null;
    setRecoveryRetryConnectionId(null);
    setSnapshot(emptySnapshot);
    setHydratedAccountId(null);
    setNativeState(null);
    setCapable(null);
    setBusy(false);
    setSealingEarlierSession(false);
    setActionDetail('');
  }, [accountId, authStatus]);

  useEffect(() => {
    let readings: Readonly<Record<string, HeartRateLiveEvent>> = {};
    onLiveHeartRateReadingsChange?.({});
    if (authStatus !== 'signed-in' || !accountId) return undefined;
    const expectedRiderId = `account:${accountId}`;
    let disposed = false;
    const deliver = (event: HeartRateLiveEvent, exactRiderId?: string) => {
      if (disposed) return;
      const next = mergeLiveHeartRateEvent(readings, event, {
        ...(exactRiderId ? { expectedRiderId: exactRiderId } : {}),
      });
      if (next === readings) return;
      readings = next;
      onLiveHeartRateReadingsChange?.({ ...next });
    };
    const unsubscribePersonal = subscribeToHeartRateLive(
      (event) => deliver(event, expectedRiderId),
    );
    const unsubscribeClub = ownedStudio?.clubId
      ? subscribeToHeartRateLive(deliver, { clubId: ownedStudio.clubId })
      : () => undefined;
    return () => {
      disposed = true;
      unsubscribePersonal();
      unsubscribeClub();
    };
  }, [accountId, authStatus, onLiveHeartRateReadingsChange, ownedStudio?.clubId]);

  useEffect(() => {
    // A remembered connection owns all heart-rate routing for this account,
    // even between four-hour sessions. This prevents legacy mode-specific
    // relays from starting after expiry or during a bike reconnect.
    onLegacyRelaySuppressionChange?.(watchConnectSuppressesLegacyRelay({
      accountId,
      hydratedAccountId,
      capable,
      snapshot,
      native: nativeState,
    }));
  }, [accountId, capable, hydratedAccountId, nativeState, onLegacyRelaySuppressionChange, snapshot]);

  const pendingStartConnection = pendingStartConnectionRef.current;
  const boundaryConnections = pendingStartConnection
    ? [
      pendingStartConnection,
      ...snapshot.connections.filter((candidate) => candidate.id !== pendingStartConnection.id),
    ]
    : snapshot.connections;
  const accountBoundarySealKey = watchConnectCoordinatorBoundarySealKey({
    startInFlight: Boolean(connectPromiseRef.current),
    accountId,
    hydratedAccountId,
    connections: boundaryConnections,
    native: nativeState,
  });
  const sealEarlierSession = useCallback(async (sealKey: string) => {
    if (!accountId) return;
    const requestedAccountId = accountId;
    const requestedAccountGeneration = accountGenerationRef.current;
    accountBoundarySealRequestKeyRef.current = sealKey;
    setSealingEarlierSession(true);
    setActionDetail('Securing an earlier Watch session privately…');
    try {
      await runWatchConnectKeyedSingleFlight(watchConnectAccountBoundarySealFlights, sealKey, async () => {
        const cleared = await clearAllRelays();
        if (cleared.reason) throw new Error(cleared.reason);
      }, true);
      const nextNativeState = await getWatchConnectState();
      if (!watchConnectCoordinatorRequestIsCurrent(
        requestedAccountId,
        currentAccountIdRef.current,
        requestedAccountGeneration,
        accountGenerationRef.current,
      ) || accountBoundarySealRequestKeyRef.current !== sealKey) return;
      setNativeState(nextNativeState);
      setActionDetail('Earlier Watch data is syncing privately. Press Watch Connect to start a new four-hour session.');
    } catch (error) {
      if (watchConnectCoordinatorRequestIsCurrent(
        requestedAccountId,
        currentAccountIdRef.current,
        requestedAccountGeneration,
        accountGenerationRef.current,
      ) && accountBoundarySealRequestKeyRef.current === sealKey) {
        const reason = error instanceof Error ? error.message : String(error);
        setActionDetail(`An earlier Watch session could not be secured privately. Press Watch Connect to try again. ${reason}`);
      }
      throw error;
    } finally {
      if (watchConnectCoordinatorRequestIsCurrent(
        requestedAccountId,
        currentAccountIdRef.current,
        requestedAccountGeneration,
        accountGenerationRef.current,
      ) && accountBoundarySealRequestKeyRef.current === sealKey) {
        setSealingEarlierSession(false);
      }
    }
  }, [accountId, clearAllRelays, getWatchConnectState]);

  useEffect(() => {
    if (!onPairedIPhone || authStatus !== 'signed-in' || !accountBoundarySealKey) return;
    void sealEarlierSession(accountBoundarySealKey).catch(() => undefined);
  }, [accountBoundarySealKey, authStatus, onPairedIPhone, sealEarlierSession]);

  useEffect(() => {
    const pending = pendingStartConnectionRef.current;
    if (!pending || !nativeState || !accountId || hydratedAccountId !== accountId) return;
    // startWatchConnectAction owns rollback until its native promise settles.
    // In particular, the optimistic server identity can render while native is
    // still inactive; treating that instant as terminal would cancel the same
    // start before Apple Watch has a chance to answer.
    if (connectPromiseRef.current) return;
    const requestedAccountId = accountId;
    const requestedAccountGeneration = accountGenerationRef.current;
    const requestIsCurrent = () => watchConnectCoordinatorRequestIsCurrent(
      requestedAccountId,
      currentAccountIdRef.current,
      requestedAccountGeneration,
      accountGenerationRef.current,
    );
    const exact = nativeState.scope === pending.scope
      && nativeState.connectionId === pending.id
      && nativeState.sessionId === `watch-connect:${pending.id}`
      && nativeState.connectedUntil === pending.connectedUntil;
    const cloudConnected = snapshot.connections.some((candidate) => (
      candidate.id === pending.id && candidate.state === 'connected'
    ));
    if (nativeState.state === 'connected' && exact && cloudConnected) {
      pendingStartConnectionRef.current = null;
      setActionDetail('Ready for every TrackLab program during this four-hour session.');
      return;
    }
    if ((nativeState.state === 'connecting' || nativeState.state === 'connected') && exact) return;
    const terminal = ['error', 'reconnect', 'inactive'].includes(nativeState.state);
    const mismatchedActive = ['connecting', 'connected'].includes(nativeState.state) && !exact;
    if (!terminal && !mismatchedActive) return;
    setBusy(true);
    void (async () => {
      if (nativeState.connectionId === pending.id) await stopWatchConnect().catch(() => undefined);
      if (!requestIsCurrent()) return;
      const { connection: stopped } = await finishWatchConnectDisconnect(pending, {});
      if (!requestIsCurrent()) return;
      setSnapshot((current) => ({
        ...current,
        connections: [stopped, ...current.connections.filter((item) => item.id !== stopped.id)],
      }));
      if (pendingStartConnectionRef.current?.id === pending.id) {
        pendingStartConnectionRef.current = null;
      }
      setActionDetail(nativeState.reason || 'Watch did not connect. Press Watch Connect to try again.');
    })().catch((error: unknown) => {
      if (requestIsCurrent()) setActionDetail(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (requestIsCurrent()) setBusy(false);
    });
  }, [accountId, hydratedAccountId, nativeState, snapshot.connections, stopWatchConnect]);

  const connect = useCallback((automaticRecovery = false) => {
    if (!onPairedIPhone) return Promise.resolve();
    const operation = runWatchConnectSingleFlight(connectPromiseRef, async () => {
      if (accountBoundarySealKey) {
        await sealEarlierSession(accountBoundarySealKey).catch(() => undefined);
        return;
      }
      if (watchConnectLegacyHeartRateIsBusy(status, relayState)) {
        const message = 'Finish syncing your current Apple Watch session, then press Watch Connect.';
        setActionDetail(message);
        onMessage?.(message);
        return;
      }
      const actionAccountId = accountId;
      if (!actionAccountId) return;
      const actionAccountGeneration = accountGenerationRef.current;
      const actionIsCurrent = () => watchConnectCoordinatorRequestIsCurrent(
        actionAccountId,
        currentAccountIdRef.current,
        actionAccountGeneration,
        accountGenerationRef.current,
        currentAuthStatusRef.current,
      );
      setBusy(true);
      setActionDetail('Connecting…');
      requestIdsRef.current ??= {
        enrollment: createWatchConnectRequestId('watch-connect-enrollment'),
        connection: createWatchConnectRequestId('watch-connect-session'),
      };
      const preparedStart = { current: null as {
        connection: WatchConnectConnection;
        pairingId: string;
      } | null };
      try {
      const savedStudioConsent = watchConnectStudioConsentForStart(
        enrollment,
        liveStudioConsent,
        sessionStudioConsent,
      );
      const started = await startWatchConnectAction({
        scope,
        baseUrl: window.location.origin,
        ...(clubId ? { clubId } : {}),
        ...(enrollment ? { existingEnrollment: enrollment } : {}),
        ...(scope === 'studio' ? {
          liveStudioConsent: savedStudioConsent.live,
          sessionStudioConsent: savedStudioConsent.session,
        } : {}),
        enrollmentRequestId: requestIdsRef.current.enrollment,
        connectionRequestId: requestIdsRef.current.connection,
      }, {
        onConnectionCreated: ({ connection: preparedConnection, pairingId }) => {
          preparedStart.current = { connection: preparedConnection, pairingId };
          if (!actionIsCurrent()) return;
          knownPairingIds?.add(pairingId);
          // This ref write must precede startNative. Native iOS can emit its
          // exact `connecting` event synchronously, before that promise returns.
          pendingStartConnectionRef.current = preparedConnection;
        },
        getIdentity: async () => {
          const identity = await getWatchConnectIdentity();
          if (!actionIsCurrent()) throw new Error('Watch Connect start was cancelled.');
          if (!identity) throw new Error('Use the TrackLab iPhone app paired with this Apple Watch.');
          return identity;
        },
        getNativeState: async () => nativeResultFromState(await getWatchConnectState()),
        startNative: async (options) => {
          if (!actionIsCurrent()) throw new Error('Watch Connect start was cancelled.');
          return nativeResultFromState(await startWatchConnect(options));
        },
        stopNative: async () => nativeResultFromState(await stopWatchConnect()),
      });
      if (!actionIsCurrent()) {
        if (pendingStartConnectionRef.current?.id === started.connection.id) {
          pendingStartConnectionRef.current = null;
        }
        await cleanupStaleWatchConnectStart({
          connection: started.connection,
          pairingId: started.pairingId,
          getNativeState: getWatchConnectState,
          stopNative: stopWatchConnect,
        });
        knownPairingIds?.delete(started.pairingId);
        return;
      }
      requestIdsRef.current = null;
      setRecoveryRetryConnectionId(null);
      setSnapshot((current) => ({
        enrollments: [
          started.enrollment,
          ...current.enrollments.filter((item) => item.id !== started.enrollment.id),
        ],
        connections: [
          started.connection,
          ...current.connections.filter((item) => item.id !== started.connection.id),
        ],
      }));
      setNativeState({
        version: 1,
        state: started.native.state,
        scope,
        connectionId: started.native.connectionId,
        sessionId: `watch-connect:${started.connection.id}`,
        connectedUntil: started.native.connectedUntil,
        remainingMs: started.native.remainingMs,
        requiresUserStart: started.native.requiresUserStart,
        workoutReady: started.native.workoutReady,
        relayConfigured: started.native.relayConfigured,
        ...(started.native.reason ? { reason: started.native.reason } : {}),
      });
      pendingStartConnectionRef.current = started.connection.state === 'connecting'
        ? started.connection
        : null;
      setActionDetail(started.native.state === 'connected'
        ? 'Ready for every TrackLab program during this four-hour session.'
        : 'Confirm TrackLab on Apple Watch to finish connecting.');
      onMessage?.('Watch Connect started for four hours.');
      } catch (error) {
        if (!actionIsCurrent()) {
          if (preparedStart.current) {
            await cleanupStaleWatchConnectStart({
              connection: preparedStart.current.connection,
              pairingId: preparedStart.current.pairingId,
              getNativeState: getWatchConnectState,
              stopNative: stopWatchConnect,
            });
            knownPairingIds?.delete(preparedStart.current.pairingId);
          }
          return;
        }
        if (automaticRecovery && connection?.state === 'connecting') {
          setRecoveryRetryConnectionId(connection.id);
        }
        if (!(error instanceof WatchConnectStartError) || !error.reuseRequestIds) {
          requestIdsRef.current = null;
        }
        setActionDetail(error instanceof Error ? error.message : String(error));
        onMessage?.(error instanceof Error ? error.message : String(error));
        await refresh().catch(() => undefined);
      } finally {
        if (actionIsCurrent()) setBusy(false);
      }
    });
    actionPromises?.add(operation);
    void operation.finally(() => actionPromises?.delete(operation)).catch(() => undefined);
    return operation;
  }, [
    actionPromises,
    clubId,
    accountId,
    accountBoundarySealKey,
    connection,
    getWatchConnectIdentity,
    getWatchConnectState,
    hydratedAccountId,
    enrollment,
    liveStudioConsent,
    onMessage,
    onPairedIPhone,
    knownPairingIds,
    relayState,
    refresh,
    scope,
    sealEarlierSession,
    sessionStudioConsent,
    snapshot.connections,
    startWatchConnect,
    status,
    stopWatchConnect,
  ]);

  useEffect(() => {
    if (connection?.state !== 'connecting') {
      recoveryAttemptedConnectionRef.current = null;
      setRecoveryRetryConnectionId(null);
      return;
    }
    if (!watchConnectNeedsCredentialRecovery({
      accountId,
      hydratedAccountId,
      enrollment,
      connection,
      native: nativeState,
      inFlight: Boolean(connectPromiseRef.current || pendingStartConnectionRef.current),
      now,
    })) return;
    if (recoveryAttemptedConnectionRef.current === connection.id) return;
    recoveryAttemptedConnectionRef.current = connection.id;
    void connect(true);
  }, [accountId, connect, connection, enrollment, hydratedAccountId, nativeState, now]);

  const disconnect = useCallback(async (forgetEnrollmentId: string | null = null) => {
    if (!connection || !onPairedIPhone || !accountId) return;
    const requestedAccountId = accountId;
    const requestedAccountGeneration = accountGenerationRef.current;
    const requestIsCurrent = () => watchConnectCoordinatorRequestIsCurrent(
      requestedAccountId,
      currentAccountIdRef.current,
      requestedAccountGeneration,
      accountGenerationRef.current,
    );
    setBusy(true);
    setActionDetail('Syncing…');
    try {
      const native = nativeResultFromState(await stopWatchConnect());
      if (native.state === 'error') {
        throw new Error(native.reason || 'Watch Connect could not stop safely.');
      }
      if (!requestIsCurrent()) return;
      const stopped = await finishWatchConnectDisconnect(connection, {});
      if (!requestIsCurrent()) return;
      setSnapshot((current) => ({
        ...current,
        connections: [stopped.connection, ...current.connections.filter((item) => item.id !== stopped.connection.id)],
      }));
      if (forgetEnrollmentId) {
        const forgotten = await forgetWatchConnectEnrollment(forgetEnrollmentId);
        if (!requestIsCurrent()) return;
        setSnapshot((current) => ({
          ...current,
          enrollments: [forgotten, ...current.enrollments.filter((item) => item.id !== forgotten.id)],
        }));
      }
      setActionDetail(forgetEnrollmentId ? 'Watch forgotten.' : 'Session ended.');
    } catch (error) {
      if (requestIsCurrent()) setActionDetail(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestIsCurrent()) setBusy(false);
    }
  }, [accountId, connection, onPairedIPhone, stopWatchConnect]);

  const forget = useCallback(async () => {
    if (!enrollment || !onPairedIPhone || !accountId) return;
    if (typeof window !== 'undefined' && !window.confirm(
      'Forget this Apple Watch? You will approve Apple Health and studio sharing again next time.',
    )) return;
    if (
      (connection?.state === 'connecting' || connection?.state === 'connected')
      && connection.connectedUntil > Date.now()
    ) {
      await disconnect(enrollment.id);
      return;
    }
    const requestedAccountId = accountId;
    const requestedAccountGeneration = accountGenerationRef.current;
    const requestIsCurrent = () => watchConnectCoordinatorRequestIsCurrent(
      requestedAccountId,
      currentAccountIdRef.current,
      requestedAccountGeneration,
      accountGenerationRef.current,
    );
    setBusy(true);
    try {
      const forgotten = await forgetWatchConnectEnrollment(enrollment.id);
      if (!requestIsCurrent()) return;
      setSnapshot((current) => ({
        ...current,
        enrollments: [forgotten, ...current.enrollments.filter((item) => item.id !== forgotten.id)],
      }));
      setActionDetail('Watch forgotten.');
    } catch (error) {
      if (requestIsCurrent()) setActionDetail(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestIsCurrent()) setBusy(false);
    }
  }, [accountId, connection, disconnect, enrollment, onPairedIPhone]);

  if (
    authStatus !== 'signed-in'
    || !accountId
  ) return null;
  return (
    <>
    {indicatorTarget && createPortal(
      <WatchConnectIndicator
        state={indicatorState}
        onOpenSettings={indicatorTarget.classList.contains('fullscreen')
          ? undefined
          : onOpenSettings}
      />,
      indicatorTarget,
    )}
    {portalTarget && createPortal(<>
    {capable === true && <WatchConnectCard
      athleteName={accountName}
      busy={actionBusy}
      context={scope === 'studio' ? 'studio' : 'personal'}
      disabled={hydratedAccountId !== accountId}
      enrolled={Boolean(enrollment)}
      liveStudioConsent={enrollment?.liveStudioConsent ?? liveStudioConsent}
      onConnect={onPairedIPhone ? () => { void connect(); } : undefined}
      onCheckAgain={availability?.platform === 'iphone' && availability.supported === false
        ? () => { void refreshAvailability(); }
        : undefined}
      onDisconnect={onPairedIPhone && connection?.state === 'connected'
        ? () => { void disconnect(); }
        : undefined}
      onForgetWatch={onPairedIPhone && enrollment ? () => { void forget(); } : undefined}
      onLiveStudioConsentChange={setLiveStudioConsent}
      onSessionStudioConsentChange={setSessionStudioConsent}
      onTargetChange={(value) => {
        setTargetClubId(value === 'personal' ? null : value);
        setLiveStudioConsent(false);
        setSessionStudioConsent(false);
        setActionDetail('');
        requestIdsRef.current = null;
        recoveryAttemptedConnectionRef.current = null;
        setRecoveryRetryConnectionId(null);
      }}
      sessionStudioConsent={enrollment?.sessionStudioConsent ?? sessionStudioConsent}
      state={cardState}
      studioName={selectedStudioContext?.clubName}
      targetDisabled={actionBusy || Boolean(nativeState && [
        'connecting',
        'connected',
        'disconnecting',
      ].includes(nativeState.state)) || Boolean(
        nativeState?.state === 'syncing' && viewState.phase !== 'ended',
      )}
      targetOptions={!readOnlyObserver && studioContexts.length > 0
        ? [
          { value: 'personal', label: 'My account' },
          ...studioContexts.map((context) => ({ value: context.clubId, label: context.clubName })),
        ]
        : undefined}
      targetValue={clubId ?? 'personal'}
      retryWhileConnecting={!readOnlyObserver && (recoveryRetryConnectionId === connection?.id || watchConnectCanRetryCloudConnection({
        accountId,
        hydratedAccountId,
        connection,
        native: nativeState,
      }))}
      showWatchInstall={!readOnlyObserver && watchAppNeedsInstall(availability)}
      latestHeartRate={exactLiveHeartRate}
      now={now}
      observer={readOnlyObserver}
    />}
    {ownedStudio && <OwnerStudioWatchConnectSettings studio={ownedStudio} />}
    </>, portalTarget)}
    </>
  );
}

export default WatchConnectCoordinator;
