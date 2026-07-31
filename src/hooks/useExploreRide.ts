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

export type ExploreRideStatus = 'ready' | 'riding' | 'paused' | 'finished';

type UseExploreRideOptions = {
  clientId: string;
  players: PlayerSlot[];
  route: ExploreRoute | null;
  samplesByDevice: Map<number, BikeSample>;
  demoMode?: boolean;
};

const exploreSampleFreshMs = 3_000;

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
    name: player.name,
    ...(player.photoUrl ? { photoUrl: player.photoUrl } : {}),
    colorName: player.colorName,
    accent: player.accent,
    distanceMeters: 0,
    velocityMps: 0,
    cadence: null,
    pedalPhase: 0,
    watts: 0,
    signal: 0,
    recommendedAirSetting: initialAirSetting,
    finishedAt: null,
    at,
  }));
}

export function useExploreRide({
  clientId,
  players,
  route,
  samplesByDevice,
  demoMode = false,
}: UseExploreRideOptions) {
  const [status, setStatus] = useState<ExploreRideStatus>('ready');
  const [riders, setRiders] = useState<ExploreRider[]>(() => initialExploreRiders(clientId, players, route));
  const statusRef = useRef(status);
  const playersRef = useRef(players);
  const samplesRef = useRef(samplesByDevice);
  const routeRef = useRef(route);
  const demoModeRef = useRef(demoMode);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const activeElapsedMsRef = useRef(0);

  const playerSignature = useMemo(
    () => players.map((player) => `${player.id}:${player.deviceId ?? 'none'}:${player.name}:${player.photoUrl ?? ''}`).join('|'),
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
    setRiders(initialExploreRiders(clientId, playersRef.current, routeRef.current));
    setStatus('ready');
  }, [clientId]);

  const start = useCallback((startedAt = Date.now()) => {
    if (!routeRef.current || playersRef.current.length === 0) {
      return false;
    }
    window.cancelAnimationFrame(frameRef.current);
    lastFrameRef.current = performance.now();
    activeElapsedMsRef.current = Math.max(0, Date.now() - startedAt);
    setRiders(initialExploreRiders(clientId, playersRef.current, routeRef.current));
    setStatus('riding');
    return true;
  }, [clientId]);

  const pause = useCallback(() => {
    if (statusRef.current === 'riding') {
      setStatus('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current === 'paused') {
      lastFrameRef.current = performance.now();
      setStatus('riding');
    }
  }, []);

  useEffect(() => {
    reset();
  }, [playerSignature, reset, route?.id]);

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
        const player = playersRef.current.find((item) => item.id === rider.playerId);
        const sample = player?.deviceId == null ? undefined : samplesRef.current.get(player.deviceId);
        const sampleIsFresh = Boolean(sample && now - sample.at <= exploreSampleFreshMs);
        const demoMotion = demoModeRef.current
          ? exploreDemoRiderMotion(rider.playerId, exploreElapsedSeconds)
          : null;
        const demoTargetVelocityMps = (demoMotion?.speedMph ?? 0) * 0.44704;
        const demoTargetCadence = exploreCadenceRpmFromVelocityMps(demoTargetVelocityMps);
        const liveCadence = sampleIsFresh ? Math.max(0, sample?.cadence ?? 0) : 0;
        const liveWatts = sampleIsFresh ? Math.max(0, sample?.watts ?? 0) : 0;
        const liveDriveActive = sampleIsFresh && exploreLiveDriveActive(liveCadence, liveWatts);
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
        const pedaling = demoMotion ? demoMotion.pedaling : liveDriveActive;
        const pedalPhase = pedaling
          ? ((rider.pedalPhase ?? 0) + (cadence / 60) * deltaSeconds) % 1
          : 0;
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
          cadence: demoMotion || sampleIsFresh ? cadence : null,
          pedalPhase: finished ? 0 : pedalPhase,
          watts: demoMotion
            ? (demoMotion.pedaling ? Math.round(95 + demoMotion.speedMph * 6.5) : 0)
            : liveWatts,
          signal: demoMotion
            ? 0.96
            : sampleIsFresh ? Math.max(0, Math.min(1, sample?.signal ?? 0)) : 0,
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
    }
  }, [riders, route, status]);

  const elapsedMs = activeElapsedMsRef.current;

  return {
    elapsedMs,
    pause,
    reset,
    resume,
    riders,
    start,
    status,
  };
}
