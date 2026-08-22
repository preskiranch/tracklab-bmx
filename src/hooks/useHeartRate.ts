import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HeartRateMeasurement, PrivateHeartRateSample } from '../types';
import {
  defaultHeartRateFreshnessMs,
  isHeartRateMeasurementFresh,
  mapHeartRateMeasurementsToActiveClock,
  mergeHeartRateMeasurement,
  type HeartRateActiveClockSegment,
} from '../lib/heartRate';
import type {
  NativeHeartRateAvailability,
  NativeHeartRateClient,
  NativeHeartRateRelayConfiguration,
  NativeHeartRateRelayClockUpdate,
  NativeHeartRateRelayFinalization,
  NativeHeartRateRelaySessionTarget,
  NativeHeartRateRelaySnapshot,
  NativeHeartRateRelayState,
  NativeHeartRateStatus,
  NativeWatchConnectIdentity,
  NativeWatchConnectStart,
  NativeWatchConnectState,
} from '../lib/nativeHeartRate';

export type HeartRateReadingState =
  | 'checking'
  | 'unavailable'
  | 'idle'
  | 'connecting'
  | 'missing'
  | 'live'
  | 'stale'
  | 'paused'
  | 'error';

export type UseHeartRateOptions = Readonly<{
  sessionId?: string | null;
  activeClockSegments?: readonly HeartRateActiveClockSegment[];
  enabled?: boolean;
  freshnessMs?: number;
  maximumSamples?: number;
  client?: NativeHeartRateClient;
}>;

export type UseHeartRateResult = Readonly<{
  availability: NativeHeartRateAvailability | null;
  status: NativeHeartRateStatus | null;
  relayState: NativeHeartRateRelaySnapshot | null;
  watchConnect: NativeWatchConnectState | null;
  readingState: HeartRateReadingState;
  latest: HeartRateMeasurement | null;
  measurements: readonly HeartRateMeasurement[];
  samples: readonly PrivateHeartRateSample[];
  startWorkout: (sessionId?: string) => Promise<NativeHeartRateStatus>;
  pauseWorkout: () => Promise<NativeHeartRateStatus>;
  resumeWorkout: () => Promise<NativeHeartRateStatus>;
  endWorkout: () => Promise<NativeHeartRateStatus>;
  configureRelay: (options: NativeHeartRateRelayConfiguration) => Promise<NativeHeartRateRelayState>;
  pauseRelay: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  resumeRelay: (options: NativeHeartRateRelayClockUpdate) => Promise<NativeHeartRateRelayState>;
  finalizeRelay: (options: NativeHeartRateRelayFinalization) => Promise<NativeHeartRateRelayState>;
  clearRelay: (options: NativeHeartRateRelaySessionTarget) => Promise<NativeHeartRateRelayState>;
  clearAllRelays: () => Promise<NativeHeartRateRelayState>;
  getWatchConnectIdentity: () => Promise<NativeWatchConnectIdentity | null>;
  getWatchConnectState: () => Promise<NativeWatchConnectState>;
  startWatchConnect: (options: NativeWatchConnectStart) => Promise<NativeWatchConnectState>;
  stopWatchConnect: () => Promise<NativeWatchConnectState>;
  refreshAvailability: () => Promise<void>;
  clearSamples: () => void;
}>;

const noActiveClockSegments: readonly HeartRateActiveClockSegment[] = [];
let loadedNativeHeartRateClient: NativeHeartRateClient | null = null;
let nativeHeartRateClientPromise: Promise<NativeHeartRateClient> | null = null;

function loadNativeHeartRateClient() {
  nativeHeartRateClientPromise ??= import('../lib/nativeHeartRate').then(({ nativeHeartRate }) => {
    loadedNativeHeartRateClient = nativeHeartRate;
    return nativeHeartRate;
  });
  return nativeHeartRateClientPromise;
}

const lazyNativeHeartRate: NativeHeartRateClient = {
  isPluginAvailable: () => loadedNativeHeartRateClient?.isPluginAvailable() ?? false,
  getAvailability: () => loadNativeHeartRateClient().then((client) => client.getAvailability()),
  getState: () => loadNativeHeartRateClient().then((client) => client.getState()),
  startWorkout: (sessionId) => loadNativeHeartRateClient().then((client) => client.startWorkout(sessionId)),
  pauseWorkout: () => loadNativeHeartRateClient().then((client) => client.pauseWorkout()),
  resumeWorkout: () => loadNativeHeartRateClient().then((client) => client.resumeWorkout()),
  endWorkout: () => loadNativeHeartRateClient().then((client) => client.endWorkout()),
  configureRelay: (options) => loadNativeHeartRateClient().then((client) => client.configureRelay(options)),
  pauseRelay: (options) => loadNativeHeartRateClient().then((client) => client.pauseRelay(options)),
  resumeRelay: (options) => loadNativeHeartRateClient().then((client) => client.resumeRelay(options)),
  finalizeRelay: (options) => loadNativeHeartRateClient().then((client) => client.finalizeRelay(options)),
  clearRelay: (options) => loadNativeHeartRateClient().then((client) => client.clearRelay(options)),
  clearAllRelays: () => loadNativeHeartRateClient().then((client) => client.clearAllRelays()),
  getRelayState: () => loadNativeHeartRateClient().then((client) => client.getRelayState()),
  getWatchConnectIdentity: () => loadNativeHeartRateClient().then((client) => client.getWatchConnectIdentity()),
  getWatchConnectState: () => loadNativeHeartRateClient().then((client) => client.getWatchConnectState()),
  startWatchConnect: (options) => loadNativeHeartRateClient().then((client) => client.startWatchConnect(options)),
  stopWatchConnect: () => loadNativeHeartRateClient().then((client) => client.stopWatchConnect()),
  addSampleListener: (listener) => loadNativeHeartRateClient().then((client) => client.addSampleListener(listener)),
  addStatusListener: (listener) => loadNativeHeartRateClient().then((client) => client.addStatusListener(listener)),
  addRelayStatusListener: (listener) => loadNativeHeartRateClient().then((client) => client.addRelayStatusListener(listener)),
};

export function deriveHeartRateReadingState({
  availability,
  status,
  latest,
  now = Date.now(),
  freshnessMs = defaultHeartRateFreshnessMs,
}: {
  availability: NativeHeartRateAvailability | null;
  status: NativeHeartRateStatus | null;
  latest: HeartRateMeasurement | null;
  now?: number;
  freshnessMs?: number;
}): HeartRateReadingState {
  if (status?.state === 'error') return 'error';
  if (status?.state === 'unavailable') return 'unavailable';
  if (!availability) return 'checking';
  if (!availability.supported) return 'unavailable';
  if (status?.state === 'paused') return 'paused';
  if (status?.state === 'launching' || status?.state === 'connecting' || status?.state === 'ending') {
    return 'connecting';
  }
  if (status?.state !== 'active') return 'idle';
  if (!latest) return 'missing';
  return isHeartRateMeasurementFresh(latest, now, freshnessMs) ? 'live' : 'stale';
}

function latestMeasurement(measurements: readonly HeartRateMeasurement[]) {
  return measurements.length > 0 ? measurements.at(-1)! : null;
}

export function useHeartRate(options: UseHeartRateOptions = {}): UseHeartRateResult {
  const {
    sessionId = null,
    activeClockSegments = noActiveClockSegments,
    enabled = true,
    freshnessMs = defaultHeartRateFreshnessMs,
    maximumSamples = 12_000,
    client = lazyNativeHeartRate,
  } = options;
  const [availability, setAvailability] = useState<NativeHeartRateAvailability | null>(null);
  const [status, setStatus] = useState<NativeHeartRateStatus | null>(null);
  const [relayState, setRelayState] = useState<NativeHeartRateRelaySnapshot | null>(null);
  const [watchConnect, setWatchConnect] = useState<NativeWatchConnectState | null>(null);
  const [measurements, setMeasurements] = useState<HeartRateMeasurement[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const refreshAvailability = useCallback(async () => {
    if (!enabled) return;
    setAvailability(null);
    try {
      const nextAvailability = await client.getAvailability();
      setAvailability(nextAvailability);
      const nextStatus: NativeHeartRateStatus = nextAvailability.supported ? await client.getState() : {
        version: 1,
        state: 'unavailable',
        sessionId: null,
        ...(nextAvailability.reason ? { message: nextAvailability.reason } : {}),
        at: Date.now(),
      };
      setStatus(nextStatus);
      setWatchConnect(nextStatus.watchConnect ?? await client.getWatchConnectState());
      setRelayState(await client.getRelayState());
    } catch (error) {
      setStatus({
        version: 1,
        state: 'error',
        sessionId: null,
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
    }
    setNow(Date.now());
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled) {
      setAvailability(null);
      setStatus(null);
      setRelayState(null);
      setWatchConnect(null);
      setMeasurements([]);
      return undefined;
    }
    // Never carry a previous rider or training segment into a new session.
    setMeasurements([]);

    let cancelled = false;
    const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

    void Promise.all([
      client.addSampleListener((sample) => {
        if (cancelled || (sessionId && sample.sessionId !== sessionId)) return;
        setMeasurements((current) => mergeHeartRateMeasurement(current, sample, maximumSamples));
        setNow(Date.now());
      }),
      client.addStatusListener((nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        if (nextStatus.watchConnect) setWatchConnect(nextStatus.watchConnect);
        setNow(Date.now());
        // WCSession may finish activating after the first availability check.
        // Native republishes status at that boundary so paired/install state is
        // refreshed automatically and the Watch Connect action can appear.
        void client.getAvailability().then((nextAvailability) => {
          if (!cancelled) setAvailability(nextAvailability);
        }).catch(() => undefined);
      }),
      client.addRelayStatusListener((nextRelayState) => {
        if (cancelled) return;
        setRelayState(nextRelayState);
        setNow(Date.now());
      }),
    ]).then((handles) => {
      if (cancelled) {
        handles.forEach((handle) => void handle.remove());
        return;
      }
      listenerHandles.push(...handles);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setStatus({
        version: 1,
        state: 'error',
        sessionId: null,
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
    });

    void (async () => {
      try {
        const nextAvailability = await client.getAvailability();
        if (cancelled) return;
        setAvailability(nextAvailability);
        const nextStatus: NativeHeartRateStatus = nextAvailability.supported
          ? await client.getState()
          : {
            version: 1,
            state: 'unavailable',
            sessionId: null,
            ...(nextAvailability.reason ? { message: nextAvailability.reason } : {}),
            at: Date.now(),
          };
        if (!cancelled) {
          setStatus(nextStatus);
          setWatchConnect(nextStatus.watchConnect ?? await client.getWatchConnectState());
        }
        const nextRelayState = await client.getRelayState();
        if (!cancelled) setRelayState(nextRelayState);
      } catch (error) {
        if (cancelled) return;
        setStatus({
          version: 1,
          state: 'error',
          sessionId: null,
          message: error instanceof Error ? error.message : String(error),
          at: Date.now(),
        });
      }
    })();

    return () => {
      cancelled = true;
      listenerHandles.forEach((handle) => void handle.remove());
    };
  }, [client, enabled, maximumSamples, sessionId]);

  const latest = latestMeasurement(measurements);
  const readingState = deriveHeartRateReadingState({
    availability,
    status,
    latest,
    now,
    freshnessMs,
  });

  useEffect(() => {
    if (readingState !== 'live' || !latest) return undefined;
    const expiresInMs = Math.max(50, latest.recordedAt + Math.max(0, freshnessMs) - Date.now() + 1);
    const timer = window.setTimeout(() => setNow(Date.now()), expiresInMs);
    return () => window.clearTimeout(timer);
  }, [freshnessMs, latest, readingState]);

  const samples = useMemo(() => (
    mapHeartRateMeasurementsToActiveClock(measurements, activeClockSegments)
  ), [activeClockSegments, measurements]);

  const updateStatusFromAction = useCallback(async (
    action: () => Promise<NativeHeartRateStatus>,
  ) => {
    const nextStatus = await action();
    setStatus(nextStatus);
    setNow(Date.now());
    return nextStatus;
  }, []);

  const startWorkout = useCallback((requestedSessionId?: string) => (
    updateStatusFromAction(() => client.startWorkout(requestedSessionId ?? sessionId ?? ''))
  ), [client, sessionId, updateStatusFromAction]);
  const pauseWorkout = useCallback(() => (
    updateStatusFromAction(() => client.pauseWorkout())
  ), [client, updateStatusFromAction]);
  const resumeWorkout = useCallback(() => (
    updateStatusFromAction(() => client.resumeWorkout())
  ), [client, updateStatusFromAction]);
  const endWorkout = useCallback(() => (
    updateStatusFromAction(() => client.endWorkout())
  ), [client, updateStatusFromAction]);
  const getWatchConnectIdentity = useCallback(() => (
    client.getWatchConnectIdentity()
  ), [client]);
  const getWatchConnectState = useCallback(async () => {
    const next = await client.getWatchConnectState();
    setWatchConnect(next);
    return next;
  }, [client]);
  const startWatchConnect = useCallback(async (configuration: NativeWatchConnectStart) => {
    const next = await client.startWatchConnect(configuration);
    setWatchConnect(next);
    return next;
  }, [client]);
  const stopWatchConnect = useCallback(async () => {
    const next = await client.stopWatchConnect();
    setWatchConnect(next);
    return next;
  }, [client]);
  const configureRelay = useCallback((configuration: NativeHeartRateRelayConfiguration) => (
    client.configureRelay(configuration).then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const pauseRelay = useCallback((clock: NativeHeartRateRelayClockUpdate) => (
    client.pauseRelay(clock).then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const resumeRelay = useCallback((clock: NativeHeartRateRelayClockUpdate) => (
    client.resumeRelay(clock).then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const finalizeRelay = useCallback((configuration: NativeHeartRateRelayFinalization) => (
    client.finalizeRelay(configuration).then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const clearRelay = useCallback((target: NativeHeartRateRelaySessionTarget) => (
    client.clearRelay(target).then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const clearAllRelays = useCallback(() => (
    client.clearAllRelays().then(async (result) => {
      setRelayState(await client.getRelayState());
      return result;
    })
  ), [client]);
  const clearSamples = useCallback(() => setMeasurements([]), []);

  return useMemo(() => ({
    availability,
    status,
    relayState,
    watchConnect,
    readingState,
    latest,
    measurements,
    samples,
    startWorkout,
    pauseWorkout,
    resumeWorkout,
    endWorkout,
    configureRelay,
    pauseRelay,
    resumeRelay,
    finalizeRelay,
    clearRelay,
    clearAllRelays,
    getWatchConnectIdentity,
    getWatchConnectState,
    startWatchConnect,
    stopWatchConnect,
    refreshAvailability,
    clearSamples,
  }), [
    availability,
    clearAllRelays,
    clearRelay,
    clearSamples,
    configureRelay,
    endWorkout,
    finalizeRelay,
    getWatchConnectIdentity,
    getWatchConnectState,
    latest,
    measurements,
    pauseWorkout,
    pauseRelay,
    readingState,
    relayState,
    refreshAvailability,
    resumeRelay,
    resumeWorkout,
    samples,
    startWorkout,
    startWatchConnect,
    status,
    stopWatchConnect,
    watchConnect,
  ]);
}
