import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  RecoveryActivityType,
  RecoveryAlertPreference,
  RecoveryEffortSummary,
  RecoveryEpisode,
} from '../lib/recoveryAlert';
import {
  addRecoveryTime,
  createRecoveryEpisode,
  loadActiveRecoveryEpisode,
  loadRecoveryAlertPreference,
  saveRecoveryAlertPreference,
  startRecoveryAnyway,
  stopRecoveryEpisode,
  submitRecoveryHeartRate,
} from '../lib/recoveryAlertCloud';
import {
  getNativeRecoveryAccountBoundaryGeneration,
  openNativeRecoveryAccountBoundary,
  type NativeRecoveryPermission,
} from '../lib/nativeRecoveryAlerts';
import {
  getNativeRecoveryPushDeliveryState,
  resolveRecoveryNotificationDelivery,
  subscribeNativeRecoveryPushDelivery,
} from '../lib/nativeRecoveryPushDelivery';
import {
  RecoveryAlertCard,
  recoveryDraftFromPreferences,
  type RecoveryAlertDraft,
} from './RecoveryAlertCard';
import './RecoveryAlertCard.css';

export type RecoveryRaceSnapshot = Readonly<{
  activityType: Extract<RecoveryActivityType, 'bmx-race' | 'straight-sprint'>;
  sessionId: string;
  startedAt: number | null;
  source: 'live' | 'demo';
  players: readonly Readonly<{
    playerId: string | number;
    riderId?: string;
  }>[];
  riders: readonly Readonly<{
    playerId: string | number;
    finishedAt: number | null;
  }>[];
}>;

export type RecoveryGetPulledResult = Readonly<{
  id: string;
  riderId?: string;
  startedAt: number;
  endedAt: number;
  averageWatts: number;
  peakWatts: number;
  averageCadence: number;
  peakCadence: number;
  averageSpeedKph: number;
  peakSpeedKph: number;
}>;

export type RecoveryFinishSignal = Readonly<{
  requestId: string;
  athleteId: string;
  activityType: RecoveryActivityType;
  sessionId: string;
  repetitionId: string;
  finishedAt: number;
  effortSummary: RecoveryEffortSummary;
}>;

export type RecoveryLatestHeartRate = Readonly<{
  streamId: string;
  bpm: number;
  recordedAt: number;
}>;

type NativeEpisodeSnapshot = Readonly<{
  accountId: string | null;
  recoveryId: string | null;
  repetitionId: string | null;
  plannedReadyAt: number | null;
  fallbackAt: number | null;
  readyAt: number | null;
}>;

type RecoveryAlertCoordinatorProps = Readonly<{
  accountId: string;
  mode: 'race' | 'straight-sprint' | 'get-pulled';
  raceCapture: Readonly<{
    sessionId: string;
    startedAt: number | null;
    source: 'live' | 'demo';
    players: readonly Readonly<{
      id: string | number;
      riderId?: string;
    }>[];
  }> | null;
  raceRiders: readonly Readonly<{
    playerId: string | number;
    finishedAt: number | null;
  }>[];
  getPulledResult: RecoveryGetPulledResult | null;
  latestHeartRate: RecoveryLatestHeartRate | null;
}>;

function normalizedRequestPart(value: string, maximumLength: number) {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, maximumLength) || 'unknown';
}

function stableRequestHash(value: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export function recoveryRequestId(sessionId: string, repetitionId: string) {
  const identity = `${sessionId}\u0000${repetitionId}`;
  return `recovery_${normalizedRequestPart(sessionId, 56)}_${normalizedRequestPart(repetitionId, 40)}_${stableRequestHash(identity)}`;
}

export function recoverySubmissionRetryDelayMs(attempt: number) {
  return Math.min(60_000, 2_000 * (2 ** Math.min(5, Math.max(0, attempt - 1))));
}

export function recoverySubmissionCanRetry(attempt: number) {
  return attempt <= 6;
}

export function recoveryHeartRateCanSubmit(
  episode: RecoveryEpisode | null,
  latest: RecoveryLatestHeartRate | null,
  now = Date.now(),
) {
  return Boolean(
    episode
    && (episode.mode === 'heart-rate' || episode.mode === 'smart')
    && latest?.streamId
    && latest.recordedAt >= episode.startedAt
    && now - latest.recordedAt <= 10_000,
  );
}

export function retainPendingRecoveryFinishSignals(
  pending: ReadonlyMap<string, RecoveryFinishSignal>,
  observed: readonly RecoveryFinishSignal[],
  maximum = 32,
) {
  const next = new Map(pending);
  observed.forEach((signal) => next.set(signal.requestId, signal));
  while (next.size > maximum) {
    const oldest = next.keys().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

export function nativeRecoveryScheduleRequired(
  state: NativeEpisodeSnapshot,
  accountId: string,
  episode: RecoveryEpisode,
) {
  return state.accountId !== accountId
    || state.recoveryId !== episode.id
    || state.repetitionId !== episode.repetitionId
    || state.plannedReadyAt !== episode.plannedReadyAt
    || state.fallbackAt !== episode.fallbackAt
    || state.readyAt !== episode.readyAt;
}

export function nativeRecoveryMustRemainCleared(episode: RecoveryEpisode | null) {
  return episode?.alertTrigger === 'manual' || episode?.state === 'cancelled';
}

export function nativeRecoveryPermissionNeedsPrompt(
  mode: RecoveryAlertPreference['mode'],
  permission: NativeRecoveryPermission,
) {
  return mode !== 'off' && permission.supported && permission.status === 'not-determined';
}

export function nativeRecoveryPermissionWarning(
  mode: RecoveryAlertPreference['mode'],
  permission: NativeRecoveryPermission,
) {
  return mode !== 'off' && permission.supported && !permission.alertsEnabled
    ? 'Recovery Alert is on. Allow TrackLab notifications in this device’s Settings for background alerts. In-app alerts still work.'
    : '';
}

/** Rider finish values are elapsed milliseconds from the exact gate drop. */
export function raceRecoveryFinishSignals(snapshot: RecoveryRaceSnapshot | null) {
  if (!snapshot || snapshot.source !== 'live' || snapshot.startedAt == null) return [];
  const startedAt = snapshot.startedAt;
  const playerById = new Map(snapshot.players.map((player) => [`${player.playerId}`, player]));
  return snapshot.riders.flatMap<RecoveryFinishSignal>((rider) => {
    if (rider.finishedAt == null || rider.finishedAt < 0) return [];
    const player = playerById.get(`${rider.playerId}`);
    if (!player?.riderId) return [];
    const repetitionId = `${snapshot.activityType}:${snapshot.sessionId}:player-${rider.playerId}`;
    return [{
      requestId: recoveryRequestId(snapshot.sessionId, repetitionId),
      athleteId: player.riderId,
      activityType: snapshot.activityType,
      sessionId: snapshot.sessionId,
      repetitionId,
      finishedAt: startedAt + rider.finishedAt,
      effortSummary: { finishTimeMs: rider.finishedAt },
    }];
  });
}

export function getPulledRecoveryFinishSignal(
  result: RecoveryGetPulledResult | null,
): RecoveryFinishSignal | null {
  if (!result?.riderId || result.endedAt < result.startedAt) return null;
  // Get Pulled result IDs may originate in older shells that embedded an
  // account rider ID. Hash the frozen result identity before it crosses the
  // cloud/native/Watch boundary; only athleteId remains local for selection.
  const identitySeed = `${result.id}\u0000${result.startedAt}\u0000${result.endedAt}`;
  const opaqueIdentity = `${stableRequestHash(`session\u0000${identitySeed}`)}${stableRequestHash(`rep\u0000${identitySeed}`)}`;
  const sessionId = `recovery-pull-${opaqueIdentity}`;
  const repetitionId = `get-pulled-rep-${opaqueIdentity}`;
  return {
    requestId: recoveryRequestId(sessionId, repetitionId),
    athleteId: result.riderId,
    activityType: 'get-pulled',
    sessionId,
    repetitionId,
    finishedAt: result.endedAt,
    effortSummary: {
      workDurationMs: result.endedAt - result.startedAt,
      averagePowerWatts: result.averageWatts,
      peakPowerWatts: result.peakWatts,
      peakCadenceRpm: result.peakCadence,
      peakSpeedMps: result.peakSpeedKph / 3.6,
    },
  };
}

function actionableEpisode(episode: RecoveryEpisode | null) {
  return episode?.state === 'cancelled' ? null : episode;
}

export function RecoveryAlertCoordinator({
  accountId,
  mode,
  raceCapture,
  raceRiders,
  getPulledResult,
  latestHeartRate,
}: RecoveryAlertCoordinatorProps) {
  const activityType: RecoveryActivityType = mode === 'race' ? 'bmx-race' : mode;
  const accountRiderId = `account:${accountId}`;
  const [preference, setPreference] = useState<RecoveryAlertPreference | null>(null);
  const [draft, setDraft] = useState<RecoveryAlertDraft>(() => recoveryDraftFromPreferences(null));
  const [episode, setEpisode] = useState<RecoveryEpisode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [nativeAlertsAvailable, setNativeAlertsAvailable] = useState<boolean | null>(null);
  const [recoveryAccountId, setRecoveryAccountId] = useState<string | null>(null);
  const [serverPushDeliveryAvailable, setServerPushDeliveryAvailable] = useState<boolean | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const submittedRequestIdsRef = useRef(new Set<string>());
  const pendingFinishSignalsRef = useRef(new Map<string, RecoveryFinishSignal>());
  const submissionAttemptsRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Map<string, number>());
  const submittingHeartRateRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const activeUserAccountIdRef = useRef(accountId);
  const hydrationGenerationRef = useRef(0);
  activeUserAccountIdRef.current = accountId;
  const nativePushDelivery = useSyncExternalStore(
    subscribeNativeRecoveryPushDelivery,
    getNativeRecoveryPushDeliveryState,
    getNativeRecoveryPushDeliveryState,
  );
  const notificationDelivery = resolveRecoveryNotificationDelivery({
    accountId,
    serverPushDeliveryAvailable,
    nativePush: nativePushDelivery,
  });
  const notificationDeliveryRef = useRef(notificationDelivery);
  notificationDeliveryRef.current = notificationDelivery;

  const finishSignals = useMemo(() => {
    const raceSnapshot: RecoveryRaceSnapshot | null = activityType !== 'get-pulled' && raceCapture ? {
      activityType,
      sessionId: raceCapture.sessionId,
      startedAt: raceCapture.startedAt,
      source: raceCapture.source,
      // RaceCapture freezes identity at arm. A Wattbike reconnect/re-index
      // must never move recovery to another rider.
      players: raceCapture.players.map((player) => ({
        playerId: player.id,
        riderId: player.riderId,
      })),
      riders: raceRiders,
    } : null;
    const raceSignals = raceRecoveryFinishSignals(raceSnapshot);
    const pullSignal = activityType === 'get-pulled'
      ? getPulledRecoveryFinishSignal(getPulledResult)
      : null;
    return [...raceSignals, ...(pullSignal ? [pullSignal] : [])]
      .filter((signal) => signal.athleteId === accountRiderId);
  }, [accountRiderId, activityType, getPulledResult, raceCapture, raceRiders]);
  const finishSignalsRef = useRef(finishSignals);
  finishSignalsRef.current = finishSignals;
  const finishSignalKey = finishSignals.map((signal) => signal.requestId).join('|');
  const hasEpisode = episode != null;

  const refreshActive = useCallback(async () => {
    try {
      const active = await loadActiveRecoveryEpisode();
      const nextEpisode = actionableEpisode(active.episode);
      if (mountedRef.current && activeUserAccountIdRef.current === accountId) {
        setRecoveryAccountId(active.accountId);
        setEpisode(nextEpisode);
      }
      return nextEpisode;
    } catch (error) {
      if (mountedRef.current) {
        setMessage(error instanceof Error ? error.message : 'Recovery Alert status is temporarily unavailable.');
      }
      return null;
    }
  }, [accountId]);

  useEffect(() => {
    const generation = ++hydrationGenerationRef.current;
    let expectedBoundary = getNativeRecoveryAccountBoundaryGeneration();
    const isCurrentHydration = () => mountedRef.current
      && hydrationGenerationRef.current === generation
      && getNativeRecoveryAccountBoundaryGeneration() === expectedBoundary
      && activeUserAccountIdRef.current === accountId;
    mountedRef.current = true;
    submittedRequestIdsRef.current.clear();
    pendingFinishSignalsRef.current.clear();
    submissionAttemptsRef.current.clear();
    retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    retryTimersRef.current.clear();
    setPreference(null);
    setDraft(recoveryDraftFromPreferences(null));
    setEpisode(null);
    setRecoveryAccountId(null);
    setServerPushDeliveryAvailable(null);
    setNativeAlertsAvailable(null);
    setLoading(true);
    setSaving(false);
    setActionBusy(false);
    setMessage('');
    Promise.all([loadRecoveryAlertPreference(), loadActiveRecoveryEpisode()])
      .then(async ([preferenceResult, activeResult]) => {
        if (!isCurrentHydration()) return;
        if (preferenceResult.accountId !== activeResult.accountId) {
          throw new Error('Recovery Alert account binding changed while loading.');
        }
        const { nativeRecoveryAlerts } = await import('../lib/nativeRecoveryAlerts');
        if (!isCurrentHydration()) return;
        await nativeRecoveryAlerts.bindAccount(preferenceResult.accountId);
        if (!isCurrentHydration()) return;
        const nativeAvailable = nativeRecoveryAlerts.isPluginAvailable();
        setNativeAlertsAvailable(nativeAvailable);
        if (nativeAvailable && preferenceResult.preference.mode !== 'off') {
          const permission = await nativeRecoveryAlerts.getPermissionStatus();
          if (!isCurrentHydration()) return;
          const permissionWarning = nativeRecoveryPermissionWarning(
            preferenceResult.preference.mode,
            permission,
          );
          if (permissionWarning) setMessage(permissionWarning);
        }
        // Reopen native scheduling only after the newly authenticated account
        // has returned one exact opaque binding from both recovery endpoints
        // and native has atomically removed every foreign account plan.
        expectedBoundary = openNativeRecoveryAccountBoundary(preferenceResult.accountId);
        setRecoveryAccountId(preferenceResult.accountId);
        setServerPushDeliveryAvailable(preferenceResult.pushDeliveryAvailable);
        setPreference(preferenceResult.preference);
        setDraft(recoveryDraftFromPreferences(preferenceResult.preference));
        setEpisode(actionableEpisode(activeResult.episode));
      })
      .catch((error: unknown) => {
        if (!isCurrentHydration()) return;
        setMessage(error instanceof Error ? error.message : 'Recovery Alert could not load.');
      })
      .finally(() => {
        if (isCurrentHydration()) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
      hydrationGenerationRef.current += 1;
      retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      retryTimersRef.current.clear();
    };
  }, [accountId]);

  useEffect(() => {
    if (!recoveryAccountId) return;
    let disposed = false;
    const reconciliationGeneration = hydrationGenerationRef.current;
    const reconciliationBoundary = getNativeRecoveryAccountBoundaryGeneration();
    const reconciliationAccountId = recoveryAccountId;
    const reconciliationEpisode = episode;
    const isCurrentReconciliation = () => !disposed
      && mountedRef.current
      && hydrationGenerationRef.current === reconciliationGeneration
      && getNativeRecoveryAccountBoundaryGeneration() === reconciliationBoundary
      && activeUserAccountIdRef.current === accountId;
    void import('../lib/nativeRecoveryAlerts').then(async ({ nativeRecoveryAlerts }) => {
      if (!isCurrentReconciliation()) return;
      const available = nativeRecoveryAlerts.isPluginAvailable();
      setNativeAlertsAvailable(available);
      if (!available) return;
      const nativeState = await nativeRecoveryAlerts.getActiveEpisode(reconciliationAccountId);
      if (!isCurrentReconciliation()) return;
      if ((!reconciliationEpisode || nativeRecoveryMustRemainCleared(reconciliationEpisode))
        && nativeState.accountId === reconciliationAccountId
        && nativeState.recoveryId && nativeState.repetitionId) {
        await nativeRecoveryAlerts.cancelEpisode({
          accountId: reconciliationAccountId,
          recoveryId: nativeState.recoveryId,
          repetitionId: nativeState.repetitionId,
        }).catch(() => undefined);
        return;
      }
      // Remote APNs delivery is the single owner whenever this personal
      // installation is bound and the server can dispatch. During a pending
      // registration we also clear a local plan so it cannot race a successful
      // bind and show the athlete two notifications for one recovery episode.
      if (notificationDelivery !== 'local') {
        if (
          nativeState.accountId === reconciliationAccountId
          && nativeState.recoveryId
          && nativeState.repetitionId
        ) {
          await nativeRecoveryAlerts.cancelEpisode({
            accountId: reconciliationAccountId,
            recoveryId: nativeState.recoveryId,
            repetitionId: nativeState.repetitionId,
          }).catch(() => undefined);
        }
        return;
      }
      if (reconciliationEpisode
        && !nativeRecoveryMustRemainCleared(reconciliationEpisode)
        && nativeRecoveryScheduleRequired(
          nativeState,
          reconciliationAccountId,
          reconciliationEpisode,
        )) {
        if (!isCurrentReconciliation()) return;
        await nativeRecoveryAlerts.scheduleEpisode(
          reconciliationAccountId,
          reconciliationEpisode,
        ).catch(() => undefined);
      }
    }).catch(() => {
      if (isCurrentReconciliation()) setNativeAlertsAvailable(false);
    });
    return () => { disposed = true; };
  }, [episode?.id, episode?.updatedAt, notificationDelivery, recoveryAccountId]);

  useEffect(() => {
    if (!episode || episode.state === 'ready') return undefined;
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const timer = window.setInterval(() => {
      void refreshActive();
    }, 3_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(timer);
    };
  }, [episode?.id, episode?.state, refreshActive]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshActive();
    };
    const refreshWhenOnline = () => {
      submissionAttemptsRef.current.clear();
      setRetryRevision((revision) => revision + 1);
      void refreshActive();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    const idlePoll = hasEpisode ? null : window.setInterval(() => { void refreshActive(); }, 15_000);
    return () => {
      if (idlePoll != null) window.clearInterval(idlePoll);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, [hasEpisode, refreshActive]);

  useEffect(() => {
    if (!preference || preference.mode === 'off') return;
    const submissionGeneration = hydrationGenerationRef.current;
    const submissionBoundary = getNativeRecoveryAccountBoundaryGeneration();
    const isCurrentSubmission = () => mountedRef.current
      && hydrationGenerationRef.current === submissionGeneration
      && getNativeRecoveryAccountBoundaryGeneration() === submissionBoundary
      && activeUserAccountIdRef.current === accountId;
    pendingFinishSignalsRef.current = retainPendingRecoveryFinishSignals(
      pendingFinishSignalsRef.current,
      finishSignalsRef.current.filter(
        (signal) => !submittedRequestIdsRef.current.has(signal.requestId),
      ),
    );
    pendingFinishSignalsRef.current.forEach((signal) => {
      if (submittedRequestIdsRef.current.has(signal.requestId)) return;
      submittedRequestIdsRef.current.add(signal.requestId);
      void createRecoveryEpisode({
        requestId: signal.requestId,
        activityType: signal.activityType,
        sessionId: signal.sessionId,
        repetitionId: signal.repetitionId,
        finishedAt: signal.finishedAt,
        effortSummary: signal.effortSummary,
      })
        .then(async ({ accountId: opaqueAccountId, activeEpisode }) => {
          if (!isCurrentSubmission()) return;
          // The idempotent result may describe an older repetition whose first
          // response was lost. Only the server's same-transaction activeEpisode
          // is authoritative after a newer repetition has already started.
          const authoritativeActive = actionableEpisode(activeEpisode);
          submissionAttemptsRef.current.delete(signal.requestId);
          pendingFinishSignalsRef.current.delete(signal.requestId);
          const retryTimer = retryTimersRef.current.get(signal.requestId);
          if (retryTimer != null) window.clearTimeout(retryTimer);
          retryTimersRef.current.delete(signal.requestId);
          if (mountedRef.current) {
            setEpisode(authoritativeActive);
            setRecoveryAccountId(opaqueAccountId);
            setNow(Date.now());
            setMessage(authoritativeActive?.state === 'ready'
              ? 'Ready for next rep — start when you feel ready.'
              : authoritativeActive
                ? 'Recovery started at your exact finish.'
                : 'Recovery Alert is stopped.');
          }
          const { nativeRecoveryAlerts } = await import('../lib/nativeRecoveryAlerts');
          if (!isCurrentSubmission()) return;
          if (authoritativeActive
            && !nativeRecoveryMustRemainCleared(authoritativeActive)
            && notificationDeliveryRef.current === 'local'
            && nativeRecoveryAlerts.isPluginAvailable()) {
            await nativeRecoveryAlerts.scheduleEpisode(
              opaqueAccountId,
              authoritativeActive,
            ).catch(() => undefined);
          }
        })
        .catch((error: unknown) => {
          if (!isCurrentSubmission()) return;
          submittedRequestIdsRef.current.delete(signal.requestId);
          const attempt = (submissionAttemptsRef.current.get(signal.requestId) ?? 0) + 1;
          submissionAttemptsRef.current.set(signal.requestId, attempt);
          const previousTimer = retryTimersRef.current.get(signal.requestId);
          if (previousTimer != null) window.clearTimeout(previousTimer);
          if (recoverySubmissionCanRetry(attempt)) {
            const retryAfterMs = recoverySubmissionRetryDelayMs(attempt);
            retryTimersRef.current.set(signal.requestId, window.setTimeout(() => {
              retryTimersRef.current.delete(signal.requestId);
              if (isCurrentSubmission()) setRetryRevision((revision) => revision + 1);
            }, retryAfterMs));
          }
          if (!recoverySubmissionCanRetry(attempt)) {
            pendingFinishSignalsRef.current.delete(signal.requestId);
            submissionAttemptsRef.current.delete(signal.requestId);
          }
          if (isCurrentSubmission()) {
            setMessage(recoverySubmissionCanRetry(attempt)
              ? error instanceof Error ? `${error.message} Retrying safely.` : 'Recovery Alert will retry when the connection returns.'
              : 'Recovery Alert could not start for that repetition. Your training result is still saved.');
          }
        });
    });
  }, [accountId, finishSignalKey, preference?.mode, retryRevision]);

  useEffect(() => {
    if (!episode || !latestHeartRate || !recoveryHeartRateCanSubmit(episode, latestHeartRate)) return;
    const submissionKey = `${episode.id}:${latestHeartRate.streamId}:${latestHeartRate.recordedAt}`;
    if (submittingHeartRateRef.current === submissionKey) return;
    submittingHeartRateRef.current = submissionKey;
    void submitRecoveryHeartRate(episode.id, latestHeartRate)
      .then((updated) => {
        if (mountedRef.current && activeUserAccountIdRef.current === accountId) {
          setRecoveryAccountId(updated.accountId);
          setEpisode(actionableEpisode(updated.episode));
        }
      })
      .catch(() => undefined);
  }, [accountId, episode, latestHeartRate]);

  useEffect(() => {
    let disposed = false;
    let statusHandle: { remove: () => Promise<void> } | null = null;
    let readyHandle: { remove: () => Promise<void> } | null = null;
    if (!recoveryAccountId) return undefined;
    void import('../lib/nativeRecoveryAlerts').then(async ({ nativeRecoveryAlerts }) => {
      if (disposed || !nativeRecoveryAlerts.isPluginAvailable()) return;
      statusHandle = await nativeRecoveryAlerts.addStatusListener((event) => {
        if (event.accountId === recoveryAccountId && event.recoveryId === episode?.id) void refreshActive();
      });
      readyHandle = await nativeRecoveryAlerts.addReadyListener((event) => {
        if (event.accountId !== recoveryAccountId || event.recoveryId !== episode?.id) return;
        setMessage('Ready for next rep — start when you feel ready.');
        void refreshActive();
      });
      if (disposed) {
        await statusHandle.remove();
        await readyHandle.remove();
        statusHandle = null;
        readyHandle = null;
      }
    }).catch(() => undefined);
    return () => {
      disposed = true;
      void statusHandle?.remove();
      void readyHandle?.remove();
    };
  }, [episode?.id, recoveryAccountId, refreshActive]);

  const save = async () => {
    const savingForAccount = accountId;
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveRecoveryAlertPreference(draft);
      if (!mountedRef.current || activeUserAccountIdRef.current !== savingForAccount) return;
      setRecoveryAccountId(saved.accountId);
      setServerPushDeliveryAvailable(saved.pushDeliveryAvailable);
      setPreference(saved.preference);
      setDraft(recoveryDraftFromPreferences(saved.preference));
      setMessage(saved.preference.mode === 'off'
        ? 'Recovery Alert is off.'
        : 'Saved for Race Intervals, Straight Sprint, and Get Pulled.');
      if (saved.preference.mode !== 'off') {
        const { nativeRecoveryAlerts } = await import('../lib/nativeRecoveryAlerts');
        const available = nativeRecoveryAlerts.isPluginAvailable();
        setNativeAlertsAvailable(available);
        if (available) {
          const permission = await nativeRecoveryAlerts.requestPermission();
          if (!permission.alertsEnabled) {
            setMessage('Saved. Allow TrackLab notifications in this device’s Settings for background alerts. In-app alerts still work.');
          }
        }
      }
    } catch (error) {
      if (mountedRef.current && activeUserAccountIdRef.current === savingForAccount) {
        setMessage(error instanceof Error ? error.message : 'Recovery Alert could not be saved.');
      }
    } finally {
      if (mountedRef.current && activeUserAccountIdRef.current === savingForAccount) setSaving(false);
    }
  };

  const runAction = async (
    action: (episodeId: string) => Promise<{ accountId: string; episode: RecoveryEpisode }>,
    kind: 'add' | 'start' | 'stop',
  ) => {
    if (!episode) return;
    const actionForAccount = accountId;
    const actionGeneration = hydrationGenerationRef.current;
    const actionBoundary = getNativeRecoveryAccountBoundaryGeneration();
    const isCurrentAction = () => mountedRef.current
      && hydrationGenerationRef.current === actionGeneration
      && getNativeRecoveryAccountBoundaryGeneration() === actionBoundary
      && activeUserAccountIdRef.current === actionForAccount;
    setActionBusy(true);
    setMessage('');
    try {
      const updated = await action(episode.id);
      if (!isCurrentAction()) return;
      setRecoveryAccountId(updated.accountId);
      setEpisode(actionableEpisode(updated.episode));
      const { nativeRecoveryAlerts } = await import('../lib/nativeRecoveryAlerts');
      if (!isCurrentAction()) return;
      if (notificationDeliveryRef.current === 'local' && nativeRecoveryAlerts.isPluginAvailable()) {
        if (kind === 'add') {
          await nativeRecoveryAlerts.scheduleEpisode(updated.accountId, updated.episode).catch(() => undefined);
        } else if (kind === 'stop') {
          // Preserve the server's terminal revision so a delayed pre-Stop HR
          // response cannot re-arm this exact episode in native code.
          await nativeRecoveryAlerts.scheduleEpisode(updated.accountId, updated.episode).catch(() => undefined);
        } else {
          // Start anyway is an authoritative manual READY transition. Apply it
          // silently first, then clear the retained native record.
          await nativeRecoveryAlerts.scheduleEpisode(updated.accountId, updated.episode).catch(() => undefined);
          if (!isCurrentAction()) return;
          await nativeRecoveryAlerts.cancelEpisode({
            accountId: updated.accountId,
            recoveryId: episode.id,
            repetitionId: episode.repetitionId,
          }).catch(() => undefined);
        }
      }
      if (!isCurrentAction()) return;
      setMessage(kind === 'add'
        ? 'Added 30 seconds.'
        : kind === 'start'
          ? 'Ready for next rep — start when you feel ready.'
          : 'Recovery Alert stopped.');
    } catch (error) {
      if (isCurrentAction()) {
        setMessage(error instanceof Error ? error.message : 'Recovery Alert action did not finish.');
      }
    } finally {
      if (isCurrentAction()) setActionBusy(false);
    }
  };

  return (
    <RecoveryAlertCard
      draft={draft}
      savedPreferences={preference}
      episode={episode}
      latestHeartRate={latestHeartRate}
      now={now}
      loading={loading}
      saving={saving}
      actionBusy={actionBusy}
      message={message}
      nativeAlertsAvailable={nativeAlertsAvailable}
      onDraftChange={setDraft}
      onSave={() => { void save(); }}
      onAddTime={() => { void runAction((id) => addRecoveryTime(id, 30), 'add'); }}
      onStartAnyway={() => { void runAction(startRecoveryAnyway, 'start'); }}
      onStop={() => { void runAction(stopRecoveryEpisode, 'stop'); }}
    />
  );
}

export default RecoveryAlertCoordinator;
