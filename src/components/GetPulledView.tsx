import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Gauge, HeartPulse, Play, RotateCcw, TimerReset, Zap } from 'lucide-react';
import {
  addGetPulledSample,
  addGetPulledSampleThroughEnd,
  createGetPulledAccumulator,
  getPulledCountdownSeconds,
  getPulledDemoMetrics,
  getPulledAirSettings,
  getPulledMetrics,
  getPulledPresetSeconds,
  getPulledResultFromAccumulator,
  getPulledResultHoldMs,
  getPulledTakeoffSignal,
  normalizeGetPulledSeconds,
  normalizeGetPulledAirSetting,
  type GetPulledAccumulator,
  type GetPulledLiveState,
  type GetPulledPhase,
  type GetPulledResult,
} from '../lib/getPulled';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type {
  BikeSample,
  HeartRateMeasurement,
  PlayerSlot,
  SpeedUnit,
  StudioRider,
  StudioRiderAssignments,
} from '../types';
import { applyStudioRiderAssignments } from '../lib/studioRiders';
import { playStartGateTone, primeAudioCues } from '../lib/audioCues';
import {
  primeBikeRaceAudio,
  stopBikeRaceAudio,
  updateGetPulledBikeAudio,
} from '../lib/bikeRaceAudio';
import { PullSledScene } from './PullSledScene';
import './GetPulledView.css';
import { HeartRateMetric } from './HeartRateMetric';
import type { LiveHeartRateByPlayer } from './RaceRiderOverlay';
import { mapHeartRateMeasurementsToActiveClock, summarizeHeartRate } from '../lib/heartRate';

export const getPulledDeviceDisconnectGraceMs = 750;

export type GetPulledSessionArm = Readonly<{
  sessionId: string;
  playerId: PlayerSlot['id'];
  riderId?: string;
  riderName: string;
  deviceId: number;
  deviceLabel?: string;
  armedAt: number;
  durationMs: number;
  airSetting: number;
}>;

export type GetPulledSessionStart = Readonly<GetPulledSessionArm & {
  /** Exact Wattbike power-packet clock for the first fresh sample at >= 1 W. */
  startedAt: number;
}>;

export type GetPulledSessionCancellation = Readonly<GetPulledSessionArm & {
  canceledAt: number;
  phase: 'countdown' | 'armed' | 'active';
  reason: 'user-cancelled' | 'reset' | 'view-closed' | 'binding-changed' | 'authorization-failed';
  startedAt?: number;
}>;

function defaultGetPulledSessionNonce() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/** Freezes the exact athlete/bike assignment before the countdown begins. */
export function createGetPulledSessionArm(
  player: PlayerSlot,
  durationMs: number,
  airSetting: number,
  armedAt = Date.now(),
  createNonce: () => string = defaultGetPulledSessionNonce,
): GetPulledSessionArm | null {
  if (
    player.deviceId == null
    || !Number.isSafeInteger(armedAt)
    || armedAt < 0
    || !Number.isSafeInteger(durationMs)
    || durationMs < 1
  ) return null;
  const nonce = createNonce().trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/u.test(nonce)) return null;
  return Object.freeze({
    sessionId: `get-pulled:${nonce}`,
    playerId: player.id,
    ...(player.riderId ? { riderId: player.riderId } : {}),
    riderName: player.name,
    deviceId: player.deviceId,
    ...(player.deviceLabel ? { deviceLabel: player.deviceLabel } : {}),
    armedAt,
    durationMs,
    airSetting,
  });
}

export function getPulledSessionStartFromArm(
  arm: GetPulledSessionArm,
  startedAt: number,
): GetPulledSessionStart | null {
  if (!Number.isSafeInteger(startedAt) || startedAt < arm.armedAt) return null;
  return Object.freeze({ ...arm, startedAt });
}

export function getPulledSessionArmMatchesPlayer(
  arm: GetPulledSessionArm,
  player: PlayerSlot | null | undefined,
) {
  return Boolean(
    player
    && arm.playerId === player.id
    && arm.deviceId === player.deviceId
    && (arm.riderId ?? null) === (player.riderId ?? null)
    && arm.riderName === player.name,
  );
}

/**
 * Player slots are presentation seats and may be reindexed when other bikes go
 * stale. An armed live pull remains bound to its physical device and athlete;
 * only a real device disconnect or rider reassignment invalidates that arm.
 */
export function getPulledSessionArmMatchesLiveBinding(
  arm: GetPulledSessionArm,
  connectedPlayers: readonly PlayerSlot[],
  riderAssignments: StudioRiderAssignments,
  demoMode: boolean,
) {
  const playerOnArmedDevice = connectedPlayers.find(
    (player) => player.deviceId === arm.deviceId,
  );
  if (!playerOnArmedDevice) return false;
  if (demoMode) return getPulledSessionArmMatchesPlayer(arm, playerOnArmedDevice);
  return Boolean(arm.riderId && riderAssignments[arm.deviceId] === arm.riderId);
}

export function createGetPulledSessionCancellation(
  arm: GetPulledSessionArm,
  phase: GetPulledSessionCancellation['phase'],
  reason: GetPulledSessionCancellation['reason'],
  canceledAt: number,
  startedAt?: number,
): GetPulledSessionCancellation | null {
  if (
    !Number.isSafeInteger(canceledAt)
    || canceledAt < arm.armedAt
    || (startedAt != null && (!Number.isSafeInteger(startedAt) || startedAt < arm.armedAt || startedAt > canceledAt))
  ) return null;
  return Object.freeze({
    ...arm,
    canceledAt,
    phase,
    reason,
    ...(startedAt != null ? { startedAt } : {}),
  });
}

export function bindGetPulledResultToSession(
  result: GetPulledResult,
  session: GetPulledSessionStart | null,
) {
  return session ? { ...result, id: session.sessionId } : result;
}

export async function authorizeGetPulledSessionArm(
  arm: GetPulledSessionArm,
  authorize?: (session: GetPulledSessionArm) => void | boolean | Promise<void | boolean>,
) {
  return (await authorize?.(arm)) !== false;
}

type GetPulledViewProps = {
  demoMode: boolean;
  players: PlayerSlot[];
  riders: StudioRider[];
  riderAssignments: StudioRiderAssignments;
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  canAssignRiders?: boolean;
  fullscreen?: boolean;
  onAssignRider: (deviceId: number, riderId: string | null) => void;
  onComplete: (result: GetPulledResult) => void;
  onFullscreenChange?: (enabled: boolean) => void;
  onLiveStateChange: (state: GetPulledLiveState | null) => void;
  heartRateByPlayer?: LiveHeartRateByPlayer;
  onSessionArm?: (session: GetPulledSessionArm) => void | boolean | Promise<void | boolean>;
  onSessionStart?: (session: GetPulledSessionStart) => void;
  /** Legacy personal heart-rate relay cleanup callback. */
  onSessionCancel?: (sessionId: string) => void;
  onSessionCancelEvent?: (session: GetPulledSessionCancellation) => void;
  heartRateMeasurements?: readonly HeartRateMeasurement[];
};

function secondsLabel(seconds: number) {
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function phaseLabel(phase: GetPulledPhase) {
  if (phase === 'countdown') return 'Get ready';
  if (phase === 'armed') return 'Ready · reach 1 watt to start';
  if (phase === 'active') return 'Pulling now';
  if (phase === 'results') return 'Pull complete';
  return 'Choose athlete and time';
}

export function GetPulledView({
  demoMode,
  players,
  riders,
  riderAssignments,
  samplesByDevice,
  speedUnit,
  canAssignRiders = true,
  fullscreen = false,
  onAssignRider,
  onComplete,
  onFullscreenChange,
  onLiveStateChange,
  heartRateByPlayer = {},
  onSessionArm,
  onSessionStart,
  onSessionCancel,
  onSessionCancelEvent,
  heartRateMeasurements = [],
}: GetPulledViewProps) {
  const assignedPlayers = useMemo(
    () => demoMode ? players : applyStudioRiderAssignments(players, riders, riderAssignments),
    [demoMode, players, riderAssignments, riders],
  );
  const connectedPlayers = useMemo(
    () => assignedPlayers.filter((player) => player.deviceId != null),
    [assignedPlayers],
  );
  const rawPlayerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const connectedDeviceIds = useMemo(
    () => new Set(connectedPlayers.flatMap((player) => player.deviceId == null ? [] : [player.deviceId])),
    [connectedPlayers],
  );
  const assignedDeviceByRider = useMemo(() => {
    const next = new Map<string, number>();
    Object.entries(riderAssignments).forEach(([deviceId, riderId]) => {
      const numericDeviceId = Number(deviceId);
      if (connectedDeviceIds.has(numericDeviceId)) next.set(riderId, numericDeviceId);
    });
    return next;
  }, [connectedDeviceIds, riderAssignments]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerSlot['id'] | null>(connectedPlayers[0]?.id ?? null);
  const [durationSeconds, setDurationSeconds] = useState<number>(3);
  const [airSetting, setAirSetting] = useState(1);
  const [customSeconds, setCustomSeconds] = useState('10');
  const [customSelected, setCustomSelected] = useState(false);
  const [phase, setPhase] = useState<GetPulledPhase>('setup');
  const [countdown, setCountdown] = useState(getPulledCountdownSeconds);
  const [now, setNow] = useState(Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<GetPulledResult | null>(null);
  const accumulatorRef = useRef<GetPulledAccumulator>(createGetPulledAccumulator());
  const phaseRef = useRef<GetPulledPhase>('setup');
  const pedalArmedAtRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const lastCountdownToneRef = useRef<number | null>(null);
  const bindingLossTimerRef = useRef<number | null>(null);
  const sessionArmRef = useRef<GetPulledSessionArm | null>(null);
  const sessionStartRef = useRef<GetPulledSessionStart | null>(null);
  const sessionInputsRef = useRef<{
    player: PlayerSlot;
    durationSeconds: number;
    airSetting: number;
    demoMode: boolean;
  } | null>(null);
  const samplesByDeviceRef = useRef(samplesByDevice);
  const onCompleteRef = useRef(onComplete);
  samplesByDeviceRef.current = samplesByDevice;
  onCompleteRef.current = onComplete;
  const sessionCallbacksRef = useRef({ onSessionCancel, onSessionCancelEvent });
  sessionCallbacksRef.current = { onSessionCancel, onSessionCancelEvent };
  const viewCleanupCallbacksRef = useRef({ onFullscreenChange, onLiveStateChange });
  viewCleanupCallbacksRef.current = { onFullscreenChange, onLiveStateChange };
  const selectedPlayer = connectedPlayers.find((player) => player.id === selectedPlayerId) ?? null;
  const sessionInputs = phase === 'setup' ? null : sessionInputsRef.current;
  const sessionPlayer = sessionInputs?.player ?? selectedPlayer;
  const sessionDurationSeconds = sessionInputs?.durationSeconds ?? durationSeconds;
  const sessionAirSetting = sessionInputs?.airSetting ?? airSetting;
  const sessionDemoMode = sessionInputs?.demoMode ?? demoMode;
  const sample = sessionPlayer?.deviceId == null ? undefined : samplesByDevice.get(sessionPlayer.deviceId);
  const metrics = useMemo(() => {
    if (sessionDemoMode && phase === 'active' && startedAt != null) {
      return getPulledDemoMetrics(now - startedAt, sessionAirSetting);
    }
    return getPulledMetrics(sample, now);
  }, [now, phase, sample, sessionAirSetting, sessionDemoMode, startedAt]);
  const elapsedMs = phase === 'active' && startedAt != null
    ? Math.min(sessionDurationSeconds * 1_000, Math.max(0, now - startedAt))
    : result ? result.durationSeconds * 1_000 : 0;
  const progress = sessionDurationSeconds > 0
    ? Math.min(1, elapsedMs / (sessionDurationSeconds * 1_000))
    : 0;
  const selectedAthleteReady = demoMode || Boolean(selectedPlayer?.riderId);
  const selectedHeartRate = sessionPlayer ? heartRateByPlayer[sessionPlayer.id] : undefined;
  const heartRateSummary = useMemo(() => {
    if (startedAt == null) return null;
    const endedAt = result?.endedAt ?? Math.min(now, startedAt + sessionDurationSeconds * 1_000);
    const durationMs = Math.max(0, endedAt - startedAt);
    const samples = mapHeartRateMeasurementsToActiveClock(heartRateMeasurements, [{
      startedAt,
      endedAt,
      activeElapsedAtStartMs: 0,
    }]);
    return summarizeHeartRate(samples, { startElapsedMs: 0, endElapsedMs: durationMs });
  }, [heartRateMeasurements, now, result?.endedAt, sessionDurationSeconds, startedAt]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (selectedPlayerId != null && connectedPlayers.some((player) => player.id === selectedPlayerId)) return;
    setSelectedPlayerId(connectedPlayers[0]?.id ?? null);
  }, [connectedPlayers, selectedPlayerId]);

  const cancelSession = useCallback((reason: GetPulledSessionCancellation['reason']) => {
    const arm = sessionArmRef.current;
    const phaseAtCancel = phaseRef.current;
    if (
      !arm
      || completedRef.current
      || (phaseAtCancel !== 'countdown' && phaseAtCancel !== 'armed' && phaseAtCancel !== 'active')
    ) return;
    completedRef.current = true;
    const started = sessionStartRef.current;
    const cancellation = createGetPulledSessionCancellation(
      arm,
      phaseAtCancel,
      reason,
      Date.now(),
      started?.startedAt,
    );
    if (!cancellation) return;
    sessionCallbacksRef.current.onSessionCancelEvent?.(cancellation);
    // Existing personal Apple Watch sessions still receive the original
    // string-only callback and therefore remain backward compatible.
    sessionCallbacksRef.current.onSessionCancel?.(arm.sessionId);
    sessionArmRef.current = null;
    sessionStartRef.current = null;
    sessionInputsRef.current = null;
  }, []);

  const reset = useCallback((reason: GetPulledSessionCancellation['reason'] = 'reset') => {
    cancelSession(reason);
    if (bindingLossTimerRef.current != null) window.clearTimeout(bindingLossTimerRef.current);
    bindingLossTimerRef.current = null;
    sessionArmRef.current = null;
    sessionStartRef.current = null;
    sessionInputsRef.current = null;
    phaseRef.current = 'setup';
    completedRef.current = true;
    accumulatorRef.current = createGetPulledAccumulator();
    pedalArmedAtRef.current = null;
    setPhase('setup');
    setCountdown(getPulledCountdownSeconds);
    setStartedAt(null);
    setResult(null);
    setNow(Date.now());
    onLiveStateChange(null);
    onFullscreenChange?.(false);
    stopBikeRaceAudio();
  }, [cancelSession, onFullscreenChange, onLiveStateChange]);

  const primePullAudio = useCallback(() => {
    void primeAudioCues();
    void primeBikeRaceAudio();
  }, []);

  useEffect(() => {
    const arm = sessionArmRef.current;
    const sessionInFlight = phase === 'countdown' || phase === 'armed' || phase === 'active';
    if (!arm || !sessionInFlight) {
      if (bindingLossTimerRef.current != null) window.clearTimeout(bindingLossTimerRef.current);
      bindingLossTimerRef.current = null;
      return;
    }
    if (getPulledSessionArmMatchesLiveBinding(
      arm,
      connectedPlayers,
      riderAssignments,
      sessionInputsRef.current?.demoMode ?? demoMode,
    )) {
      if (bindingLossTimerRef.current != null) window.clearTimeout(bindingLossTimerRef.current);
      bindingLossTimerRef.current = null;
      return;
    }

    const armedDeviceStillConnected = connectedPlayers.some(
      (player) => player.deviceId === arm.deviceId,
    );
    if (armedDeviceStillConnected) {
      // The physical bike is still live, so this is a real athlete binding
      // change rather than transient connector reconciliation.
      reset('binding-changed');
      return;
    }
    if (bindingLossTimerRef.current != null) return;
    // Connected-bike lists can briefly omit a device while stale neighboring
    // seats are compacted or the connector resumes. Require continuous absence
    // before treating it as a genuine physical disconnect.
    bindingLossTimerRef.current = window.setTimeout(() => {
      bindingLossTimerRef.current = null;
      reset('binding-changed');
    }, getPulledDeviceDisconnectGraceMs);
  }, [connectedPlayers, demoMode, phase, reset, riderAssignments]);

  useEffect(() => () => {
    if (bindingLossTimerRef.current != null) window.clearTimeout(bindingLossTimerRef.current);
  }, []);

  const start = useCallback(async () => {
    if (
      !selectedPlayer
      || selectedPlayer.deviceId == null
      || (!demoMode && !selectedPlayer.riderId)
      || phaseRef.current !== 'setup'
    ) return;
    const arm = createGetPulledSessionArm(
      selectedPlayer,
      durationSeconds * 1_000,
      airSetting,
      Date.now(),
    );
    if (!arm) return;
    accumulatorRef.current = createGetPulledAccumulator();
    pedalArmedAtRef.current = null;
    sessionArmRef.current = arm;
    sessionStartRef.current = null;
    sessionInputsRef.current = Object.freeze({
      player: Object.freeze({ ...selectedPlayer }),
      durationSeconds,
      airSetting,
      demoMode,
    });
    completedRef.current = false;
    // Keep the visible setup still while an owner reservation and optional
    // Watch handoff are pending. The ref phase lets unmount/cancel emit the
    // exact arm cancellation without starting the countdown behind the dialog.
    phaseRef.current = 'countdown';
    let authorized = false;
    try {
      authorized = await authorizeGetPulledSessionArm(arm, onSessionArm);
    } catch {
      cancelSession('authorization-failed');
      phaseRef.current = 'setup';
      return;
    }
    if (!authorized || sessionArmRef.current !== arm || completedRef.current) {
      if (sessionArmRef.current === arm && !completedRef.current) cancelSession('user-cancelled');
      phaseRef.current = 'setup';
      return;
    }
    primePullAudio();
    onFullscreenChange?.(true);
    setResult(null);
    setCountdown(getPulledCountdownSeconds);
    phaseRef.current = 'countdown';
    lastCountdownToneRef.current = getPulledCountdownSeconds;
    playStartGateTone('tick');
    setPhase('countdown');
    setNow(Date.now());
  }, [airSetting, cancelSession, demoMode, durationSeconds, onFullscreenChange, onSessionArm, primePullAudio, selectedPlayer]);

  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    const countdownStartedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, getPulledCountdownSeconds - Math.floor((Date.now() - countdownStartedAt) / 1_000));
      setCountdown(remaining);
      setNow(Date.now());
      if (remaining !== lastCountdownToneRef.current) {
        lastCountdownToneRef.current = remaining;
        playStartGateTone(remaining > 0 ? 'tick' : 'gate');
      }
      if (remaining <= 0) {
        window.clearInterval(timer);
        const nextArmedAt = Date.now();
        accumulatorRef.current = createGetPulledAccumulator();
        pedalArmedAtRef.current = nextArmedAt;
        phaseRef.current = 'armed';
        setStartedAt(null);
        setPhase('armed');
        setNow(nextArmedAt);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [phase]);

  const beginPull = useCallback((takeoffAt: number, initialMetrics?: ReturnType<typeof getPulledMetrics>) => {
    const arm = sessionArmRef.current;
    const activeInputs = sessionInputsRef.current;
    if (phaseRef.current !== 'armed' || !arm || !activeInputs) return;
    const startedAtSignal = Math.max(pedalArmedAtRef.current ?? takeoffAt, takeoffAt);
    const session = getPulledSessionStartFromArm(arm, startedAtSignal);
    if (!session) return;
    accumulatorRef.current = initialMetrics
      ? addGetPulledSample(createGetPulledAccumulator(), initialMetrics, startedAtSignal)
      : createGetPulledAccumulator();
    completedRef.current = false;
    phaseRef.current = 'active';
    setStartedAt(startedAtSignal);
    setPhase('active');
    setNow(startedAtSignal);
    sessionStartRef.current = session;
    onSessionStart?.(session);
  }, [onSessionStart]);

  useEffect(() => {
    if (phase !== 'armed') return undefined;
    if (sessionDemoMode) {
      beginPull(Date.now());
      return undefined;
    }
    if (!sessionPlayer || sessionPlayer.deviceId == null || pedalArmedAtRef.current == null) return undefined;
    const takeoff = getPulledTakeoffSignal(
      samplesByDevice.get(sessionPlayer.deviceId),
      pedalArmedAtRef.current,
      Date.now(),
    );
    if (takeoff) beginPull(takeoff.at, takeoff.metrics);
    return undefined;
  }, [beginPull, phase, samplesByDevice, sessionDemoMode, sessionPlayer]);

  useEffect(() => {
    if (!sessionPlayer) {
      stopBikeRaceAudio();
      return;
    }
    updateGetPulledBikeAudio(
      phase === 'active' && metrics.cadence >= 1,
      sessionPlayer.id,
      metrics.cadence,
      metrics.speedKph,
    );
  }, [metrics.cadence, metrics.speedKph, phase, sessionPlayer]);

  useEffect(() => {
    if (phase !== 'active' || startedAt == null || !sessionInputsRef.current) return undefined;
    const timer = window.setInterval(() => {
      if (completedRef.current) return;
      const activeInputs = sessionInputsRef.current;
      if (!activeInputs) return;
      const sampleAt = Date.now();
      const endedAt = startedAt + activeInputs.durationSeconds * 1_000;
      const liveMetrics = activeInputs.demoMode
        ? getPulledDemoMetrics(sampleAt - startedAt, activeInputs.airSetting)
        : getPulledMetrics(
          activeInputs.player.deviceId == null
            ? undefined
            : samplesByDeviceRef.current.get(activeInputs.player.deviceId),
          sampleAt,
        );
      accumulatorRef.current = addGetPulledSampleThroughEnd(
        accumulatorRef.current,
        liveMetrics,
        sampleAt,
        endedAt,
      );
      setNow(Math.min(sampleAt, endedAt));
      if (sampleAt < endedAt) return;
      completedRef.current = true;
      const accumulatedResult = getPulledResultFromAccumulator(
        accumulatorRef.current,
        activeInputs.player,
        startedAt,
        endedAt,
        activeInputs.durationSeconds,
        activeInputs.airSetting,
      );
      // The pre-countdown arm ID is also the completion/history ID. This keeps
      // the existing personal heart-rate finalizer pointed at the exact relay
      // started by onSessionStart while giving club authorization one stable ID.
      const nextResult = bindGetPulledResultToSession(accumulatedResult, sessionStartRef.current);
      phaseRef.current = 'results';
      setResult(nextResult);
      setPhase('results');
      setNow(endedAt);
      onCompleteRef.current(nextResult);
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase, startedAt]);

  useEffect(() => {
    if (phase !== 'results') return undefined;
    const timer = window.setTimeout(reset, getPulledResultHoldMs);
    return () => window.clearTimeout(timer);
  }, [phase, reset]);

  useEffect(() => {
    if (!sessionPlayer || phase === 'setup') {
      onLiveStateChange(null);
      return;
    }
    onLiveStateChange({
      phase,
      playerId: sessionPlayer.id,
      ...(sessionPlayer.riderId ? { riderId: sessionPlayer.riderId } : {}),
      riderName: sessionPlayer.name,
      durationSeconds: sessionDurationSeconds,
      airSetting: sessionAirSetting,
      elapsedMs,
      distanceMeters: result?.distanceMeters ?? accumulatorRef.current.distanceMeters,
      metrics: result ? {
        live: false,
        watts: result.averageWatts,
        cadence: result.averageCadence,
        speedKph: result.averageSpeedKph,
      } : metrics,
      result,
    });
  }, [elapsedMs, metrics, onLiveStateChange, phase, result, sessionAirSetting, sessionDurationSeconds, sessionPlayer]);

  useEffect(() => () => {
    cancelSession('view-closed');
    viewCleanupCallbacksRef.current.onLiveStateChange(null);
    viewCleanupCallbacksRef.current.onFullscreenChange?.(false);
    stopBikeRaceAudio();
  }, [cancelSession]);

  const displayed = result ? {
    watts: result.averageWatts,
    peakWatts: result.peakWatts,
    cadence: result.averageCadence,
    peakCadence: result.peakCadence,
    speedKph: result.averageSpeedKph,
  } : {
    watts: metrics.watts,
    peakWatts: accumulatorRef.current.peakWatts,
    cadence: metrics.cadence,
    peakCadence: accumulatorRef.current.peakCadence,
    speedKph: metrics.speedKph,
  };

  return (
    <main className="get-pulled-view" aria-label="Get Pulled timed Wattbike test">
      {fullscreen && (phase === 'countdown' || phase === 'armed' || phase === 'active') && (
        <button className="get-pulled-exit-fullscreen" type="button" onClick={() => reset('user-cancelled')}>
          <RotateCcw size={18} /> Cancel sprint
        </button>
      )}
      <section className="get-pulled-hero">
        <PullSledScene
          active={phase === 'active'}
          cadenceRpm={metrics.cadence}
          durationSeconds={sessionDurationSeconds}
          progress={progress}
          speedKph={metrics.speedKph}
        />
        <div className="get-pulled-overlay">
          <div className="get-pulled-timer">
            <strong>{phase === 'countdown' ? `0:${String(countdown).padStart(2, '0')}` : `${(elapsedMs / 1_000).toFixed(2)}s`}</strong>
            <small>{phase === 'countdown'
              ? 'Countdown'
              : phase === 'armed' ? 'Starts on first 1-watt power signal' : `of ${sessionDurationSeconds}s pull`}</small>
          </div>
          <div className="get-pulled-phase">
            <strong>{sessionPlayer?.name ?? 'No athlete selected'}</strong>
            <small>{phaseLabel(phase)} · Wattbike Air {sessionAirSetting}</small>
          </div>
        </div>
        {phase === 'countdown' && <div className="get-pulled-countdown"><strong>{countdown}</strong></div>}
        {phase === 'armed' && (
          <div className="get-pulled-countdown" role="status">
            <strong style={{ width: 'auto', height: 'auto', minWidth: 190, padding: '18px 26px', borderRadius: 18, fontSize: 'clamp(34px,5vw,62px)' }}>READY</strong>
            <small style={{ marginTop: 10, padding: '7px 12px', borderRadius: 999, color: '#fff', background: 'rgba(7,12,9,.86)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.12em' }}>Reach 1 watt to start</small>
          </div>
        )}
      </section>

      {connectedPlayers.length === 0 ? (
        <section className="get-pulled-empty">
          <h3>Connect a Wattbike first</h3>
          <p>Get Pulled starts only after a connected bike and athlete are selected.</p>
        </section>
      ) : phase === 'setup' ? (
        <section className="get-pulled-config">
          <div className="get-pulled-panel">
            <h3><TimerReset size={18} /> Pull time</h3>
            <div className="get-pulled-options">
              {getPulledPresetSeconds.map((seconds) => (
                <button
                  className={!customSelected && durationSeconds === seconds ? 'selected' : ''}
                  key={seconds}
                  type="button"
                  onClick={() => { setDurationSeconds(seconds); setCustomSelected(false); }}
                >
                  {seconds}s
                </button>
              ))}
              <button className={customSelected ? 'selected' : ''} type="button" onClick={() => {
                setDurationSeconds(normalizeGetPulledSeconds(customSeconds));
                setCustomSelected(true);
              }}>Custom</button>
            </div>
            {customSelected && (
              <div className="get-pulled-custom">
                <input
                  aria-label="Custom pull duration in seconds"
                  inputMode="numeric"
                  min={1}
                  max={300}
                  type="number"
                  value={customSeconds}
                  onChange={(event) => {
                    setCustomSeconds(event.target.value);
                    setDurationSeconds(normalizeGetPulledSeconds(event.target.value));
                  }}
                />
                <span>seconds</span>
              </div>
            )}
          </div>
          <div className="get-pulled-panel get-pulled-air-panel">
            <h3><Gauge size={18} /> Wattbike Air setting</h3>
            <p>Select the physical Wattbike Air setting used for this pull. Records are compared only within the same time and Air setting.</p>
            <div className="get-pulled-air-options" aria-label="Wattbike Air setting">
              {getPulledAirSettings.map((setting) => (
                <button
                  className={airSetting === setting ? 'selected' : ''}
                  key={setting}
                  type="button"
                  onClick={() => setAirSetting(normalizeGetPulledAirSetting(setting))}
                >
                  {setting}
                </button>
              ))}
            </div>
          </div>
          <div className="get-pulled-panel">
            <h3>Bike and athlete</h3>
            {!demoMode && <p>Choose the Wattbike for this pull, then assign the athlete riding it.</p>}
            <div className="get-pulled-riders">
              {connectedPlayers.map((player) => {
                const rawPlayer = rawPlayerById.get(player.id) ?? player;
                const deviceId = player.deviceId;
                const bikeName = rawPlayer.bikeName ?? rawPlayer.name;
                const bikeLabel = `${bikeName} · P${player.id} · ${rawPlayer.deviceLabel ?? 'Wattbike'}`;
                const assignedRiderId = deviceId == null ? '' : riderAssignments[deviceId] ?? '';
                const selected = selectedPlayerId === player.id;
                return (
                  <div className={`get-pulled-bike-row${selected ? ' selected' : ''}${demoMode ? ' demo' : ''}`} key={player.id}>
                    <button
                      className={`get-pulled-bike-choice${selected ? ' selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedPlayerId(player.id)}
                      aria-pressed={selected}
                      aria-label={`Select ${bikeLabel}`}
                    >
                      <span><strong>{bikeName}</strong><small>P{player.id} · {rawPlayer.deviceLabel ?? 'Wattbike'}</small></span>
                      <span>{selected ? 'Selected bike' : 'Choose bike'}</span>
                    </button>
                    {!demoMode && (
                      <label className="get-pulled-athlete-select">
                        <span>Athlete</span>
                        <select
                          aria-label={`Athlete assigned to ${bikeName}`}
                          value={assignedRiderId}
                          disabled={!canAssignRiders || deviceId == null}
                          onFocus={() => setSelectedPlayerId(player.id)}
                          onChange={(event) => {
                            setSelectedPlayerId(player.id);
                            if (deviceId != null) onAssignRider(deviceId, event.target.value || null);
                          }}
                        >
                          <option value="">Choose athlete…</option>
                          {riders.map((rider) => {
                            const assignedDeviceId = assignedDeviceByRider.get(rider.id);
                            const assignedElsewhere = assignedDeviceId != null && assignedDeviceId !== deviceId;
                            return (
                              <option value={rider.id} disabled={assignedElsewhere} key={rider.id}>
                                {rider.name}{assignedElsewhere ? ' · assigned to another bike' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="get-pulled-privacy">Watts and power results are saved privately to the selected athlete. They are visible on the athlete’s records and authorized club monitors, never public leaderboards or shared ghosts.</p>
          <div className="get-pulled-actions">
            <button
              className="primary"
              type="button"
              disabled={!selectedAthleteReady}
              onPointerDown={primePullAudio}
              onClick={start}
            >
              <Play size={18} /> {selectedAthleteReady
                ? `Start ${secondsLabel(durationSeconds)} pull · Air ${airSetting}`
                : 'Choose an athlete to start'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className={`get-pulled-metrics${phase === 'results' ? ' get-pulled-results' : ''}`}>
            <div className="get-pulled-metric"><Zap size={20} /><strong>{displayed.watts}</strong><small>{result ? 'Average watts' : 'Live watts'}</small></div>
            <div className="get-pulled-metric"><Zap size={20} /><strong>{displayed.peakWatts}</strong><small>Peak watts</small></div>
            <div className="get-pulled-metric"><Activity size={20} /><strong>{displayed.cadence}</strong><small>Cadence rpm</small></div>
            <div className="get-pulled-metric"><Activity size={20} /><strong>{displayed.peakCadence}</strong><small>Peak cadence</small></div>
            <div className="get-pulled-metric"><Gauge size={20} /><strong>{formatSpeedFromKph(displayed.speedKph, speedUnit)}</strong><small>{speedUnitLabel(speedUnit)}</small></div>
            {result && heartRateSummary?.sampleCount ? (
              <div className="get-pulled-metric get-pulled-heart-rate-summary">
                <HeartPulse size={20} />
                <strong>{Math.round(heartRateSummary.averageBpm ?? 0)}</strong>
                <small>Average HR · {Math.round(heartRateSummary.peakBpm ?? 0)} BPM peak · {heartRateSummary.coveragePercent}% coverage</small>
              </div>
            ) : (
              <HeartRateMetric
                bpm={selectedHeartRate?.bpm}
                recordedAt={selectedHeartRate?.recordedAt}
                now={now}
                label={`${sessionPlayer?.name ?? 'Athlete'} heart rate`}
              />
            )}
          </section>
          {phase === 'results' && (
            <div className="get-pulled-actions" aria-label={`Result recorded at Wattbike Air ${sessionAirSetting}`}>
              <button className="primary" type="button" onClick={() => reset()}><RotateCcw size={18} /> Next athlete now</button>
            </div>
          )}
        </>
      )}
      {sessionDemoMode && <p className="get-pulled-privacy">Demo pull results are for testing only and are not saved or published.</p>}
    </main>
  );
}

export default GetPulledView;
