import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exploreCadenceRpmFromVelocityMps,
  exploreVelocityMpsFromCadence,
} from '../game/exploreRollout';
import {
  exploreDemoRiderMotion,
  exploreLiveDriveActive,
  stepExploreLiveVelocity,
} from '../lib/explore';
import {
  exploreGradeAtMeter,
  recommendedExploreAirSetting,
  stabilizeExploreAirSetting,
} from '../lib/exploreElevation';
import type {
  BikeSample,
  ExploreRider,
  ExploreRoute,
  PlayerSlot,
} from '../types';
import type { HeartRateActiveClockSegment } from '../lib/heartRate';
import { cleanBikeCadenceRpm, cleanBikeWatts } from '../lib/bikeSampleSanity';

export type ExploreRideStatus = 'ready' | 'riding' | 'paused' | 'finished';

type UseExploreRideOptions = {
  clientId: string;
  players: PlayerSlot[];
  route: ExploreRoute | null;
  samplesByDevice: Map<number, BikeSample>;
  demoMode?: boolean;
  restoredRide?: ExploreRideRestoreState | null;
};

export type ExploreRideRestoreState = {
  routeId: string;
  riders: ExploreRider[];
  elapsedMs: number;
  activeClockSegments?: HeartRateActiveClockSegment[];
};

const exploreSampleFreshMs = 3_000;

export function acceptedExploreLiveMetrics(sample: BikeSample | undefined, now: number) {
  const sampleIsFresh = Boolean(sample && now - sample.at <= exploreSampleFreshMs);
  const cadenceRecordedAt = sample ? sample.cadenceAt ?? sample.at : 0;
  const wattsRecordedAt = sample ? sample.wattsAt ?? sample.at : 0;
  const cadenceIsFresh = Boolean(
    sample
    && sample.cadence != null
    && now - cadenceRecordedAt <= exploreSampleFreshMs,
  );
  const wattsIsFresh = Boolean(sample && now - wattsRecordedAt <= exploreSampleFreshMs);
  const cadence = cadenceIsFresh ? cleanBikeCadenceRpm(sample?.cadence) ?? 0 : 0;
  const watts = wattsIsFresh ? cleanBikeWatts(sample?.watts) ?? 0 : 0;
  return {
    sampleIsFresh,
    cadenceIsFresh,
    wattsIsFresh,
    cadence,
    watts,
    driveActive: cadenceIsFresh && wattsIsFresh && exploreLiveDriveActive(cadence, watts),
  };
}

function initialExploreRiders(
  clientId: string,
  players: PlayerSlot[],
  route?: ExploreRoute | null,
): ExploreRider[] {
  const at = Date.now();
  const initialAirSetting = recommendedExploreAirSetting(exploreGradeAtMeter(
    route?.elevationSamples,
    0,
  ));
  return players.map((player) => ({
    id: `${clientId}:${player.id}`,
    clientId,
    playerId: player.id,
    ...(player.riderId ? { riderId: player.riderId } : {}),
    name: player.name,
    ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
    colorName: player.colorName,
    accent: player.accent,
    distanceMeters: 0,
    velocityMps: 0,
    cadence: null,
    watts: 0,
    signal: 0,
    recommendedAirSetting: initialAirSetting,
    finishedAt: null,
    at,
  }));
}

export function restoreExploreRidersPaused(
  riders: ExploreRider[],
  at = Date.now(),
) {
  return riders.map((rider) => ({
    ...rider,
    // A reopened app always restores safely paused. Do not let momentum or a
    // stale Wattbike sample advance the map before the rider presses Resume.
    velocityMps: 0,
    cadence: 0,
    watts: 0,
    signal: 0,
    // A finished rider's clock is immutable. Clearing this would make a mixed
    // group finish that rider again after resume and widen their exact saved
    // heart-rate window to include app downtime.
    finishedAt: rider.finishedAt,
    at,
  }));
}

export function useExploreRide({
  clientId,
  players,
  route,
  samplesByDevice,
  demoMode = false,
  restoredRide = null,
}: UseExploreRideOptions) {
  const initialRestoreRef = useRef(
    restoredRide && restoredRide.routeId === route?.id && restoredRide.riders.length > 0
      ? restoredRide
      : null,
  );
  const [status, setStatus] = useState<ExploreRideStatus>(
    initialRestoreRef.current ? 'paused' : 'ready',
  );
  const [riders, setRiders] = useState<ExploreRider[]>(() => (
    initialRestoreRef.current
      ? restoreExploreRidersPaused(initialRestoreRef.current.riders)
      : initialExploreRiders(clientId, players, route)
  ));
  const statusRef = useRef(status);
  const playersRef = useRef(players);
  const ridePlayersRef = useRef(players);
  const samplesRef = useRef(samplesByDevice);
  const routeRef = useRef(route);
  const demoModeRef = useRef(demoMode);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const activeElapsedMsRef = useRef(initialRestoreRef.current?.elapsedMs ?? 0);
  const initialClockSegments = initialRestoreRef.current?.activeClockSegments ?? [];
  const [activeClockSegments, setActiveClockSegments] = useState<HeartRateActiveClockSegment[]>(initialClockSegments);
  const activeClockSegmentsRef = useRef<HeartRateActiveClockSegment[]>(initialClockSegments);
  const rideScopeRef = useRef(`${clientId}:${route?.id ?? ''}`);

  const playerSignature = useMemo(
    () => players.map((player) => `${player.id}:${player.deviceId ?? 'none'}:${player.riderId ?? ''}:${player.name}:${player.photoUrl ?? ''}`).join('|'),
    [players],
  );

  statusRef.current = status;
  playersRef.current = players;
  samplesRef.current = samplesByDevice;
  routeRef.current = route;
  demoModeRef.current = demoMode;

  const reset = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    lastFrameRef.current = 0;
    activeElapsedMsRef.current = 0;
    activeClockSegmentsRef.current = [];
    setActiveClockSegments([]);
    ridePlayersRef.current = playersRef.current;
    setRiders(initialExploreRiders(clientId, ridePlayersRef.current, routeRef.current));
    setStatus('ready');
  }, [clientId]);

  const start = useCallback((startedAt = Date.now()) => {
    if (!routeRef.current || playersRef.current.length === 0) {
      return false;
    }
    window.cancelAnimationFrame(frameRef.current);
    lastFrameRef.current = performance.now();
    activeElapsedMsRef.current = Math.max(0, Date.now() - startedAt);
    const segment: HeartRateActiveClockSegment = {
      startedAt,
      endedAt: null,
      activeElapsedAtStartMs: 0,
    };
    activeClockSegmentsRef.current = [segment];
    setActiveClockSegments([segment]);
    ridePlayersRef.current = playersRef.current;
    setRiders(initialExploreRiders(clientId, ridePlayersRef.current, routeRef.current));
    setStatus('riding');
    return true;
  }, [clientId]);

  const pause = useCallback(() => {
    if (statusRef.current === 'riding') {
      const pausedAt = Date.now();
      const next = activeClockSegmentsRef.current.map((segment, index, segments) => (
        index === segments.length - 1 && segment.endedAt == null
          ? { ...segment, endedAt: Math.max(segment.startedAt, pausedAt) }
          : segment
      ));
      activeClockSegmentsRef.current = next;
      setActiveClockSegments(next);
      setStatus('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current === 'paused') {
      const next = [...activeClockSegmentsRef.current, {
        startedAt: Date.now(),
        endedAt: null,
        activeElapsedAtStartMs: Math.max(0, activeElapsedMsRef.current),
      }];
      activeClockSegmentsRef.current = next;
      setActiveClockSegments(next);
      lastFrameRef.current = performance.now();
      ridePlayersRef.current = playersRef.current;
      setStatus('riding');
    }
  }, []);

  const restore = useCallback((snapshot: ExploreRideRestoreState) => {
    if (
      !routeRef.current
      || snapshot.routeId !== routeRef.current.id
      || snapshot.riders.length === 0
    ) {
      return false;
    }
    window.cancelAnimationFrame(frameRef.current);
    lastFrameRef.current = 0;
    activeElapsedMsRef.current = Math.max(0, snapshot.elapsedMs);
    const restoredSegments = (snapshot.activeClockSegments ?? []).map((segment) => ({
      ...segment,
      // A restored ride is always paused. Closing an unexpectedly open segment
      // prevents app downtime from counting as active training time.
      endedAt: segment.endedAt ?? Date.now(),
    }));
    activeClockSegmentsRef.current = restoredSegments;
    setActiveClockSegments(restoredSegments);
    ridePlayersRef.current = playersRef.current;
    setRiders(restoreExploreRidersPaused(snapshot.riders));
    setStatus('paused');
    return true;
  }, []);

  useEffect(() => {
    const nextScope = `${clientId}:${route?.id ?? ''}`;
    if (rideScopeRef.current === nextScope) {
      return;
    }
    rideScopeRef.current = nextScope;
    reset();
  }, [clientId, reset, route?.id]);

  useEffect(() => {
    if (statusRef.current !== 'ready') {
      return;
    }
    ridePlayersRef.current = playersRef.current;
    setRiders(initialExploreRiders(clientId, ridePlayersRef.current, routeRef.current));
  }, [clientId, playerSignature]);

  useEffect(() => {
    if (status !== 'riding') {
      window.cancelAnimationFrame(frameRef.current);
      return undefined;
    }

    const tick = (frameTime: number) => {
      const currentRoute = routeRef.current;
      if (!currentRoute) {
        setStatus('ready');
        return;
      }

      const previousFrame = lastFrameRef.current || frameTime;
      const deltaSeconds = Math.max(0.001, Math.min(0.1, (frameTime - previousFrame) / 1000));
      lastFrameRef.current = frameTime;
      activeElapsedMsRef.current += deltaSeconds * 1_000;
      const now = Date.now();
      const exploreElapsedSeconds = activeElapsedMsRef.current / 1_000;

      setRiders((current) => current.map((rider) => {
        const player = ridePlayersRef.current.find((item) => item.id === rider.playerId);
        const sample = player?.deviceId == null ? undefined : samplesRef.current.get(player.deviceId);
        const liveMetrics = acceptedExploreLiveMetrics(sample, now);
        const demoMotion = demoModeRef.current
          ? exploreDemoRiderMotion(rider.playerId, exploreElapsedSeconds)
          : null;
        const demoTargetVelocityMps = (demoMotion?.speedMph ?? 0) * 0.44704;
        const demoTargetCadence = exploreCadenceRpmFromVelocityMps(demoTargetVelocityMps);
        const liveCadence = liveMetrics.cadence;
        const liveWatts = liveMetrics.watts;
        const liveDriveActive = liveMetrics.driveActive;
        const cadence = demoMotion
          ? (demoMotion.pedaling ? demoTargetCadence : 0)
          : liveDriveActive ? liveCadence : 0;
        const pedalingVelocityMps = exploreVelocityMpsFromCadence(cadence);
        const gradePercent = exploreGradeAtMeter(
          currentRoute.elevationSamples,
          rider.distanceMeters,
        );
        const recommendedAirSetting = stabilizeExploreAirSetting(
          rider.recommendedAirSetting ?? 1,
          gradePercent,
        );
        const velocityMps = stepExploreLiveVelocity(
          rider.velocityMps,
          pedalingVelocityMps,
          demoMotion ? demoMotion.pedaling : liveDriveActive,
          deltaSeconds,
          gradePercent,
        );
        const distanceMeters = Math.min(
          currentRoute.distanceMeters,
          rider.distanceMeters + velocityMps * deltaSeconds,
        );
        const finished = distanceMeters >= currentRoute.distanceMeters - 0.01;
        return {
          ...rider,
          name: player?.name ?? rider.name,
          ...(player?.photoUrl ? { photoUrl: player.photoUrl } : {}),
          distanceMeters,
          velocityMps: finished ? 0 : velocityMps,
          cadence: demoMotion || liveMetrics.cadenceIsFresh ? cadence : null,
          watts: demoMotion
            ? (demoMotion.pedaling ? Math.round(95 + demoMotion.speedMph * 6.5) : 0)
            : liveWatts,
          signal: demoMotion
            ? 0.96
            : liveMetrics.sampleIsFresh ? Math.max(0, Math.min(1, sample?.signal ?? 0)) : 0,
          recommendedAirSetting,
          finishedAt: finished ? rider.finishedAt ?? now : null,
          at: now,
        };
      }));

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [status]);

  useEffect(() => {
    if (
      status === 'riding'
      && riders.length > 0
      && route
      && riders.every((rider) => rider.distanceMeters >= route.distanceMeters - 0.01)
    ) {
      setStatus('finished');
      const finishedAt = Date.now();
      const next = activeClockSegmentsRef.current.map((segment, index, segments) => (
        index === segments.length - 1 && segment.endedAt == null
          ? { ...segment, endedAt: Math.max(segment.startedAt, finishedAt) }
          : segment
      ));
      activeClockSegmentsRef.current = next;
      setActiveClockSegments(next);
    }
  }, [riders, route, status]);

  const elapsedMs = activeElapsedMsRef.current;

  return {
    activeClockSegments,
    elapsedMs,
    pause,
    reset,
    restore,
    resume,
    riders,
    start,
    status,
  };
}
