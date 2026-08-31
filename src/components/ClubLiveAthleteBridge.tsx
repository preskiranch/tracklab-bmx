import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadClubLiveAccess,
  publishClubLiveScreenFrame,
  publishClubLiveSession,
  stopClubLiveScreenFrame,
  stopClubLiveSession,
  type ClubLiveAccess,
  type ClubLiveSnapshot,
} from '../lib/clubLive';
import {
  captureNativeClubLiveScreenMirror,
  nativeClubLiveScreenMirrorAvailable,
} from '../lib/nativeClubLiveScreenMirror';
import { startClubLiveVideoPublisher } from '../lib/clubLiveVideo';
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
import './ClubLiveAthleteBridge.css';

export type ScopedClubLiveAccess = ClubLiveAccess & {
  profileKey: string;
  studioRiderId: string;
};

type ClubLiveAccessStatus = 'idle' | 'checking' | 'active' | 'inactive' | 'error';

export type ClubLiveExploreState = {
  sessionId: string | null;
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
    trackId?: string;
    trackName: string;
  };
};

export type ClubLiveRacePreviewSession = Readonly<{
  key: string;
  sessionId: string;
  captureCurrent: boolean;
}>;

function defaultClubLivePreviewNonce() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function advanceClubLiveRacePreviewSession(
  current: ClubLiveRacePreviewSession | null,
  input: Readonly<{ key: string; captureCurrent: boolean }>,
  createNonce: () => string = defaultClubLivePreviewNonce,
): ClubLiveRacePreviewSession | null {
  if (!input.key) return null;
  const needsNewSession = !current
    || current.key !== input.key
    || (current.captureCurrent && !input.captureCurrent);
  return {
    key: input.key,
    sessionId: needsNewSession
      ? `club-live-preview:${createNonce()}`
      : current.sessionId,
    captureCurrent: input.captureCurrent,
  };
}

function currentClubLiveRaceCaptureSessionId(
  appMode: AppMode,
  race: ClubLiveActivityState['race'],
) {
  const capture = race.capture;
  if (!capture) return '';
  const captureTrack = capture.track;
  if (captureTrack?.id && race.trackId && captureTrack.id !== race.trackId) return '';
  if (captureTrack) {
    const captureIsSprint = captureTrack.sprintDistanceFeet != null;
    if (captureIsSprint !== (appMode === 'straight-sprint')) return '';
  }
  if (capture.status === 'armed' || capture.status === 'racing') return capture.sessionId;
  return capture.status === 'finished' && race.state === 'finished' ? capture.sessionId : '';
}

type ClubLiveAthleteBridgeProps = {
  demoMode: boolean;
  accessActive: boolean;
  activityScreenVisible: boolean;
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

type ClubLiveSnapshotInput = Pick<
  ClubLiveAthleteBridgeProps,
  'accessActive' | 'activity' | 'demoMode' | 'selection' | 'tabletSessionActive'
> & { racePreviewSessionId?: string };

export function clubLiveScreenFrameMatchesVisibleActivity(
  activityScreenVisible: boolean,
  snapshot: ClubLiveSnapshot | null,
  selection: ClubLiveAthleteBridgeProps['selection'],
  sessionId = '',
): snapshot is ClubLiveSnapshot & { sessionId: string } {
  return Boolean(
    activityScreenVisible
    && snapshot
    && snapshot.sessionId
    && snapshot.clubId === selection.clubId
    && snapshot.studioRiderId === selection.studioRiderId
    && (!sessionId || snapshot.sessionId === sessionId)
  );
}

export function clubLiveStreamSnapshotRevision(snapshot: ClubLiveSnapshot | null) {
  if (!snapshot?.sessionId) return '';
  return [
    snapshot.clubId,
    snapshot.studioRiderId,
    snapshot.sessionId,
    snapshot.activityType,
    snapshot.multiplayer ? 'shared-event' : 'individual',
  ].join(':');
}

export function buildClubLiveSnapshot({
  accessActive,
  activity,
  demoMode,
  racePreviewSessionId = '',
  selection,
  tabletSessionActive = false,
}: ClubLiveSnapshotInput): ClubLiveSnapshot | null {
  return ((): ClubLiveSnapshot | null => {
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
        : (getPulled.phase === 'countdown' || getPulled.phase === 'armed')
          ? 'staging'
          : getPulled.phase === 'results' ? 'finished' : 'ready';
      return {
        clubId: selection.clubId,
        studioRiderId: selection.studioRiderId,
        sessionId: getPulled.sessionId,
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
      const sessionId = explore?.sessionId;
      if (!sessionId) return null;
      const finished = explore?.status === 'finished';
      const rider = explore?.riders.find((candidate) => candidate.riderId === accountRiderId)
        ?? (tabletSessionActive ? undefined : explore?.riders[0]);
      if (!rider || (!finished && (rider.signal <= 0 || now - rider.at > liveBikeTimeoutMs))) return null;
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
        : explore?.status === 'paused' ? 'paused' : finished ? 'finished' : 'ready';
      return {
        clubId: selection.clubId,
        studioRiderId: selection.studioRiderId,
        sessionId,
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

    if (appMode !== 'race' && appMode !== 'straight-sprint') return null;
    const finished = race.state === 'finished';
    const player = race.players.find((candidate) => candidate.riderId === accountRiderId)
      ?? (tabletSessionActive ? undefined : race.players[0]);
    const rider = player ? race.riders.find((candidate) => candidate.playerId === player.id) : undefined;
    const sample = player?.deviceId == null ? undefined : race.samplesByDevice.get(player.deviceId);
    const liveSample = bikeSampleIsLive(sample, now, liveBikeTimeoutMs) ? sample : undefined;
    const metricSample = liveSample ?? (finished ? sample : undefined);
    if (!player || !rider || (!metricSample && !finished)) return null;
    const cadence = cleanBikeCadenceRpm(
      metricSample && (finished || bikeMetricIsLive(metricSample.cadenceAt, now, liveBikeTimeoutMs))
        ? metricSample.cadence
        : rider.lastRawCadence,
    );
    const speedKph = acceptedTrainingSpeedKph(rider.velocity * 3.6);
    if (cadence == null || speedKph == null) return null;
    const distanceMeters = Math.max(0, Math.min(race.courseLengthMeters, rider.distance));
    const fraction = race.courseLengthMeters > 0 ? Math.min(1, distanceMeters / race.courseLengthMeters) : 0;
    const participantCount = multiplayerActive
      ? Math.max(1, multiplayerParticipantCount ?? race.players.length)
      : Math.max(1, race.players.length);
    const status = finished ? 'finished' : race.state === 'racing' ? 'active' : race.startGateActive ? 'staging' : 'ready';
    const startedAt = race.capture?.status === 'racing' || race.capture?.status === 'finished'
      ? race.capture.startedAt ?? undefined
      : undefined;
    const sessionId = currentClubLiveRaceCaptureSessionId(appMode, race)
      || racePreviewSessionId;
    if (!sessionId) return null;
    const elapsedAt = race.capture?.status === 'finished'
      ? race.capture.endedAt ?? now
      : now;
    return {
      clubId: selection.clubId,
      studioRiderId: selection.studioRiderId,
      sessionId,
      activityType: appMode === 'straight-sprint' ? 'straight-sprint' : 'bmx-race',
      status,
      progress: {
        fraction,
        distanceMeters,
        label: status === 'staging' ? 'At the gate' : `${Math.round(fraction * 100)}% of course`,
      },
      metrics: {
        watts: Math.max(0, Math.round(metricSample?.watts ?? rider.lastWatts ?? 0)),
        cadence,
        speedKph,
        distanceMeters,
        elapsedMs: startedAt ? Math.max(0, elapsedAt - startedAt) : 0,
        position: rider.rank ?? null,
        participantCount,
      },
      trackName: race.trackName,
      ...(startedAt ? { startedAt } : {}),
      multiplayer: multiplayerActive,
    };
  })();
}

export function ClubLiveAthleteBridge({
  accessActive,
  activity,
  activityScreenVisible,
  demoMode,
  profileKey,
  selection,
  tabletSessionActive = false,
  onAccessChange,
  onAccessStatusChange,
}: ClubLiveAthleteBridgeProps) {
  const accessGenerationRef = useRef(0);
  const [activityVideoStreaming, setActivityVideoStreaming] = useState(false);
  const [publishedStreamRevision, setPublishedStreamRevision] = useState('');
  const activityScreenVisibleRef = useRef(activityScreenVisible);
  activityScreenVisibleRef.current = activityScreenVisible;
  const racePreviewRef = useRef<ClubLiveRacePreviewSession | null>(null);
  const localRacePlayer = activity.race.players.find(
    (candidate) => candidate.riderId === activity.accountRiderId,
  ) ?? (tabletSessionActive ? undefined : activity.race.players[0]);
  const captureSessionId = currentClubLiveRaceCaptureSessionId(activity.appMode, activity.race);
  const racePreviewKey = activity.appMode === 'race' || activity.appMode === 'straight-sprint'
    ? [
        selection.clubId,
        selection.studioRiderId,
        activity.appMode,
        activity.race.trackId ?? activity.race.trackName,
        localRacePlayer?.id ?? 'unassigned',
        localRacePlayer?.riderId ?? 'unassigned',
        localRacePlayer?.deviceId ?? 'unassigned',
      ].join(':')
    : '';
  racePreviewRef.current = advanceClubLiveRacePreviewSession(racePreviewRef.current, {
    key: racePreviewKey,
    captureCurrent: Boolean(captureSessionId),
  });
  const racePreviewSessionId = racePreviewRef.current?.sessionId ?? '';
  const snapshot = useMemo<ClubLiveSnapshot | null>(() => buildClubLiveSnapshot({
    accessActive,
    activity,
    demoMode,
    racePreviewSessionId,
    selection,
    tabletSessionActive,
  }), [
    accessActive,
    activity,
    demoMode,
    racePreviewSessionId,
    selection.clubId,
    selection.studioRiderId,
    tabletSessionActive,
  ]);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const streamRevision = clubLiveStreamSnapshotRevision(snapshot);

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
    setPublishedStreamRevision('');
    let disposed = false;
    let publishedSessionId = '';
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
        && currentSnapshot.sessionId
        && currentSnapshot.clubId === selection.clubId
        && currentSnapshot.studioRiderId === selection.studioRiderId
      ) {
        const requestedSessionId = currentSnapshot.sessionId;
        const requestedStreamRevision = clubLiveStreamSnapshotRevision(currentSnapshot);
        operation = publishClubLiveSession(currentSnapshot, controller.signal).then(() => {
          if (!disposed) {
            publishedSessionId = requestedSessionId;
            setPublishedStreamRevision(requestedStreamRevision);
          }
        });
      } else if (publishedSessionId) {
        const stoppedSessionId = publishedSessionId;
        operation = stopClubLiveSession({ ...selection, sessionId: stoppedSessionId }, {
          signal: controller.signal,
        }).then(() => {
          if (publishedSessionId === stoppedSessionId) {
            publishedSessionId = '';
            setPublishedStreamRevision('');
          }
        });
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
      if (!tabletSessionActive && publishedSessionId) {
        void stopClubLiveSession({ ...selection, sessionId: publishedSessionId }, {
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [
    demoMode,
    profileKey,
    selection.clubId,
    selection.studioRiderId,
    tabletSessionActive,
  ]);

  useEffect(() => {
    const sessionId = snapshot?.sessionId ?? '';
    if (
      !profileKey
      || demoMode
      || !tabletSessionActive
      || !activityScreenVisible
      || !sessionId
      || !streamRevision
      || publishedStreamRevision !== streamRevision
    ) {
      setActivityVideoStreaming(false);
      return undefined;
    }
    return startClubLiveVideoPublisher({
      sessionId,
      activityVisible: () => clubLiveScreenFrameMatchesVisibleActivity(
        activityScreenVisibleRef.current,
        snapshotRef.current,
        selection,
        sessionId,
      ),
      onState: (state) => setActivityVideoStreaming(state === 'streaming'),
    });
  }, [
    activityScreenVisible,
    demoMode,
    profileKey,
    publishedStreamRevision,
    selection.clubId,
    selection.studioRiderId,
    snapshot?.sessionId,
    streamRevision,
    tabletSessionActive,
  ]);

  useEffect(() => {
    if (
      !profileKey
      || demoMode
      || activityVideoStreaming
      || !nativeClubLiveScreenMirrorAvailable()
    ) return undefined;
    let disposed = false;
    let operationActive = false;
    let publishedSessionId = '';
    let controller: AbortController | null = null;

    const clearPublishedFrame = async (keepalive = false) => {
      if (!publishedSessionId) return;
      const sessionId = publishedSessionId;
      publishedSessionId = '';
      controller = new AbortController();
      try {
        await stopClubLiveScreenFrame({ ...selection, sessionId }, {
          keepalive,
          signal: keepalive ? undefined : controller.signal,
        });
      } catch (error) {
        if (!disposed && (error as Error).name !== 'AbortError') {
          console.warn(`Could not stop Club Live screen sharing: ${(error as Error).message}`);
        }
      } finally {
        controller = null;
      }
    };

    const syncFrame = async () => {
      if (
        disposed
        || operationActive
        || document.visibilityState === 'hidden'
        || !activityScreenVisibleRef.current
      ) return;
      const currentSnapshot = snapshotRef.current;
      if (!clubLiveScreenFrameMatchesVisibleActivity(
        activityScreenVisibleRef.current,
        currentSnapshot,
        selection,
      )) {
        operationActive = true;
        try {
          await clearPublishedFrame();
        } finally {
          operationActive = false;
        }
        return;
      }

      operationActive = true;
      const requestedSessionId = currentSnapshot.sessionId;
      try {
        const frame = await captureNativeClubLiveScreenMirror();
        const latestSnapshot = snapshotRef.current;
        if (
          disposed
          || !frame
          || !clubLiveScreenFrameMatchesVisibleActivity(
            activityScreenVisibleRef.current,
            latestSnapshot,
            selection,
            requestedSessionId,
          )
        ) return;
        controller = new AbortController();
        await publishClubLiveScreenFrame({
          clubId: selection.clubId,
          studioRiderId: selection.studioRiderId,
          sessionId: requestedSessionId,
          jpegDataUrl: frame.dataUrl,
          width: frame.pixelWidth,
          height: frame.pixelHeight,
          capturedAt: frame.capturedAt,
        }, controller.signal);
        publishedSessionId = requestedSessionId;
      } catch (error) {
        if (!disposed && (error as Error).name !== 'AbortError') {
          // The first frame can race the telemetry heartbeat. Keep this quiet
          // and retry on the next tick; all other failures remain fail-closed.
          const status = Number((error as { status?: unknown }).status);
          if (status !== 409) {
            console.warn(`Could not share the TrackLab activity screen: ${(error as Error).message}`);
          }
        }
      } finally {
        controller = null;
        operationActive = false;
      }
    };

    const initialTimer = window.setTimeout(() => void syncFrame(), 350);
    const timer = window.setInterval(() => void syncFrame(), 1_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncFrame();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      controller?.abort();
      if (publishedSessionId) {
        const sessionId = publishedSessionId;
        publishedSessionId = '';
        void stopClubLiveScreenFrame({ ...selection, sessionId }, { keepalive: true }).catch(() => undefined);
      }
    };
  }, [
    activityVideoStreaming,
    demoMode,
    profileKey,
    selection.clubId,
    selection.studioRiderId,
  ]);

  return activityVideoStreaming ? (
    <div className="club-live-sharing-indicator" role="status" aria-live="polite">
      <i aria-hidden="true" /> Activity screen shared with club owner
    </div>
  ) : null;
}

export default ClubLiveAthleteBridge;
