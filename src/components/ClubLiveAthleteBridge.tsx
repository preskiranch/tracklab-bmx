import { useEffect, useMemo, useRef } from 'react';
import {
  loadClubLiveAccess,
  publishClubLiveSession,
  stopClubLiveSession,
  type ClubLiveAccess,
  type ClubLiveSnapshot,
} from '../lib/clubLive';
import { bikeMetricIsLive, bikeSampleIsLive } from '../lib/liveBikeRegistry';
import { acceptedTrainingSpeedKph, cleanBikeCadenceRpm } from '../lib/bikeSampleSanity';
import { liveBikeTimeoutMs } from '../data';
import type { GetPulledLiveState } from '../lib/getPulled';
import type {
  AppMode,
  BikeSample,
  ExploreRider,
  ExploreRoute,
  PlayerSlot,
  RaceCapture,
  RaceState,
  RiderState,
} from '../types';

export type ScopedClubLiveAccess = ClubLiveAccess & {
  profileKey: string;
  studioRiderId: string;
};

type ClubLiveAccessStatus = 'idle' | 'checking' | 'active' | 'inactive' | 'error';

export type ClubLiveExploreState = {
  status: 'ready' | 'riding' | 'paused' | 'finished';
  route: ExploreRoute | null;
  riders: ExploreRider[];
  elapsedMs: number;
};

export type ClubLiveActivityState = {
  accountRiderId?: string;
  appMode: AppMode;
  explore: ClubLiveExploreState | null;
  getPulled: GetPulledLiveState | null;
  multiplayerActive: boolean;
  multiplayerParticipantCount: number | null;
  now: number;
  race: {
    capture: RaceCapture | null;
    courseLengthMeters: number;
    players: PlayerSlot[];
    riders: RiderState[];
    samplesByDevice: Map<number, BikeSample>;
    startGateActive: boolean;
    state: RaceState;
    trackName: string;
  };
};

type ClubLiveAthleteBridgeProps = {
  demoMode: boolean;
  accessActive: boolean;
  tabletSessionActive?: boolean;
  activity: ClubLiveActivityState;
  profileKey: string;
  selection: {
    clubId: string;
    studioRiderId: string;
  };
  onAccessChange: (access: ScopedClubLiveAccess | null) => void;
  onAccessStatusChange: (status: ClubLiveAccessStatus) => void;
};

export function ClubLiveAthleteBridge({
  accessActive,
  activity,
  demoMode,
  profileKey,
  selection,
  tabletSessionActive = false,
  onAccessChange,
  onAccessStatusChange,
}: ClubLiveAthleteBridgeProps) {
  const accessGenerationRef = useRef(0);
  const snapshot = useMemo<ClubLiveSnapshot | null>(() => {
    if (demoMode || !accessActive) return null;
    const {
      accountRiderId,
      appMode,
      explore,
      getPulled,
      multiplayerActive,
      multiplayerParticipantCount,
      now,
      race,
    } = activity;

    if (appMode === 'get-pulled') {
      if (!getPulled || getPulled.riderId !== accountRiderId) return null;
      const cadence = cleanBikeCadenceRpm(getPulled.metrics.cadence);
      const speedKph = acceptedTrainingSpeedKph(getPulled.metrics.speedKph);
      if (cadence == null || speedKph == null) return null;
      const durationMs = Math.max(1, getPulled.durationSeconds * 1_000);
      const fraction = Math.min(1, Math.max(0, getPulled.elapsedMs / durationMs));
      const status = getPulled.phase === 'active'
        ? 'active'
        : (getPulled.phase === 'countdown' || getPulled.phase === 'armed') ? 'staging' : 'finished';
      return {
        clubId: selection.clubId,
        studioRiderId: selection.studioRiderId,
        sessionId: `get-pulled:${getPulled.playerId}:${getPulled.durationSeconds}:air-${getPulled.airSetting}`,
        activityType: 'get-pulled',
        status,
        progress: {
          fraction,
          distanceMeters: Math.max(0, getPulled.distanceMeters),
          label: `${getPulled.durationSeconds}s pull · Air ${getPulled.airSetting}`,
        },
        metrics: {
          watts: Math.max(0, Math.round(getPulled.metrics.watts)),
          cadence,
          speedKph,
          distanceMeters: Math.max(0, getPulled.distanceMeters),
          elapsedMs: Math.max(0, getPulled.elapsedMs),
          position: 1,
          participantCount: 1,
        },
        trackName: `Preski Ranch Pull Lane · Air ${getPulled.airSetting}`,
        ...(getPulled.phase === 'active' ? { startedAt: Math.max(1, now - getPulled.elapsedMs) } : {}),
        multiplayer: false,
      };
    }

    if (appMode === 'explore') {
      if (explore?.status === 'finished') return null;
      const rider = explore?.riders.find((candidate) => candidate.riderId === accountRiderId)
        ?? (tabletSessionActive ? undefined : explore?.riders[0]);
      if (!rider || rider.signal <= 0 || now - rider.at > liveBikeTimeoutMs) return null;
      const cadence = cleanBikeCadenceRpm(rider.cadence ?? 0);
      const speedKph = acceptedTrainingSpeedKph(rider.velocityMps * 3.6);
      if (cadence == null || speedKph == null) return null;
      const routeDistance = Math.max(0, explore?.route?.distanceMeters ?? 0);
      const distanceMeters = Math.max(0, rider.distanceMeters);
      const fraction = routeDistance > 0 ? Math.min(1, distanceMeters / routeDistance) : 0;
      const participantCount = multiplayerActive
        ? Math.max(1, multiplayerParticipantCount ?? explore?.riders.length ?? 1)
        : Math.max(1, explore?.riders.length ?? 1);
      const status = explore?.status === 'riding'
        ? 'active'
        : explore?.status === 'paused' ? 'paused' : 'ready';
      return {
        clubId: selection.clubId,
        studioRiderId: selection.studioRiderId,
        ...(explore?.route?.id ? { sessionId: `explore:${explore.route.id}` } : {}),
        activityType: 'explore',
        status,
        progress: {
          fraction,
          distanceMeters,
          label: routeDistance > 0 ? `${Math.round(fraction * 100)}% of route` : 'Choosing a route',
        },
        metrics: {
          watts: Math.max(0, Math.round(rider.watts ?? 0)),
          cadence,
          speedKph,
          distanceMeters,
          elapsedMs: Math.max(0, explore?.elapsedMs ?? 0),
          position: explore
            ? Math.max(1, explore.riders.findIndex((candidate) => candidate.id === rider.id) + 1)
            : null,
          participantCount,
        },
        ...(explore?.route?.name ? { trackName: explore.route.name } : {}),
        ...(explore?.route?.destinationLabel ? { destinationLabel: explore.route.destinationLabel } : {}),
        ...(status === 'active' && explore?.elapsedMs ? { startedAt: Math.max(1, now - explore.elapsedMs) } : {}),
        multiplayer: multiplayerActive,
      };
    }

    if ((appMode !== 'race' && appMode !== 'straight-sprint') || race.state === 'finished') return null;
    const player = race.players.find((candidate) => candidate.riderId === accountRiderId)
      ?? (tabletSessionActive ? undefined : race.players[0]);
    const rider = player ? race.riders.find((candidate) => candidate.playerId === player.id) : undefined;
    const sample = player?.deviceId == null ? undefined : race.samplesByDevice.get(player.deviceId);
    const liveSample = bikeSampleIsLive(sample, now, liveBikeTimeoutMs) ? sample : undefined;
    if (!player || !rider || !liveSample) return null;
    const cadence = cleanBikeCadenceRpm(
      bikeMetricIsLive(liveSample.cadenceAt, now, liveBikeTimeoutMs) ? liveSample.cadence : 0,
    );
    const speedKph = acceptedTrainingSpeedKph(rider.velocity * 3.6);
    if (cadence == null || speedKph == null) return null;
    const distanceMeters = Math.max(0, Math.min(race.courseLengthMeters, rider.distance));
    const fraction = race.courseLengthMeters > 0 ? Math.min(1, distanceMeters / race.courseLengthMeters) : 0;
    const participantCount = multiplayerActive
      ? Math.max(1, multiplayerParticipantCount ?? race.players.length)
      : Math.max(1, race.players.length);
    const status = race.state === 'racing' ? 'active' : race.startGateActive ? 'staging' : 'ready';
    const startedAt = race.capture?.status === 'racing' ? race.capture.startedAt ?? undefined : undefined;
    return {
      clubId: selection.clubId,
      studioRiderId: selection.studioRiderId,
      ...(race.capture?.status === 'armed' || race.capture?.status === 'racing'
        ? { sessionId: race.capture.sessionId }
        : {}),
      activityType: appMode === 'straight-sprint' ? 'straight-sprint' : 'bmx-race',
      status,
      progress: {
        fraction,
        distanceMeters,
        label: status === 'staging' ? 'At the gate' : `${Math.round(fraction * 100)}% of course`,
      },
      metrics: {
        watts: Math.max(0, Math.round(liveSample.watts ?? rider.lastWatts ?? 0)),
        cadence,
        speedKph,
        distanceMeters,
        elapsedMs: startedAt ? Math.max(0, now - startedAt) : 0,
        position: rider.rank ?? null,
        participantCount,
      },
      trackName: race.trackName,
      ...(startedAt ? { startedAt } : {}),
      multiplayer: multiplayerActive,
    };
  }, [accessActive, activity, demoMode, selection.clubId, selection.studioRiderId, tabletSessionActive]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const generation = ++accessGenerationRef.current;
    let disposed = false;
    let requestActive = false;
    let controller: AbortController | null = null;
    onAccessChange(null);

    if (!profileKey) {
      onAccessStatusChange('idle');
      return undefined;
    }

    const checkAccess = async () => {
      if (disposed || requestActive || document.visibilityState === 'hidden') return;
      requestActive = true;
      controller = new AbortController();
      onAccessStatusChange('checking');
      try {
        const access = await loadClubLiveAccess(selection.clubId, controller.signal);
        if (disposed || generation !== accessGenerationRef.current) return;
        const active = access.active && access.expiresAt > Date.now();
        onAccessChange({
          ...access,
          active,
          profileKey,
          studioRiderId: selection.studioRiderId,
        });
        onAccessStatusChange(active ? 'active' : 'inactive');
      } catch (error) {
        if (disposed || generation !== accessGenerationRef.current || (error as Error).name === 'AbortError') return;
        // Temporary studio-bike access is fail-closed. A rejected or unreachable
        // check immediately tears down the prior browser grant in the parent.
        onAccessChange(null);
        onAccessStatusChange('error');
      } finally {
        requestActive = false;
        controller = null;
      }
    };

    void checkAccess();
    const timer = window.setInterval(() => void checkAccess(), 2_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkAccess();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      accessGenerationRef.current += 1;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      onAccessChange(null);
      onAccessStatusChange('idle');
    };
  }, [
    onAccessChange,
    onAccessStatusChange,
    profileKey,
    selection.clubId,
    selection.studioRiderId,
  ]);

  useEffect(() => {
    if (!profileKey || demoMode) return undefined;
    let disposed = false;
    let shared = false;
    let syncRequested = false;
    let controller: AbortController | null = null;
    const sync = () => {
      if (disposed) return;
      if (controller) {
        syncRequested = true;
        return;
      }
      const currentSnapshot = snapshotRef.current;
      controller = new AbortController();
      let operation: Promise<void> | null = null;
      if (
        currentSnapshot
        && currentSnapshot.clubId === selection.clubId
        && currentSnapshot.studioRiderId === selection.studioRiderId
      ) {
        shared = true;
        operation = publishClubLiveSession(currentSnapshot, controller.signal);
      } else if (shared) {
        shared = false;
        operation = stopClubLiveSession(selection, { signal: controller.signal });
      } else {
        controller = null;
        return;
      }
      void operation.catch((error: Error) => {
        if (error.name !== 'AbortError') {
          console.warn(`Could not update Club Live Monitor: ${error.message}`);
        }
      }).finally(() => {
        controller = null;
        if (syncRequested && !disposed) {
          syncRequested = false;
          sync();
        }
      });
    };
    sync();
    const timer = window.setInterval(sync, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      controller?.abort();
      if (!tabletSessionActive) {
        void stopClubLiveSession(selection, { keepalive: true }).catch(() => undefined);
      }
    };
  }, [
    demoMode,
    profileKey,
    selection.clubId,
    selection.studioRiderId,
    tabletSessionActive,
  ]);

  return null;
}

export default ClubLiveAthleteBridge;
