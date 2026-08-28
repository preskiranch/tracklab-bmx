import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Bluetooth,
  CheckCircle2,
  Clock3,
  Compass,
  Gauge,
  LogOut,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  TabletSmartphone,
  Trash2,
  UserRoundCheck,
} from 'lucide-react';
import { RiderAvatar } from './RiderAvatar';
import {
  clubTabletAthleteDisplayName,
  endClubTabletSession,
  enrollClubTablet,
  loadClubTabletDevices,
  loadClubTabletRoster,
  recoverClubTabletDevice,
  revokeClubTabletDevice,
  startClubTabletSession,
  type ClubTabletAthlete,
  type ClubTabletDevice,
  type ClubTabletDeviceCredential,
  type ClubTabletRoster,
  type ClubTabletSessionCredential,
  type ClubTabletWatchConnectStatus,
} from '../lib/clubTablet';
import type { AppMode } from '../types';
import type { HeartRateLiveEvent } from '../lib/heartRateCloud';
import type { NativeBluetoothBootstrapStatus } from '../lib/nativeBluetoothBootstrap';
import type { ClubTabletDeviceStatus } from './ClubTabletRuntime';
import { loadClubTabletWatchConnectStatus } from '../lib/watchConnectCloud';
import { clubTabletWatchConnectSelectionState } from '../lib/studioWatchConnectSelection';
import { StudioWatchConnectStatus } from './StudioWatchConnectStatus';
import ClubTabletEventCard, {
  type ClubTabletEventReadyRequest,
} from './ClubTabletEventCard';
import {
  clubEventSlotForDevice,
  joinCurrentClubEvent,
  leaveCurrentClubEvent,
  type ClubEventEnvelope,
  type ClubEventLaunchPayload,
  type ClubEventSnapshot,
} from '../lib/clubEvent';
import './ClubTabletMode.css';

type ClubTabletBike = {
  deviceId: number;
  label: string;
};

export type ClubTabletProgram = Extract<
  AppMode,
  'race' | 'straight-sprint' | 'explore' | 'get-pulled'
>;

const clubTabletPrograms = [
  {
    mode: 'race',
    title: 'BMX Race Intervals',
    detail: 'Track drills & multiplayer',
    Icon: Bike,
  },
  {
    mode: 'straight-sprint',
    title: 'Straight Sprint',
    detail: 'Timed sprints & records',
    Icon: Route,
  },
  {
    mode: 'get-pulled',
    title: 'Get Pulled',
    detail: 'Air 1–10 sled pull tests',
    Icon: Gauge,
  },
  {
    mode: 'explore',
    title: 'Explore the World',
    detail: 'Solo and group routes',
    Icon: Compass,
  },
] as const satisfies ReadonlyArray<{
  mode: ClubTabletProgram;
  title: string;
  detail: string;
  Icon: typeof Bike;
}>;

type ClubTabletModeProps = {
  canAuthorize: boolean;
  device: ClubTabletDeviceCredential | null;
  status: ClubTabletDeviceStatus;
  ready: boolean;
  roster: ClubTabletRoster | null;
  session: ClubTabletSessionCredential | null;
  hr: Readonly<Record<string, HeartRateLiveEvent>>;
  bikes: ClubTabletBike[];
  btSupported: boolean;
  btBusy: boolean;
  bikeCount: number;
  nativeStatus: NativeBluetoothBootstrapStatus;
  setDevice: (device: ClubTabletDeviceCredential | null) => void;
  setRoster: (roster: ClubTabletRoster | null) => void;
  setSession: (session: ClubTabletSessionCredential | null) => void;
  openPairing: () => void;
  reconnectBikes: () => Promise<void> | void;
  retryAuthorization: () => void;
  /** Flushes the owner's latest camera/layout before enrollment revokes auth. */
  beforeAuthorize?: () => Promise<void> | void;
  demoActive: boolean;
  setDemoActive: (active: boolean) => void;
  openProgram: (mode: ClubTabletProgram) => void;
  /** Opens/configures a synchronized program before its shared startAt. */
  onClubEventLaunch?: (payload: ClubEventLaunchPayload) => void;
  /** Primes gate, ambience, bike, and commentary audio from a rider gesture. */
  onPrimeAudio?: () => Promise<void> | void;
};

export function clubTabletBikeAccessReady(
  deviceStatus: ClubTabletDeviceStatus,
  accessReady: boolean,
) {
  return deviceStatus === 'active' && accessReady;
}

/**
 * A successful recovery rotates the selected row's bearer and consumes the
 * owner's authorizing session. Keep that row out of this installation's
 * restore picker even if an already-running list request returns afterward.
 */
export function clubTabletRestoreCandidates(
  devices: readonly ClubTabletDevice[],
  consumedDeviceIds: ReadonlySet<string>,
) {
  return devices.filter((device) => (
    device.recoveryState === 'pending'
    && !device.recoveryCompleted
    && !consumedDeviceIds.has(device.id)
  ));
}

export function clubTabletWatchStatusRequestIsCurrent(requestKey: string, currentKey: string) {
  return Boolean(requestKey) && requestKey === currentKey;
}

export function clubTabletFreshHeartRateReading(
  reading: HeartRateLiveEvent | null | undefined,
  now = Date.now(),
) {
  if (
    !reading
    || reading.freshUntil == null
    || reading.freshUntil !== reading.recordedAt + 10_000
    || reading.freshUntil <= now
    || reading.recordedAt > now + 2_000
    || now - reading.recordedAt >= 10_000
  ) return null;
  return reading;
}

export function clubTabletCoachEventLocksIndependentTraining(
  event: ClubEventSnapshot | null | undefined,
  deviceId: string,
) {
  const slot = clubEventSlotForDevice(event, deviceId);
  return Boolean(slot?.ready && slot.status !== 'stale');
}

export function clubTabletShouldAutoStartSelection(input: Readonly<{
  hasActiveSession: boolean;
  demoActive: boolean;
  startPending: boolean;
  startFailed: boolean;
  selectedRiderId: string;
  selectedProgram: ClubTabletProgram | null;
  selectedBikeId: number | null;
  coachEventLocked: boolean;
}>) {
  return !input.hasActiveSession
    && !input.demoActive
    && !input.startPending
    && !input.startFailed
    && Boolean(input.selectedRiderId)
    && input.selectedProgram != null
    && input.selectedBikeId != null
    && !input.coachEventLocked;
}

function bikeLabel(bike: ClubTabletBike) {
  const suffix = String(Math.round(bike.deviceId)).slice(-3).padStart(3, '0');
  return `${bike.label || 'Wattbike'} · PM ${suffix}`;
}

function enrichClubTabletSession(
  session: ClubTabletSessionCredential,
  athlete: ClubTabletAthlete | null | undefined,
) {
  return {
    ...session,
    session: {
      ...session.session,
      ...(athlete?.athleteName ? { athleteName: athlete.athleteName } : {}),
      ...(athlete?.photoUrl ? { photoUrl: athlete.photoUrl } : {}),
    },
  };
}

export default function ClubTabletMode({
  canAuthorize,
  device: deviceCredential,
  status: deviceStatus,
  ready: accessReady,
  roster,
  session: sessionCredential,
  hr,
  bikes,
  btSupported: bluetoothSupported,
  btBusy: bluetoothBusy,
  bikeCount: authorizedBikeCount,
  nativeStatus: nativeBluetoothStatus,
  setDevice: onDeviceChange,
  setRoster: onRosterChange,
  setSession: onSessionChange,
  openPairing: onOpenBikePairing,
  reconnectBikes: onReconnectSavedBikes,
  retryAuthorization: onRetryAuthorization,
  beforeAuthorize: onBeforeAuthorize,
  demoActive,
  setDemoActive: onDemoActiveChange,
  openProgram: onOpenProgram,
  onClubEventLaunch,
  onPrimeAudio,
}: ClubTabletModeProps) {
  const [tabletName, setTabletName] = useState(() => {
    const platform = navigator.platform?.trim();
    return platform ? `Club tablet · ${platform}` : 'Club training tablet';
  });
  const [search, setSearch] = useState('');
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [selectedBikeId, setSelectedBikeId] = useState<number | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<ClubTabletProgram | null>(null);
  const [sessionStartFailed, setSessionStartFailed] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'authorizing' | 'roster' | 'starting' | 'ending'>('idle');
  const [managedDevices, setManagedDevices] = useState<ClubTabletDevice[]>([]);
  const [deviceManagementBusy, setDeviceManagementBusy] = useState(false);
  const [recoveringDeviceId, setRecoveringDeviceId] = useState('');
  const consumedRestoreDeviceIdsRef = useRef(new Set<string>());
  const [message, setMessage] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<ClubTabletWatchConnectStatus | null>(null);
  const [watchClock, setWatchClock] = useState(Date.now());
  const [clubEventSnapshot, setClubEventSnapshot] = useState<ClubEventSnapshot | null>(null);
  const clubEventSnapshotRef = useRef<ClubEventSnapshot | null>(null);
  const bikeAccessReady = clubTabletBikeAccessReady(deviceStatus, accessReady);
  const nativeBluetoothFailed = nativeBluetoothStatus.state === 'failed';
  const rememberedBike = roster?.device.pairedBike ?? deviceCredential?.device.pairedBike ?? null;
  const restoreCandidates = clubTabletRestoreCandidates(
    managedDevices,
    consumedRestoreDeviceIdsRef.current,
  );
  const completedRecoveryDevices = managedDevices.filter((device) => (
    !restoreCandidates.some((candidate) => candidate.id === device.id)
  ));

  const activeSession = sessionCredential && sessionCredential.session.expiresAt > Date.now()
    ? sessionCredential
    : null;
  const heartRateReading = clubTabletFreshHeartRateReading(
    activeSession ? hr[activeSession.session.studioRiderId] : null,
    watchClock,
  );
  const sessionAthlete = activeSession
    ? roster?.athletes.find((athlete) => athlete.studioRiderId === activeSession.session.studioRiderId)
    : null;
  const activeWatchRequestKey = activeSession
    ? `${activeSession.sessionToken}:${activeSession.session.clubId}:${activeSession.session.studioRiderId}`
    : '';
  const activeWatchRequestKeyRef = useRef(activeWatchRequestKey);
  const sessionStartPendingRef = useRef(false);
  const programOpenPendingRef = useRef(false);
  activeWatchRequestKeyRef.current = activeWatchRequestKey;
  const filteredAthletes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return roster?.athletes ?? [];
    return (roster?.athletes ?? []).filter((athlete) => (
      athlete.riderName.toLowerCase().includes(query)
      || athlete.athleteName?.toLowerCase().includes(query)
    ));
  }, [roster?.athletes, search]);

  useEffect(() => {
    setSelectedBikeId((current) => {
      if (demoActive) return null;
      if (current != null && bikes.some((bike) => bike.deviceId === current)) return current;
      return bikes.length === 1 ? bikes[0].deviceId : null;
    });
  }, [bikes, demoActive]);

  useEffect(() => {
    const timer = window.setInterval(() => setWatchClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeSession || !activeWatchRequestKey) {
      setWatchStatus(null);
      return undefined;
    }
    let cancelled = false;
    setWatchStatus(sessionAthlete?.watchConnect ?? null);
    const refresh = () => {
      const requestKey = activeWatchRequestKey;
      void loadClubTabletWatchConnectStatus(activeSession.sessionToken)
        .then((next) => {
          if (
            cancelled
            || !clubTabletWatchStatusRequestIsCurrent(requestKey, activeWatchRequestKeyRef.current)
          ) return;
          setWatchStatus(next);
          setWatchClock(Date.now());
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSession, activeWatchRequestKey, sessionAthlete?.watchConnect]);

  useEffect(() => {
    if (!canAuthorize || deviceCredential) return;
    let cancelled = false;
    setDeviceManagementBusy(true);
    loadClubTabletDevices()
      .then((devices) => {
        if (!cancelled) setManagedDevices(devices);
      })
      .catch(() => {
        if (!cancelled) setManagedDevices([]);
      })
      .finally(() => {
        if (!cancelled) setDeviceManagementBusy(false);
      });
    return () => { cancelled = true; };
  }, [canAuthorize, deviceCredential]);

  const revokeDevice = async (device: ClubTabletDevice) => {
    if (!window.confirm(`Revoke ${device.name}? It will immediately lose access to the club roster and Club Live.`)) return;
    setDeviceManagementBusy(true);
    setMessage(null);
    try {
      await revokeClubTabletDevice(device.id);
      setManagedDevices((current) => current.filter((candidate) => candidate.id !== device.id));
      setMessage(`${device.name} has been revoked.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke this tablet.');
    } finally {
      setDeviceManagementBusy(false);
    }
  };

  const restoreDevice = async (device: ClubTabletDevice) => {
    if (!window.confirm(
      `Restore ${device.name} on this iPad? Continue only if this is the same physical tablet; its previous authorization will stop working.`,
    )) return;
    setDeviceManagementBusy(true);
    setRecoveringDeviceId(device.id);
    setMessage(null);
    try {
      await onBeforeAuthorize?.();
      const credential = await recoverClubTabletDevice(device.id);
      // The server has now consumed the owner session and the replacement
      // credential is already durable. Commit kiosk identity immediately so
      // roster verification uses that exact bearer; native notification
      // cleanup is best-effort and must never hold this transition open.
      consumedRestoreDeviceIdsRef.current.add(device.id);
      setManagedDevices((current) => [...current]);
      onDeviceChange(credential);
      void import('./NativeNotificationsCoordinator')
        .then(({ clearNativePushAccountBoundary }) => clearNativePushAccountBoundary())
        .catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not restore this tablet.');
    } finally {
      setRecoveringDeviceId('');
      setDeviceManagementBusy(false);
    }
  };

  useEffect(() => {
    if (deviceStatus === 'active') setMessage(null);
  }, [deviceStatus]);

  const refreshRoster = async (credential = deviceCredential) => {
    if (!credential) return;
    setBusy('roster');
    setMessage(null);
    try {
      onRosterChange(await loadClubTabletRoster(credential));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the club athlete list.');
    } finally {
      setBusy('idle');
    }
  };

  const authorizeTablet = async () => {
    setBusy('authorizing');
    setMessage(null);
    try {
      await onBeforeAuthorize?.();
      const credential = await enrollClubTablet(tabletName);
      // Enrollment atomically revokes the owner's server session and push
      // delivery. Also unregister this physical app before kiosk state mounts;
      // that local operation still runs if the best-effort DELETE is now 401.
      await import('./NativeNotificationsCoordinator')
        .then(({ clearNativePushAccountBoundary }) => clearNativePushAccountBoundary())
        .catch(() => undefined);
      onDeviceChange(credential);
      setMessage('Tablet saved. Verifying authorization…');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not authorize this tablet.');
    } finally {
      setBusy('idle');
    }
  };

  const openIndependentProgram = useCallback(async (program: ClubTabletProgram) => {
    if (programOpenPendingRef.current) return;
    programOpenPendingRef.current = true;
    try {
      if (deviceCredential) {
        try {
          // Camera and rider-panel geometry can be edited from the owner's
          // laptop while this enrolled tablet remains open. Re-read the
          // device-bound presentation immediately before each independent
          // activity so the next render never depends on a stale mount-time
          // roster snapshot.
          onRosterChange(await loadClubTabletRoster(deviceCredential));
        } catch {
          // Independent training remains available offline with the last
          // verified roster/presentation. ClubTabletRuntime separately owns
          // authorization-revocation recovery.
        }
      }
      onOpenProgram(program);
    } finally {
      programOpenPendingRef.current = false;
    }
  }, [deviceCredential, onOpenProgram, onRosterChange]);

  const startAthlete = async (
    riderId = selectedRiderId,
    program = selectedProgram,
    bikeId = selectedBikeId,
  ) => {
    if (!riderId || !program || bikeId == null || sessionStartPendingRef.current) return;
    sessionStartPendingRef.current = true;
    setBusy('starting');
    setMessage(null);
    setSessionStartFailed(false);
    try {
      const session = await startClubTabletSession(riderId, bikeId, deviceCredential);
      const selectedAthlete = roster?.athletes.find((athlete) => athlete.studioRiderId === riderId);
      onSessionChange(enrichClubTabletSession(session, selectedAthlete));
      await openIndependentProgram(program);
    } catch (error) {
      setSessionStartFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not start this athlete session.');
    } finally {
      sessionStartPendingRef.current = false;
      setBusy('idle');
    }
  };

  const chooseAthlete = (athlete: ClubTabletAthlete) => {
    if (sessionStartPendingRef.current || demoActive) return;
    // This may be the final tap before an automatically opened race.
    void onPrimeAudio?.();
    setSelectedRiderId(athlete.studioRiderId);
    setSessionStartFailed(false);
    if (selectedProgram && selectedBikeId != null) {
      void startAthlete(athlete.studioRiderId, selectedProgram, selectedBikeId);
      return;
    }
    setMessage(selectedBikeId == null
      ? `${clubTabletAthleteDisplayName(athlete)} selected. Connect this tablet's Wattbike, then choose an activity.`
      : `${clubTabletAthleteDisplayName(athlete)} selected. Now choose an activity.`);
  };

  const chooseProgram = (program: ClubTabletProgram) => {
    if (sessionStartPendingRef.current) return;
    // Prime even when the athlete/bike selection completes asynchronously.
    void onPrimeAudio?.();
    if (demoActive) {
      setSelectedProgram(program);
      void openIndependentProgram(program);
      return;
    }
    if (deviceCredential && clubTabletCoachEventLocksIndependentTraining(
      clubEventSnapshotRef.current,
      deviceCredential.device.id,
    )) {
      setMessage('Leave the coach event before opening an Independent Training activity.');
      return;
    }
    setSelectedProgram(program);
    setSessionStartFailed(false);
    if (selectedRiderId && selectedBikeId != null) {
      void startAthlete(selectedRiderId, program, selectedBikeId);
      return;
    }
    const programTitle = clubTabletPrograms.find((candidate) => candidate.mode === program)?.title ?? 'Activity';
    setMessage(selectedBikeId == null
      ? `${programTitle} selected. Connect this tablet's Wattbike, then choose your athlete.`
      : `${programTitle} selected. Now choose your athlete.`);
  };

  useEffect(() => {
    if (!clubTabletShouldAutoStartSelection({
      hasActiveSession: Boolean(activeSession),
      demoActive,
      startPending: sessionStartPendingRef.current,
      startFailed: sessionStartFailed,
      selectedRiderId,
      selectedProgram,
      selectedBikeId,
      coachEventLocked: Boolean(deviceCredential && clubTabletCoachEventLocksIndependentTraining(
        clubEventSnapshotRef.current,
        deviceCredential.device.id,
      )),
    })) return;
    // Athlete and activity can be chosen while a saved Wattbike is still
    // reconnecting. Complete the same two-order workflow when that final bike
    // prerequisite arrives instead of requiring another tap.
    void startAthlete(selectedRiderId, selectedProgram, selectedBikeId);
  }, [
    activeSession,
    demoActive,
    deviceCredential,
    selectedBikeId,
    selectedProgram,
    selectedRiderId,
    sessionStartFailed,
  ]);

  const endAthlete = async () => {
    const endingSession = sessionCredential;
    const currentEvent = clubEventSnapshotRef.current;
    const eventSlot = deviceCredential
      ? clubEventSlotForDevice(currentEvent, deviceCredential.device.id)
      : null;
    setBusy('ending');
    setMessage(null);
    // Remove the selected identity and its BPM before the network request. A
    // slow or offline DELETE must never leave the former athlete visible on a
    // shared tablet.
    onSessionChange(null);
    setSelectedRiderId('');
    setSelectedProgram(null);
    let releaseWarning = '';
    if (
      endingSession
      && currentEvent
      && eventSlot?.athlete?.studioRiderId === endingSession.session.studioRiderId
    ) {
      try {
        await leaveCurrentClubEvent(currentEvent.id, endingSession);
      } catch (error) {
        releaseWarning = error instanceof Error ? error.message : 'The coach-event seat could not be released.';
      }
    }
    try {
      await endClubTabletSession(endingSession);
    } catch (error) {
      releaseWarning ||= error instanceof Error ? error.message : 'The athlete was cleared locally.';
    } finally {
      setBusy('idle');
      setMessage(releaseWarning
        ? `${releaseWarning} The athlete was cleared from this tablet.`
        : 'Athlete signed out. The Wattbike remains paired to this tablet for the next student.');
    }
  };

  const readyForClubEvent = useCallback(async ({
    event,
    selection,
  }: ClubTabletEventReadyRequest): Promise<ClubEventEnvelope> => {
    if (!deviceCredential || event.clubId !== deviceCredential.device.clubId) {
      throw new Error('This coach event belongs to a different club.');
    }
    if (event.status !== 'lobby') throw new Error('This coach event has already started.');
    if (selection.deviceId !== deviceCredential.device.id) {
      throw new Error('This coach-event selection belongs to a different tablet.');
    }
    if (sessionStartPendingRef.current) throw new Error('This tablet is already starting an athlete session.');

    sessionStartPendingRef.current = true;
    setBusy('starting');
    setMessage(null);
    let eventSession = activeSession;
    let createdSession = false;
    try {
      if (eventSession) {
        if (
          eventSession.deviceId !== deviceCredential.device.id
          || eventSession.session.clubId !== event.clubId
          || eventSession.session.studioRiderId !== selection.studioRiderId
          || eventSession.session.bikeDeviceId !== selection.bikeDeviceId
        ) {
          throw new Error('End the current athlete session before choosing someone else for the coach event.');
        }
      } else {
        const created = await startClubTabletSession(
          selection.studioRiderId,
          selection.bikeDeviceId,
          deviceCredential,
        );
        const selectedAthlete = roster?.athletes.find((athlete) => (
          athlete.studioRiderId === selection.studioRiderId
        ));
        eventSession = enrichClubTabletSession(created, selectedAthlete);
        createdSession = true;
        onSessionChange(eventSession);
      }

      const joined = await joinCurrentClubEvent(event.id, eventSession);
      clubEventSnapshotRef.current = joined.event;
      setClubEventSnapshot(joined.event);
      return joined;
    } catch (error) {
      // Creating the authoritative athlete lock and joining the event are one
      // user action. Roll that new lock back if the seat could not be claimed.
      if (createdSession) {
        onSessionChange(null);
        setSelectedRiderId('');
        await endClubTabletSession(eventSession).catch(() => undefined);
      }
      throw error;
    } finally {
      sessionStartPendingRef.current = false;
      setBusy('idle');
    }
  }, [activeSession, deviceCredential, onSessionChange, roster?.athletes]);

  const leaveCoachEvent = useCallback(async (event: ClubEventSnapshot) => {
    const endingSession = activeSession;
    if (!endingSession) throw new Error('No athlete is signed into this coach event.');
    try {
      const left = await leaveCurrentClubEvent(event.id, endingSession);
      clubEventSnapshotRef.current = left.event;
      setClubEventSnapshot(left.event);
      return left;
    } finally {
      // A shared tablet must not retain the athlete identity merely because a
      // network-side event release failed. Ending the secure session is also a
      // server-side fallback for releasing its event seat.
      onSessionChange(null);
      setSelectedRiderId('');
      setSelectedProgram(null);
      await endClubTabletSession(endingSession).catch(() => undefined);
    }
  }, [activeSession, onSessionChange]);

  const releaseCancelledClubEvent = useCallback((event: ClubEventSnapshot) => {
    const endingSession = activeSession;
    const slot = deviceCredential
      ? clubEventSlotForDevice(event, deviceCredential.device.id)
      : null;
    if (
      !endingSession
      || !slot?.athlete
      || slot.athlete.studioRiderId !== endingSession.session.studioRiderId
    ) return;
    onSessionChange(null);
    setSelectedRiderId('');
    setSelectedProgram(null);
    clubEventSnapshotRef.current = null;
    setClubEventSnapshot(null);
    void endClubTabletSession(endingSession).catch(() => undefined);
  }, [activeSession, deviceCredential, onSessionChange]);

  const launchClubEvent = useCallback((payload: ClubEventLaunchPayload) => {
    if (
      !activeSession
      || activeSession.session.studioRiderId !== payload.studioRiderId
      || activeSession.session.bikeDeviceId !== payload.bikeDeviceId
    ) {
      setMessage('This coach event could not open because its athlete session is no longer active.');
      return;
    }
    if (onClubEventLaunch) onClubEventLaunch(payload);
    else onOpenProgram(payload.program);
  }, [activeSession, onClubEventLaunch, onOpenProgram]);

  const updateClubEventSnapshot = useCallback((event: ClubEventSnapshot | null) => {
    clubEventSnapshotRef.current = event;
    setClubEventSnapshot((current) => (
      current?.id === event?.id
      && current?.updatedAt === event?.updatedAt
      && current?.status === event?.status
        ? current
        : event
    ));
  }, []);

  const openBikePairing = () => {
    if (!bikeAccessReady) {
      setMessage(deviceStatus === 'checking'
        ? 'Verifying tablet authorization before Bluetooth pairing.'
        : 'Tablet authorization must be restored before Bluetooth pairing.');
      return;
    }
    if (!bluetoothSupported) {
      setMessage(nativeBluetoothFailed
        ? 'Native Bluetooth could not start. Close and reopen the TrackLab app, then try again.'
        : 'Bluetooth is unavailable here. Use the TrackLab iPad app or a supported browser.');
      return;
    }
    setMessage(null);
    onOpenBikePairing();
  };

  const reconnectSavedBike = async () => {
    if (!bikeAccessReady) {
      setMessage(deviceStatus === 'checking'
        ? 'Verifying tablet authorization before reconnecting the Wattbike.'
        : 'Tablet authorization must be restored before reconnecting the Wattbike.');
      return;
    }
    if (!bluetoothSupported) {
      setMessage(nativeBluetoothFailed
        ? 'Native Bluetooth could not start. Close and reopen the TrackLab app, then try again.'
        : 'Bluetooth is unavailable here. Use the TrackLab iPad app or a supported browser.');
      return;
    }
    setMessage(null);
    await onReconnectSavedBikes();
  };

  const toggleDemoMode = () => {
    if (busy !== 'idle') return;
    const next = !demoActive;
    setSelectedRiderId('');
    setSelectedBikeId(null);
    setSelectedProgram(null);
    setSessionStartFailed(false);
    setMessage(next
      ? 'DEMO MODE is active. Choose any activity; no athlete, training, or Club Live record will be created.'
      : 'Demo mode ended. Connect the saved Wattbike and choose an athlete for recorded training.');
    onDemoActiveChange(next);
  };

  if (!deviceCredential) {
    return (
      <section className="club-tablet-mode setup">
        <div className="club-tablet-hero">
          <span className="club-tablet-icon"><ShieldCheck /></span>
          <div>
            <span className="eyebrow">Shared studio device</span>
            <h2>Authorize this club tablet</h2>
            <p>The club owner authorizes each tablet once. Students can then choose their approved athlete profile and use any club Wattbike paired to this device.</p>
          </div>
        </div>
        <div className="club-tablet-setup-card">
          {canAuthorize ? (
            <>
              <label>
                <span>Tablet name</span>
                <input value={tabletName} maxLength={80} onChange={(event) => setTabletName(event.target.value)} />
              </label>
              <button className="club-tablet-primary" type="button" disabled={busy !== 'idle' || !tabletName.trim()} onClick={authorizeTablet}>
                <ShieldCheck size={19} /> {busy === 'authorizing' ? 'Authorizing…' : 'Authorize this tablet'}
              </button>
              <small>This does not assign a student or a bike. Those choices remain separate and can change every session.</small>
            </>
          ) : (
            <div className="club-tablet-empty">
              <ShieldCheck size={34} />
              <strong>Club owner authorization required</strong>
              <p>Ask the club owner to sign in once on this tablet and authorize it. The authorization remains on this device.</p>
            </div>
          )}
          {message && <p className="club-tablet-message">{message}</p>}
        </div>
        {canAuthorize && (
          <section className="club-tablet-device-manager" aria-label="Authorized club tablets">
            <div>
              <span className="eyebrow">Owner controls</span>
              <h3>Authorized club tablets</h3>
              <p>Updated or reinstalled this iPad? Restore its existing authorization here. Revoke only a lost, sold, or retired tablet.</p>
            </div>
            <div className="club-tablet-device-list">
              {restoreCandidates.length > 0 && (
                <p className="club-tablet-device-group-title">Needs restoration on this iPad</p>
              )}
              {restoreCandidates.map((device) => (
                <article key={device.id}>
                  <TabletSmartphone size={23} />
                  <span>
                    <strong>{device.name}</strong>
                    <small>{device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : 'Not used yet'}</small>
                  </span>
                  <div className="club-tablet-device-actions">
                    <button
                      className="restore"
                      type="button"
                      disabled={deviceManagementBusy}
                      onClick={() => void restoreDevice(device)}
                      aria-label={`Restore ${device.name} on this iPad`}
                    >
                      <RefreshCw className={recoveringDeviceId === device.id ? 'club-tablet-spin' : ''} size={17} />
                      {recoveringDeviceId === device.id ? 'Restoring…' : 'Restore on this iPad'}
                    </button>
                    <button
                      type="button"
                      disabled={deviceManagementBusy}
                      onClick={() => void revokeDevice(device)}
                      aria-label={`Revoke ${device.name}`}
                    >
                      <Trash2 size={17} /> Revoke
                    </button>
                  </div>
                </article>
              ))}
              {completedRecoveryDevices.length > 0 && (
                <details className="club-tablet-completed-devices">
                  <summary>Manage already restored tablets ({completedRecoveryDevices.length})</summary>
                  <div>
                    {completedRecoveryDevices.map((device) => (
                      <article className="recovery-complete" key={device.id}>
                        <TabletSmartphone size={23} />
                        <span>
                          <strong>{device.name}</strong>
                          <small>{device.recoveryState === 'restored'
                            ? 'Restored authorization is active'
                            : 'Authorization is already complete'}</small>
                          {device.pairedBike && (
                            <small>Saved Wattbike: {bikeLabel(device.pairedBike)}</small>
                          )}
                        </span>
                        <div className="club-tablet-device-actions">
                          <span className="club-tablet-recovery-badge">No restore needed</span>
                          <button
                            type="button"
                            disabled={deviceManagementBusy}
                            onClick={() => void revokeDevice(device)}
                            aria-label={`Revoke ${device.name}`}
                          >
                            <Trash2 size={17} /> Revoke
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              )}
              {!deviceManagementBusy && managedDevices.length === 0 && <p>No authorized tablets yet.</p>}
              {deviceManagementBusy && <p>Loading authorized tablets…</p>}
            </div>
          </section>
        )}
      </section>
    );
  }

  if (deviceStatus === 'checking' || !accessReady && deviceStatus === 'active') {
    return (
      <section className="club-tablet-mode setup" aria-live="polite">
        <div className="club-tablet-access-state">
          <RefreshCw className="club-tablet-spin" size={38} />
          <span className="eyebrow">Secure shared device</span>
          <h2>Verifying tablet authorization…</h2>
          <p>TrackLab is confirming this tablet with the club before it enables the athlete roster or Wattbike pairing.</p>
        </div>
      </section>
    );
  }

  if (deviceStatus === 'error') {
    return (
      <section className="club-tablet-mode setup" aria-live="assertive">
        <div className="club-tablet-access-state error">
          <ShieldCheck size={38} />
          <span className="eyebrow">Authorization check interrupted</span>
          <h2>Could not verify this club tablet</h2>
          <p>Check this iPad’s internet connection, then retry. Wattbike pairing stays locked until the club authorization is confirmed.</p>
          <div className="club-tablet-access-actions">
            <button className="club-tablet-primary" type="button" onClick={onRetryAuthorization}>
              <RefreshCw size={18} /> Retry authorization
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              Refresh app
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (deviceStatus === 'revoked') {
    return (
      <section className="club-tablet-mode setup" aria-live="assertive">
        <div className="club-tablet-access-state error">
          <ShieldCheck size={38} />
          <h2>Tablet authorization ended</h2>
          <p>Ask the club owner to sign in and authorize this tablet again.</p>
        </div>
      </section>
    );
  }

  const coachRiderId = activeSession?.session.studioRiderId || selectedRiderId;
  const coachBikeId = activeSession?.session.bikeDeviceId ?? selectedBikeId;
  const coachAthlete = roster?.athletes.find((athlete) => athlete.studioRiderId === coachRiderId);
  const coachBike = bikes.find((bike) => bike.deviceId === coachBikeId);
  const waitingForCoach = clubTabletCoachEventLocksIndependentTraining(
    clubEventSnapshot,
    deviceCredential.device.id,
  );
  const coachEventCard = demoActive ? null : (
    <ClubTabletEventCard
      key="coach-event"
      device={deviceCredential}
      session={activeSession}
      selectedRiderId={coachRiderId}
      selectedBikeId={coachBikeId}
      selectedAthleteName={coachAthlete
        ? clubTabletAthleteDisplayName(coachAthlete)
        : activeSession?.session.athleteName || activeSession?.session.riderName}
      selectedBikeName={coachBike ? bikeLabel(coachBike) : null}
      onReady={readyForClubEvent}
      onLeave={leaveCoachEvent}
      onLobbyEnded={releaseCancelledClubEvent}
      onLaunch={launchClubEvent}
      onSnapshotChange={updateClubEventSnapshot}
      onPrimeAudio={onPrimeAudio}
    />
  );

  if (activeSession) {
    const athleteName = sessionAthlete
      ? clubTabletAthleteDisplayName(sessionAthlete)
      : activeSession.session.athleteName || activeSession.session.riderName;
    const expiresInMinutes = Math.max(1, Math.ceil((activeSession.session.expiresAt - Date.now()) / 60_000));
    const activeWatchState = clubTabletWatchConnectSelectionState({
      claimed: sessionAthlete?.status === 'claimed',
      status: watchStatus ?? sessionAthlete?.watchConnect,
      now: watchClock,
    });
    return (
      <section className="club-tablet-mode active">
        {coachEventCard}
        <div className="club-tablet-active-card">
          <RiderAvatar
            name={athleteName}
            photoUrl={sessionAthlete?.photoUrl ?? activeSession.session.photoUrl}
            accent="#7ade36"
            className="club-tablet-active-avatar"
          />
          <div>
            <span className="eyebrow"><CheckCircle2 size={15} /> Athlete session active</span>
            <h2>{athleteName}</h2>
            <p>{activeSession.session.clubName} · {bikeLabel({
              deviceId: activeSession.session.bikeDeviceId,
              label: bikes.find((bike) => bike.deviceId === activeSession.session.bikeDeviceId)?.label
                ?? (rememberedBike?.deviceId === activeSession.session.bikeDeviceId ? rememberedBike.label : 'Wattbike'),
            })}</p>
            <small><Clock3 size={13} /> Secure session renews automatically · about {expiresInMinutes} min remaining</small>
            <StudioWatchConnectStatus athleteName={athleteName} state={activeWatchState} />
            {activeWatchState.phase === 'connected'
              && (watchStatus ?? sessionAthlete?.watchConnect)?.liveSharingEnabled === true && (
                <span
                  aria-label={heartRateReading
                    ? `${athleteName} heart rate: ${Math.round(heartRateReading.bpm)} beats per minute, live now`
                    : `${athleteName} heart rate: No recent reading`}
                  aria-live="polite"
                  className={`club-tablet-heart-rate ${heartRateReading ? 'live' : 'waiting'}`}
                  role="status"
                >
                  <strong>{heartRateReading ? `${Math.round(heartRateReading.bpm)} BPM` : '—'}</strong>
                  <small>{heartRateReading ? 'Live from Apple Watch' : 'No recent reading'}</small>
                </span>
              )}
          </div>
          <button type="button" className="club-tablet-end" disabled={busy === 'ending'} onClick={endAthlete}>
            <LogOut size={18} /> {busy === 'ending' ? 'Ending…' : 'End athlete session'}
          </button>
        </div>

        <div className="club-tablet-independent-heading">
          <span className="eyebrow">Always available</span>
          <h3>Independent Training</h3>
          <p>{waitingForCoach
            ? 'This tablet is Ready for the coach. Leave the coach event before opening an independent activity.'
            : 'Choose any activity below when this tablet is not waiting for a coach start.'}</p>
        </div>
        <div className="club-tablet-programs">
          {clubTabletPrograms.map(({ mode, title, detail, Icon }) => (
            <button
              type="button"
              key={mode}
              disabled={waitingForCoach}
              title={waitingForCoach ? 'Leave the coach event before opening Independent Training.' : undefined}
              onClick={() => {
                if (!waitingForCoach) {
                  void onPrimeAudio?.();
                  void openIndependentProgram(mode);
                }
              }}
            >
              <Icon /><span><strong>{title}</strong><small>{detail}</small></span>
            </button>
          ))}
        </div>

        <div className="club-tablet-info-grid">
          <div><Radio /><span><strong>Club Live display is optional</strong><small>This tablet securely publishes the chosen program so the owner can open the central monitor when desired. The laptop does not connect to this bike.</small></span></div>
          <div><Bluetooth /><span><strong>Bike pairing stays saved</strong><small>Ending this athlete session clears only the student identity. It never erases the Wattbike pairing.</small></span></div>
          <div><UserRoundCheck /><span><strong>Records follow the athlete</strong><small>Completed sessions save to the selected athlete and club history, including profiles that have not been claimed yet.</small></span></div>
        </div>
        {message && <p className="club-tablet-message">{message}</p>}
      </section>
    );
  }

  return (
    <section className="club-tablet-mode">
      {coachEventCard}
      <header className="club-tablet-header">
        <div>
          <span className="eyebrow">{deviceCredential.device.clubName} · Club Tablet home</span>
          <h2>Independent Training</h2>
          <p>{demoActive
            ? 'DEMO MODE uses one simulated rider. Choose any activity without selecting an athlete or connecting a Wattbike.'
            : 'Choose an athlete and an activity in either order. TrackLab opens the activity as soon as both are selected.'}</p>
        </div>
        <button type="button" disabled={busy !== 'idle'} onClick={() => void refreshRoster()}>
          <RefreshCw size={17} /> Refresh roster
        </button>
      </header>

      <section className={`club-tablet-demo-control${demoActive ? ' active' : ''}`} aria-label="Club Tablet demo mode">
        <span className="club-tablet-demo-mark"><Radio size={22} /> DEMO</span>
        <span>
          <strong>{demoActive ? 'Demo bike ready' : 'Test without a Wattbike'}</strong>
          <small>{demoActive
            ? 'Simulated data stays on this screen and is never saved to an athlete, training history, or Club Live.'
            : 'Use a clearly labeled simulated rider to test BMX Race Intervals, Straight Sprint, Get Pulled, or Explore the World.'}</small>
        </span>
        <button type="button" disabled={busy !== 'idle' || waitingForCoach} onClick={toggleDemoMode}>
          {demoActive ? 'Exit demo mode' : 'Use demo bike'}
        </button>
      </section>

      <div className="club-tablet-workflow">
        <section className="club-tablet-step" aria-disabled={demoActive}>
          <div className="club-tablet-step-title"><b>1</b><span><strong>Choose athlete</strong><small>Claimed and unclaimed club profiles are both available.</small></span></div>
          <label className="club-tablet-search">
            <Search size={18} />
            <input disabled={demoActive} value={search} placeholder="Find athlete" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="club-tablet-athletes">
            {filteredAthletes.map((athlete) => {
              const selected = athlete.studioRiderId === selectedRiderId;
              const selectedWatchState = selected
                ? clubTabletWatchConnectSelectionState({
                  claimed: athlete.status === 'claimed',
                  status: athlete.watchConnect,
                  now: watchClock,
                })
                : null;
              return (
                <button
                  className={selected ? 'selected' : ''}
                  type="button"
                  key={athlete.studioRiderId}
                  disabled={busy === 'starting' || demoActive}
                  onClick={() => chooseAthlete(athlete)}
                >
                  <RiderAvatar name={clubTabletAthleteDisplayName(athlete)} photoUrl={athlete.photoUrl} accent={selected ? '#7ade36' : '#8d9a87'} />
                  <span>
                    <strong>{clubTabletAthleteDisplayName(athlete)}</strong>
                    <small>{athlete.status === 'claimed' ? 'Claimed TrackLab profile' : 'Studio profile · not claimed yet'}</small>
                    {selectedWatchState && (
                      <StudioWatchConnectStatus
                        athleteName={clubTabletAthleteDisplayName(athlete)}
                        state={selectedWatchState}
                      />
                    )}
                  </span>
                  {selected && <CheckCircle2 size={20} />}
                </button>
              );
            })}
            {busy === 'roster' && <p>Loading club athletes…</p>}
            {busy !== 'roster' && filteredAthletes.length === 0 && <p>No athletes match this search.</p>}
          </div>
        </section>

        <div className="club-tablet-home-actions">
        <section className="club-tablet-step club-tablet-bike-step">
          <div className="club-tablet-step-title"><span className="club-tablet-step-icon"><Bluetooth size={19} /></span><span><strong>This tablet’s Wattbike</strong><small>The saved pairing stays assigned after every athlete is released.</small></span></div>
          <div className="club-tablet-bikes">
            {demoActive ? (
              <div className="club-tablet-demo-bike" role="status">
                <Radio size={21} />
                <span><strong>Demo Bike 1</strong><small>Simulated input · no hardware or records</small></span>
                <CheckCircle2 size={20} />
              </div>
            ) : bikes.map((bike) => (
              <button
                className={selectedBikeId === bike.deviceId ? 'selected' : ''}
                type="button"
                key={bike.deviceId}
                disabled={busy === 'starting'}
                onClick={() => {
                  if (!sessionStartPendingRef.current) setSelectedBikeId(bike.deviceId);
                }}
              >
                <Bluetooth size={21} />
                <span><strong>{bikeLabel(bike)}</strong><small>Connected and available</small></span>
                {selectedBikeId === bike.deviceId && <CheckCircle2 size={20} />}
              </button>
            ))}
          </div>
          {!demoActive && bikes.length === 0 && (
            <div className="club-tablet-bike-actions">
              {rememberedBike && (
                <div className="club-tablet-remembered-bike" role="status">
                  <Bluetooth size={20} />
                  <span>
                    <strong>{bikeLabel(rememberedBike)}</strong>
                    <small>Saved to this tablet · waiting for Bluetooth reconnect</small>
                  </span>
                </div>
              )}
              <p>{bluetoothSupported
                ? rememberedBike
                  ? 'TrackLab remembers this Wattbike and is waiting for its live Bluetooth connection.'
                  : 'No Wattbike is connected to this tablet yet.'
                : nativeBluetoothFailed
                  ? 'Native Bluetooth could not start. Close and reopen the TrackLab app. If it continues, install the latest app build.'
                  : 'Bluetooth is unavailable in this browser. Use the TrackLab iPad app.'}</p>
              {bluetoothSupported && bikeAccessReady && (authorizedBikeCount > 0 || rememberedBike) && (
                <button type="button" disabled={bluetoothBusy} onClick={() => void reconnectSavedBike()}>
                  <RefreshCw size={17} /> Reconnect saved Wattbike
                </button>
              )}
              {bluetoothSupported && bikeAccessReady && (
                <button type="button" disabled={bluetoothBusy} onClick={openBikePairing}>
                  <Bluetooth size={17} /> Pair a Wattbike
                </button>
              )}
            </div>
          )}
        </section>

        <section className="club-tablet-step club-tablet-activity-step">
          <div className="club-tablet-step-title"><b>2</b><span><strong>Choose activity</strong><small>You can choose the activity before or after the athlete.</small></span></div>
          <div className="club-tablet-programs club-tablet-home-programs">
            {clubTabletPrograms.map(({ mode, title, detail, Icon }) => (
              <button
                className={selectedProgram === mode ? 'selected' : ''}
                type="button"
                key={mode}
                disabled={busy === 'starting' || waitingForCoach}
                onClick={() => chooseProgram(mode)}
              >
                <Icon /><span><strong>{title}</strong><small>{detail}</small></span>
                {selectedProgram === mode && <CheckCircle2 className="club-tablet-program-check" size={20} />}
              </button>
            ))}
          </div>
        </section>
        </div>
      </div>

      <footer className="club-tablet-start">
        <span><ShieldCheck size={18} /> {demoActive
          ? 'DEMO MODE · Simulated activity data is not saved or shown as a connected Wattbike.'
          : busy === 'starting'
          ? 'Verifying the athlete and opening the selected activity…'
          : 'Completed results stay with this athlete until they choose End activity. The Wattbike stays with this tablet.'}</span>
        {sessionStartFailed && (
          <button
            className="club-tablet-primary"
            type="button"
            disabled={!selectedRiderId || !selectedProgram || selectedBikeId == null || busy !== 'idle'}
            onClick={() => {
              void onPrimeAudio?.();
              void startAthlete();
            }}
          >
            <RefreshCw size={20} /> Retry selected activity
          </button>
        )}
      </footer>
      {message && <p className="club-tablet-message">{message}</p>}
    </section>
  );
}
