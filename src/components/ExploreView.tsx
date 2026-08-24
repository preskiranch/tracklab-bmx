import {
  ArrowLeftRight,
  Bike,
  Compass,
  ExternalLink,
  Flag,
  HeartPulse,
  Landmark,
  LocateFixed,
  MapPin,
  MapPinned,
  Mic,
  MicOff,
  Minimize2,
  Navigation2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Sparkles,
  Star,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { primeBikeRaceAudio, stopBikeRaceAudio, updateExploreBikeAudio } from '../lib/bikeRaceAudio';
import {
  exploreAverageSpeedMph,
  exploreDemoMaximumCruiseMph,
  exploreDemoMinimumCruiseMph,
  groupExploreRiders,
  exploreGridClass,
  exploreRemoteStateFreshMs,
  type ExploreCameraFollowPosition,
} from '../lib/explore';
import { exploreRolloutConfig } from '../game/exploreRollout';
import {
  fetchExploreElevationProfile,
  fetchExploreRoute,
  fetchSmartExploreRoutePlan,
  upgradeExploreRoutesToBicycleRoads,
  type ExploreElevationProfile,
  type ExploreSmartRoutePlan,
} from '../lib/exploreRoutes';
import {
  loadRecentExploreRoutes,
  mergeRecentExploreRoutes,
  rememberRecentExploreRoute,
  writeRecentExploreRoutes,
} from '../lib/exploreRecentRoutes';
import {
  clearExploreRideCheckpoint,
  createExploreRideSessionArm,
  createExploreRideStudioBinding,
  exploreRideSessionArmMatches,
  loadExploreRideCheckpoint,
  saveExploreRideCheckpoint,
  type ExploreRideCheckpoint,
} from '../lib/exploreRideCheckpoint';
import { loadCloudExploreRoutes, saveCloudExploreRoutes } from '../lib/cloudExploreRoutes';
import {
  exploreElevationAtMeter,
  exploreGradeAtMeter,
  exploreSlopeDirection,
  formatExploreElevation,
  formatExploreGrade,
  recommendedExploreAirSetting,
} from '../lib/exploreElevation';
import {
  fetchGoogleLandmarkDetails,
  fetchLocationPredictions,
  resetPlaceAutocompleteSession,
  resolveLocationText,
  resolvePlacePrediction,
  type GoogleLandmarkDetails,
  type PlacePredictionOption,
} from '../lib/googleMaps';
import { useExploreRide } from '../hooks/useExploreRide';
import { formatExploreDistanceMeters, formatSpeedFromKph, speedUnitLabel } from '../units';
import type {
  BikeSample,
  DistanceUnit,
  ExploreDistanceUnit,
  ExploreRideAuthorizationReferences,
  ExploreRideCompleteEvent,
  ExploreRider,
  ExploreRideSessionArm,
  ExploreRideSessionCancellation,
  ExploreRideSessionClockEvent,
  ExploreRideSessionRestored,
  ExploreRideSessionStartEvent,
  ExploreRideStudioBinding,
  ExploreRoute,
  MultiplayerExploreState,
  MultiplayerRoom,
  PlayerSlot,
  PlayMode,
  SpeedUnit,
  StudioRider,
  StudioRiderAssignments,
  TrackPoint,
} from '../types';
import { ExploreMapPanel } from './ExploreMapPanel';
import { ExploreRouteMapPicker } from './ExploreRouteMapPicker';
import { ExploreStreetViewOverlay } from './ExploreStreetViewOverlay';
import { RiderAvatar } from './RiderAvatar';
import './ExploreView.css';
import { heartRateReadingState } from './HeartRateMetric';
import type { LiveHeartRateByPlayer } from './RaceRiderOverlay';
import { demoHeartRateReadingForBikeSample } from '../lib/demoHeartRate';

type ExploreViewProps = {
  developerMode: boolean;
  players: PlayerSlot[];
  demoPlayerOptions: PlayerSlot[];
  selectedDemoPlayerIds: PlayerSlot['id'][];
  liveRiderProfiles: StudioRider[];
  liveRiderAssignments: StudioRiderAssignments;
  samplesByDevice: Map<number, BikeSample>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  onDistanceUnitChange: (unit: DistanceUnit) => void;
  playMode: PlayMode;
  demoMode: boolean;
  multiplayerConnection: string;
  currentRoom: MultiplayerRoom | null;
  currentUserId: string | null;
  accountProfileKey: string | null;
  cloudRecentRoutesEnabled: boolean;
  inviteUrl: string;
  remoteStates: MultiplayerExploreState[];
  voiceEnabled: boolean;
  voiceSupported: boolean;
  voiceStatus: string;
  voiceRemoteCount: number;
  onPlayModeChange: (mode: PlayMode) => void;
  onCreatePrivateRoom: () => boolean;
  onShareInvite: () => void;
  onSyncRoute: (route: ExploreRoute) => boolean;
  onControlSession: (action: 'start' | 'pause' | 'resume' | 'reset') => boolean;
  onSendState: (state: Omit<MultiplayerExploreState, 'clientId' | 'roomId' | 'at'>) => boolean;
  onDemoPlayerSelectionChange: (playerIds: PlayerSlot['id'][]) => void;
  onLiveRiderAssignment: (deviceId: number, riderId: string | null) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
  onDemoRideStatusChange?: (status: 'ready' | 'riding' | 'paused' | 'finished') => void;
  onLiveStateChange?: (state: {
    status: 'ready' | 'riding' | 'paused' | 'finished';
    route: ExploreRoute | null;
    riders: ExploreRider[];
    elapsedMs: number;
  } | null) => void;
  onRideComplete?: (result: ExploreRideCompleteEvent) => void;
  /** Called before a local studio ride starts; may reserve server IDs, never a token. */
  onRideSessionArm?: (
    session: ExploreRideSessionArm,
  ) => ExploreRideAuthorizationReferences | null | void | Promise<ExploreRideAuthorizationReferences | null | void>;
  /** Awaited before a restored ride resumes so the caller can recover its in-memory token. */
  onRideSessionRestore?: (session: ExploreRideSessionRestored) => void | Promise<void>;
  onRideSessionStart?: (session: ExploreRideSessionStartEvent) => void;
  onRideSessionPause?: (session: ExploreRideSessionClockEvent) => void;
  onRideSessionResume?: (session: ExploreRideSessionClockEvent) => void;
  onRideSessionCancel?: (session: ExploreRideSessionCancellation) => void;
  /** Legacy personal-session reset callback retained for existing callers. */
  onRideSessionReset?: (sessionId: string) => void;
  fullscreen: boolean;
  onFullscreenChange: (enabled: boolean) => void;
  heartRateByPlayer?: LiveHeartRateByPlayer;
};

export function formatExploreDemoRollout(distanceUnit: DistanceUnit) {
  const rolloutMeters = exploreRolloutConfig.rolloutMetersPerCrankRevolution;
  const value = distanceUnit === 'm' ? rolloutMeters : rolloutMeters * 3.28084;
  return `${value.toFixed(1)} ${distanceUnit}`;
}

export function exploreSmartRoutePlaceholder(distanceUnit: DistanceUnit) {
  const exampleDistance = distanceUnit === 'm' ? '16-kilometer' : '10-mile';
  return `Example: A ${exampleDistance} coastal ride in Malibu with ocean views, or stage 3 of the 2026 Tour de France`;
}

type ExploreMapRenderer = 'google-satellite' | 'google-3d' | 'apple-satellite';
const exploreTravelMode = 'bicycle' as const;

const ExploreGoogle3DMapPanel = lazy(() => import('./ExploreGoogle3DMapPanel')
  .then((module) => ({ default: module.ExploreGoogle3DMapPanel })));
const ExploreAppleMapPanel = lazy(() => import('./ExploreAppleMapPanel')
  .then((module) => ({ default: module.ExploreAppleMapPanel })));
const exploreMapRendererStorageKey = 'tracklab-explore-map-renderer-v1';

function savedExploreMapRenderer(): ExploreMapRenderer {
  try {
    const saved = window.localStorage.getItem(exploreMapRendererStorageKey);
    return saved === 'google-3d' || saved === 'apple-satellite' ? saved : 'google-satellite';
  } catch {
    return 'google-satellite';
  }
}

type ExploreOrigin = {
  point: TrackPoint;
  label: string;
};

type ExploreLandmarkPopup = {
  details: GoogleLandmarkDetails | null;
  error: string;
  placeId: string;
  status: 'loading' | 'ready' | 'error';
};

type RecoveredExploreElevation = ExploreElevationProfile & {
  routeId: string;
};

type LocalExploreRideSession = {
  sessionId: string;
  startedAt: number;
  arm?: ExploreRideSessionArm;
  studioBinding?: ExploreRideStudioBinding;
};

function formatDuration(seconds: number) {
  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
  if (roundedMinutes < 60) {
    return `${roundedMinutes} min`;
  }
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function profileInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function safeExternalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

const exploreCameraFollowLabels: Record<ExploreCameraFollowPosition, string> = {
  behind: 'Behind',
  center: 'Centered',
  ahead: 'Ahead',
};

function nextExploreCameraFollowPosition(
  position: ExploreCameraFollowPosition,
): ExploreCameraFollowPosition {
  if (position === 'center') {
    return 'ahead';
  }
  return position === 'ahead' ? 'behind' : 'center';
}

function exploreAutocompleteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/REQUEST_DENIED|blocked|not allowed|not authorized|places\.googleapis\.com/i.test(message)) {
    return 'Google address suggestions are not enabled for this Maps key. Coordinates still work.';
  }
  return `${message} Coordinates still work.`;
}

function useLocationSuggestions(
  value: string,
  selectedPrediction: PlacePredictionOption | null,
  enabled: boolean,
) {
  const [predictions, setPredictions] = useState<PlacePredictionOption[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const input = value.trim();
    if (!enabled || (selectedPrediction && selectedPrediction.label === input)) {
      setPredictions([]);
      setStatus('');
      return;
    }
    if (input.length < 3) {
      setPredictions([]);
      setStatus('');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus('Searching Google addresses…');
      fetchLocationPredictions(input)
        .then((nextPredictions) => {
          if (cancelled) {
            return;
          }
          setPredictions(nextPredictions);
          setStatus(nextPredictions.length > 0 ? '' : 'No nearby address suggestions found. Coordinates still work.');
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setPredictions([]);
          setStatus(exploreAutocompleteError(error));
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, selectedPrediction, value]);

  return { predictions, status };
}

export function ExploreView({
  developerMode,
  players,
  demoPlayerOptions,
  selectedDemoPlayerIds,
  liveRiderProfiles,
  liveRiderAssignments,
  samplesByDevice,
  speedUnit,
  distanceUnit,
  onDistanceUnitChange,
  playMode,
  demoMode,
  multiplayerConnection,
  currentRoom,
  currentUserId,
  accountProfileKey,
  cloudRecentRoutesEnabled,
  inviteUrl,
  remoteStates,
  voiceEnabled,
  voiceSupported,
  voiceStatus,
  voiceRemoteCount,
  onPlayModeChange,
  onCreatePrivateRoom,
  onShareInvite,
  onSyncRoute,
  onControlSession,
  onSendState,
  onDemoPlayerSelectionChange,
  onLiveRiderAssignment,
  onVoiceStart,
  onVoiceStop,
  onDemoRideStatusChange,
  onLiveStateChange,
  onRideComplete,
  onRideSessionArm,
  onRideSessionRestore,
  onRideSessionStart,
  onRideSessionPause,
  onRideSessionResume,
  onRideSessionCancel,
  onRideSessionReset,
  fullscreen,
  onFullscreenChange,
  heartRateByPlayer = {},
}: ExploreViewProps) {
  const recentProfileKey = accountProfileKey?.trim() || null;
  const initialCheckpointRef = useRef<ExploreRideCheckpoint | null>(
    recentProfileKey && !demoMode ? loadExploreRideCheckpoint(recentProfileKey) : null,
  );
  const loadedCheckpointProfileRef = useRef(recentProfileKey);
  const pendingCheckpointRef = useRef<ExploreRideCheckpoint | null>(null);
  const rideSessionRef = useRef<LocalExploreRideSession | null>(
    initialCheckpointRef.current?.sessionId
      ? {
        sessionId: initialCheckpointRef.current.sessionId,
        startedAt: initialCheckpointRef.current.startedAt
          ?? Math.max(1, initialCheckpointRef.current.savedAt - initialCheckpointRef.current.elapsedMs),
        ...(initialCheckpointRef.current.studioBinding
          ? { studioBinding: initialCheckpointRef.current.studioBinding }
          : {}),
      }
      : null,
  );
  const restoredBindingPendingRef = useRef(Boolean(initialCheckpointRef.current?.studioBinding));
  const armingRideRef = useRef(false);
  const armAttemptRevisionRef = useRef(0);
  const pendingRideArmRef = useRef<ExploreRideSessionArm | null>(null);
  const initialRoute = initialCheckpointRef.current?.route ?? null;
  const [localRouteState, setLocalRouteState] = useState<{
    profileKey: string | null;
    route: ExploreRoute | null;
  }>(() => ({ profileKey: recentProfileKey, route: initialRoute }));
  const localRoute = localRouteState.profileKey === recentProfileKey
    ? localRouteState.route
    : null;
  const setLocalRoute = useCallback((nextRoute: ExploreRoute | null) => {
    setLocalRouteState({ profileKey: recentProfileKey, route: nextRoute });
  }, [recentProfileKey]);
  const [originText, setOriginText] = useState(initialRoute?.originLabel ?? '');
  const [destinationText, setDestinationText] = useState(initialRoute?.destinationLabel ?? '');
  const [routeName, setRouteName] = useState(initialRoute?.name ?? '');
  const [smartRoutePrompt, setSmartRoutePrompt] = useState('');
  const [smartRoutePlan, setSmartRoutePlan] = useState<ExploreSmartRoutePlan | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<ExploreOrigin | null>(() => (
    initialRoute ? { point: initialRoute.origin, label: initialRoute.originLabel } : null
  ));
  const [selectedDestination, setSelectedDestination] = useState<ExploreOrigin | null>(() => (
    initialRoute ? { point: initialRoute.destination, label: initialRoute.destinationLabel } : null
  ));
  const [selectedOriginPrediction, setSelectedOriginPrediction] = useState<PlacePredictionOption | null>(null);
  const [selectedDestinationPrediction, setSelectedDestinationPrediction] = useState<PlacePredictionOption | null>(null);
  const exploreDistanceUnit: ExploreDistanceUnit = distanceUnit === 'm' ? 'km' : 'mi';
  const [followZoom, setFollowZoom] = useState(18);
  const [cameraFollowPosition, setCameraFollowPosition] = useState<ExploreCameraFollowPosition>('center');
  const [cameraFollowEnabled, setCameraFollowEnabled] = useState(true);
  // This remains a per-browser rider preference and is intentionally not
  // included in multiplayer state, so every rider controls their own map.
  const [showMapLabels, setShowMapLabels] = useState(true);
  const [followTravelHeading, setFollowTravelHeading] = useState(false);
  const [mapRenderer, setMapRenderer] = useState<ExploreMapRenderer>(savedExploreMapRenderer);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeMessage, setRouteMessage] = useState(
    initialRoute ? 'Unfinished ride restored. Pair your Wattbike, then press Resume ride when ready.' : '',
  );
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [recentRouteState, setRecentRouteState] = useState<{
    profileKey: string | null;
    routes: ExploreRoute[];
  }>(() => ({
    profileKey: recentProfileKey,
    routes: recentProfileKey ? loadRecentExploreRoutes(recentProfileKey) : [],
  }));
  // Fail closed during an athlete/device switch. Effects load the new scope
  // after paint, so never render routes retained in state for the old scope.
  const recentRoutes = recentRouteState.profileKey === recentProfileKey
    ? recentRouteState.routes
    : [];
  const [elevationRecoveryStatus, setElevationRecoveryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [recoveredElevation, setRecoveredElevation] = useState<RecoveredExploreElevation | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<ExploreLandmarkPopup | null>(null);
  const [streetViewLandmark, setStreetViewLandmark] = useState<GoogleLandmarkDetails | null>(null);
  const appliedRoomSessionRef = useRef<string | null>(null);
  const landmarkRequestRef = useRef(0);
  const routeRequestRef = useRef(0);
  const recentRouteProfileRef = useRef(recentProfileKey);
  const recentRouteSaveSequenceRef = useRef(0);
  const scheduledStartTimerRef = useRef<number | null>(null);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);
  const latestRidersRef = useRef<ReturnType<typeof useExploreRide>['riders']>([]);
  const previousRideStatusRef = useRef<ReturnType<typeof useExploreRide>['status']>('ready');
  const sourceRoute = playMode === 'multiplayer'
    ? currentRoom?.exploreRoute ?? null
    : localRoute;
  const route = useMemo(() => {
    if (!sourceRoute || recoveredElevation?.routeId !== sourceRoute.id) {
      return sourceRoute;
    }
    return {
      ...sourceRoute,
      elevationSamples: recoveredElevation.elevationSamples,
      elevationGainMeters: recoveredElevation.elevationGainMeters,
      elevationLossMeters: recoveredElevation.elevationLossMeters,
    };
  }, [recoveredElevation, sourceRoute]);
  const effectiveMapRenderer = developerMode ? mapRenderer : 'google-satellite';
  const localClientId = currentUserId ?? 'local';
  const ride = useExploreRide({
    clientId: localClientId,
    players,
    route,
    samplesByDevice,
    demoMode,
    restoredRide: playMode === 'local' && !demoMode && initialCheckpointRef.current
      ? {
        routeId: initialCheckpointRef.current.route.id,
        riders: initialCheckpointRef.current.riders,
        elapsedMs: initialCheckpointRef.current.elapsedMs,
        activeClockSegments: initialCheckpointRef.current.activeClockSegments,
      }
      : null,
  });
  const {
    pause: pauseLocalRide,
    reset: resetLocalRide,
    restore: restoreLocalRide,
    resume: resumeLocalRide,
    start: startLocalRide,
  } = ride;
  latestRidersRef.current = ride.riders;
  const latestPlayersRef = useRef(players);
  latestPlayersRef.current = players;
  const latestClubLiveStateRef = useRef({
    status: ride.status,
    route,
    riders: ride.riders,
    elapsedMs: ride.elapsedMs,
  });
  latestClubLiveStateRef.current = {
    status: ride.status,
    route,
    riders: ride.riders,
    elapsedMs: ride.elapsedMs,
  };
  const latestCheckpointStateRef = useRef({
    route,
    riders: ride.riders,
    elapsedMs: ride.elapsedMs,
  });
  latestCheckpointStateRef.current = {
    route,
    riders: ride.riders,
    elapsedMs: ride.elapsedMs,
  };
  const fullscreenChangeRef = useRef(onFullscreenChange);
  fullscreenChangeRef.current = onFullscreenChange;
  const rideSessionCancelRef = useRef(onRideSessionCancel);
  rideSessionCancelRef.current = onRideSessionCancel;

  const roomHost = Boolean(currentRoom && currentRoom.hostId === currentUserId);
  const canChooseRoute = playMode === 'local' || roomHost;
  const activeRemoteRiders = useMemo(() => {
    if (playMode !== 'multiplayer' || !route) {
      return [];
    }
    const now = Date.now();
    return remoteStates
      .filter((state) => (
        state.clientId !== currentUserId
        && state.routeId === route.id
        && now - state.at <= exploreRemoteStateFreshMs
      ))
      .flatMap((state) => state.riders)
      .slice(0, Math.max(0, 4 - ride.riders.length));
  }, [currentUserId, playMode, remoteStates, ride.riders.length, route]);
  const visibleRiders = useMemo(
    () => [...ride.riders, ...activeRemoteRiders].slice(0, 4),
    [activeRemoteRiders, ride.riders],
  );
  const groups = useMemo(() => groupExploreRiders(visibleRiders), [visibleRiders]);
  const elevationAvailable = (route?.elevationSamples?.length ?? 0) >= 2;
  const liveDeviceByRider = useMemo(() => {
    const next = new Map<string, number>();
    Object.entries(liveRiderAssignments).forEach(([deviceId, riderId]) => {
      next.set(riderId, Number(deviceId));
    });
    return next;
  }, [liveRiderAssignments]);
  const originSuggestions = useLocationSuggestions(
    originText,
    selectedOriginPrediction,
    canChooseRoute && !selectedOrigin,
  );
  const destinationSuggestions = useLocationSuggestions(
    destinationText,
    selectedDestinationPrediction,
    canChooseRoute && !selectedDestination,
  );

  recentRouteProfileRef.current = recentProfileKey;

  useEffect(() => {
    if (loadedCheckpointProfileRef.current === recentProfileKey) {
      return;
    }
    loadedCheckpointProfileRef.current = recentProfileKey;
    pendingCheckpointRef.current = null;
    resetLocalRide();

    const checkpoint = recentProfileKey && !demoMode
      ? loadExploreRideCheckpoint(recentProfileKey)
      : null;
    rideSessionRef.current = checkpoint?.sessionId
      ? {
        sessionId: checkpoint.sessionId,
        startedAt: checkpoint.startedAt ?? Math.max(1, checkpoint.savedAt - checkpoint.elapsedMs),
        ...(checkpoint.studioBinding ? { studioBinding: checkpoint.studioBinding } : {}),
      }
      : null;
    restoredBindingPendingRef.current = Boolean(checkpoint?.studioBinding);
    setLocalRouteState({
      profileKey: recentProfileKey,
      route: checkpoint?.route ?? null,
    });
    if (!checkpoint) {
      setOriginText('');
      setDestinationText('');
      setRouteName('');
      setSelectedOrigin(null);
      setSelectedDestination(null);
      setRouteMessage('');
      return;
    }

    pendingCheckpointRef.current = checkpoint;
    setOriginText(checkpoint.route.originLabel);
    setDestinationText(checkpoint.route.destinationLabel);
    setRouteName(checkpoint.route.name ?? '');
    setSelectedOrigin({
      point: checkpoint.route.origin,
      label: checkpoint.route.originLabel,
    });
    setSelectedDestination({
      point: checkpoint.route.destination,
      label: checkpoint.route.destinationLabel,
    });
    setRouteStatus('idle');
    setRouteMessage('Unfinished ride restored. Pair your Wattbike, then press Resume ride when ready.');
  }, [demoMode, recentProfileKey, resetLocalRide]);

  useEffect(() => {
    if (playMode !== 'local' || demoMode) {
      return;
    }
    const checkpoint = pendingCheckpointRef.current
      ?? (ride.status === 'ready' && recentProfileKey
        ? loadExploreRideCheckpoint(recentProfileKey)
        : null);
    if (!checkpoint || localRoute?.id !== checkpoint.route.id) {
      return;
    }
    if (restoreLocalRide({
      routeId: checkpoint.route.id,
      riders: checkpoint.riders,
      elapsedMs: checkpoint.elapsedMs,
      activeClockSegments: checkpoint.activeClockSegments,
    })) {
      pendingCheckpointRef.current = null;
      setRouteMessage('Unfinished ride restored. Pair your Wattbike, then press Resume ride when ready.');
    }
  }, [demoMode, localRoute?.id, playMode, recentProfileKey, restoreLocalRide, ride.status]);

  useEffect(() => {
    let cancelled = false;
    recentRouteSaveSequenceRef.current += 1;
    if (!recentProfileKey) {
      setRecentRouteState({ profileKey: null, routes: [] });
      return () => {
        cancelled = true;
      };
    }
    const cachedRoutes = loadRecentExploreRoutes(recentProfileKey);
    setRecentRouteState({ profileKey: recentProfileKey, routes: cachedRoutes });

    if (!cloudRecentRoutesEnabled) {
      void upgradeExploreRoutesToBicycleRoads(cachedRoutes)
        .then((migration) => {
          if (cancelled || recentRouteProfileRef.current !== recentProfileKey) {
            return;
          }
          const nextRoutes = writeRecentExploreRoutes(recentProfileKey, migration.routes);
          setRecentRouteState({ profileKey: recentProfileKey, routes: nextRoutes });
          if (migration.upgradedCount > 0 || migration.failedCount > 0) {
            setRouteMessage(
              `${migration.upgradedCount > 0
                ? `${migration.upgradedCount} saved route${migration.upgradedCount === 1 ? '' : 's'} updated to follow bicycle-safe roads and paths.`
                : ''}${migration.failedCount > 0
                ? ` ${migration.failedCount} saved route${migration.failedCount === 1 ? '' : 's'} will retry when Google Routes is available.`
                : ''}`.trim(),
            );
          }
        })
        .catch((error: Error) => {
          console.warn(`Could not update local Explore routes: ${error.message}`);
        });
      return () => {
        cancelled = true;
      };
    }

    void loadCloudExploreRoutes()
      .then(async (cloudRoutes) => {
        if (cancelled || recentRouteProfileRef.current !== recentProfileKey) {
          return;
        }
        const mergedRoutes = mergeRecentExploreRoutes(cloudRoutes, cachedRoutes);
        const migration = await upgradeExploreRoutesToBicycleRoads(mergedRoutes);
        if (cancelled || recentRouteProfileRef.current !== recentProfileKey) {
          return;
        }
        const nextRoutes = writeRecentExploreRoutes(recentProfileKey, migration.routes);
        setRecentRouteState({ profileKey: recentProfileKey, routes: nextRoutes });

        const cloudIds = cloudRoutes.map((route) => route.id).join('|');
        const nextIds = nextRoutes.map((route) => route.id).join('|');
        if (migration.upgradedCount > 0 || cloudIds !== nextIds) {
          const savedRoutes = await saveCloudExploreRoutes(nextRoutes);
          if (!cancelled && recentRouteProfileRef.current === recentProfileKey) {
            const synchronizedRoutes = writeRecentExploreRoutes(recentProfileKey, savedRoutes);
            setRecentRouteState({ profileKey: recentProfileKey, routes: synchronizedRoutes });
          }
        }
        if (migration.upgradedCount > 0 || migration.failedCount > 0) {
          setRouteMessage(
            `${migration.upgradedCount > 0
              ? `${migration.upgradedCount} saved route${migration.upgradedCount === 1 ? '' : 's'} updated to follow bicycle-safe roads and paths.`
              : ''}${migration.failedCount > 0
              ? ` ${migration.failedCount} saved route${migration.failedCount === 1 ? '' : 's'} will retry when Google Routes is available.`
              : ''}`.trim(),
          );
        }
      })
      .catch((error: Error) => {
        console.warn(`Could not load personal Explore routes from TrackLab cloud: ${error.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [cloudRecentRoutesEnabled, recentProfileKey]);

  const rememberExploreRoute = useCallback((nextRoute: ExploreRoute) => {
    if (!recentProfileKey) {
      return;
    }
    const cachedRoutes = rememberRecentExploreRoute(recentProfileKey, nextRoute);
    setRecentRouteState({ profileKey: recentProfileKey, routes: cachedRoutes });
    if (!cloudRecentRoutesEnabled) {
      return;
    }

    const saveSequence = recentRouteSaveSequenceRef.current + 1;
    recentRouteSaveSequenceRef.current = saveSequence;
    void saveCloudExploreRoutes([nextRoute])
      .then((cloudRoutes) => {
        if (
          saveSequence !== recentRouteSaveSequenceRef.current
          || recentRouteProfileRef.current !== recentProfileKey
        ) {
          return;
        }
        const synchronizedRoutes = writeRecentExploreRoutes(recentProfileKey, cloudRoutes);
        setRecentRouteState({ profileKey: recentProfileKey, routes: synchronizedRoutes });
      })
      .catch((error: Error) => {
        console.warn(`Could not save this personal Explore route to TrackLab cloud: ${error.message}`);
      });
  }, [cloudRecentRoutesEnabled, recentProfileKey]);

  const closeLandmark = useCallback(() => {
    landmarkRequestRef.current += 1;
    setSelectedLandmark(null);
  }, []);

  const closeStreetView = useCallback(() => {
    setStreetViewLandmark(null);
  }, []);

  const useFreeCamera = useCallback(() => {
    setCameraFollowEnabled(false);
  }, []);

  const openStreetView = useCallback((landmark: GoogleLandmarkDetails) => {
    closeLandmark();
    const requestId = landmarkRequestRef.current;
    if (landmark.point || !landmark.address) {
      setStreetViewLandmark(landmark);
      return;
    }

    void resolveLocationText(landmark.address)
      .then((resolved) => {
        if (landmarkRequestRef.current !== requestId) {
          return;
        }
        setStreetViewLandmark({
          ...landmark,
          point: resolved.point,
        });
      })
      .catch(() => {
        if (landmarkRequestRef.current === requestId) {
          setStreetViewLandmark(landmark);
        }
      });
  }, [closeLandmark]);

  const toggleInteractiveLandmarks = useCallback(() => {
    const nextVisible = !showMapLabels;
    if (nextVisible && developerMode && mapRenderer === 'apple-satellite') {
      setMapRenderer('google-satellite');
    }
    setShowMapLabels(nextVisible);
  }, [developerMode, mapRenderer, showMapLabels]);

  const selectLandmark = useCallback((placeId: string) => {
    const requestId = landmarkRequestRef.current + 1;
    landmarkRequestRef.current = requestId;
    setSelectedLandmark({
      details: null,
      error: '',
      placeId,
      status: 'loading',
    });
    void fetchGoogleLandmarkDetails(placeId)
      .then((details) => {
        if (landmarkRequestRef.current !== requestId) {
          return;
        }
        setSelectedLandmark({
          details,
          error: '',
          placeId,
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (landmarkRequestRef.current !== requestId) {
          return;
        }
        setSelectedLandmark({
          details: null,
          error: error instanceof Error ? error.message : 'Google could not load that landmark.',
          placeId,
          status: 'error',
        });
      });
  }, []);

  useEffect(() => {
    closeLandmark();
    closeStreetView();
  }, [closeLandmark, closeStreetView, route?.id]);

  useEffect(() => {
    if (!sourceRoute) {
      setRecoveredElevation(null);
      setElevationRecoveryStatus('idle');
      return undefined;
    }
    if ((sourceRoute.elevationSamples?.length ?? 0) >= 2) {
      setRecoveredElevation(null);
      setElevationRecoveryStatus('ready');
      return undefined;
    }

    let controller: AbortController | null = null;
    let retryTimer: number | null = null;
    let cancelled = false;
    setRecoveredElevation(null);
    const recoverElevation = () => {
      controller = new AbortController();
      setElevationRecoveryStatus('loading');
      void fetchExploreElevationProfile(sourceRoute, controller.signal)
        .then((profile) => {
          if (cancelled || controller?.signal.aborted) {
            return;
          }
          const recovered = { ...profile, routeId: sourceRoute.id };
          const enrichedRoute = { ...sourceRoute, ...profile };
          setRecoveredElevation(recovered);
          setElevationRecoveryStatus('ready');
          if (playMode === 'local') {
            setLocalRoute(enrichedRoute);
            rememberExploreRoute(enrichedRoute);
          } else if (roomHost) {
            onSyncRoute(enrichedRoute);
          }
        })
        .catch((error: unknown) => {
          if (
            cancelled
            || controller?.signal.aborted
            || (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return;
          }
          setElevationRecoveryStatus('error');
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            recoverElevation();
          }, 15_000);
        });
    };
    recoverElevation();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    onSyncRoute,
    playMode,
    rememberExploreRoute,
    roomHost,
    sourceRoute?.distanceMeters,
    sourceRoute?.elevationSamples?.length,
    sourceRoute?.encodedPolyline,
    sourceRoute?.id,
  ]);

  useEffect(() => {
    if (effectiveMapRenderer !== 'google-satellite') {
      closeLandmark();
      closeStreetView();
    }
  }, [closeLandmark, closeStreetView, effectiveMapRenderer]);

  useEffect(() => {
    if (!developerMode) {
      return;
    }
    try {
      window.localStorage.setItem(exploreMapRendererStorageKey, mapRenderer);
    } catch {
      // Private browsing may disable persistent storage.
    }
  }, [developerMode, mapRenderer]);

  useEffect(() => {
    if (!showMapLabels) {
      closeLandmark();
      closeStreetView();
    }
  }, [closeLandmark, closeStreetView, showMapLabels]);

  useEffect(() => {
    updateExploreBikeAudio(ride.status, ride.riders);
  }, [ride.riders, ride.status]);

  useEffect(() => {
    if (
      playMode !== 'local'
      || demoMode
      || !recentProfileKey
      || !route
      || (ride.status !== 'riding' && ride.status !== 'paused')
    ) {
      return undefined;
    }

    const persistCheckpoint = () => {
      const latest = latestCheckpointStateRef.current;
      if (!latest.route || latest.route.id !== route.id || latest.riders.length === 0) {
        return;
      }
      saveExploreRideCheckpoint(recentProfileKey, {
        route: latest.route,
        riders: latest.riders,
        elapsedMs: latest.elapsedMs,
        ...(rideSessionRef.current ? {
          sessionId: rideSessionRef.current.sessionId,
          startedAt: rideSessionRef.current.startedAt,
        } : {}),
        activeClockSegments: ride.activeClockSegments,
        ...(rideSessionRef.current?.studioBinding
          ? { studioBinding: rideSessionRef.current.studioBinding }
          : {}),
      });
    };
    const pauseForBackground = () => {
      const session = rideSessionRef.current;
      const at = Date.now();
      pauseLocalRide();
      if (session && ride.status === 'riding') {
        onRideSessionPause?.({
          sessionId: session.sessionId,
          at,
          activeElapsedMs: latestCheckpointStateRef.current.elapsedMs,
          ...(session.studioBinding ? { studioBinding: session.studioBinding } : {}),
        });
      }
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        persistCheckpoint();
        pauseForBackground();
      }
    };
    const persistOnPageHide = () => {
      persistCheckpoint();
      pauseForBackground();
    };

    persistCheckpoint();
    const timer = window.setInterval(persistCheckpoint, 1_000);
    window.addEventListener('pagehide', persistOnPageHide);
    document.addEventListener('visibilitychange', persistWhenHidden);
    const nativeAppStateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        persistCheckpoint();
        pauseForBackground();
      }
    }).catch(() => null);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', persistOnPageHide);
      document.removeEventListener('visibilitychange', persistWhenHidden);
      void nativeAppStateListener.then((listener) => listener?.remove());
    };
  }, [demoMode, onRideSessionPause, pauseLocalRide, playMode, recentProfileKey, ride.activeClockSegments, ride.status, route]);

  useEffect(() => {
    if (demoMode) {
      onDemoRideStatusChange?.(ride.status);
    }
  }, [demoMode, onDemoRideStatusChange, ride.status]);

  useEffect(() => {
    if (!onLiveStateChange) {
      return undefined;
    }
    const publish = () => onLiveStateChange(latestClubLiveStateRef.current);
    publish();
    const timer = window.setInterval(publish, 1_000);
    return () => {
      window.clearInterval(timer);
      onLiveStateChange(null);
    };
  }, [onLiveStateChange]);

  useEffect(() => () => {
    routeRequestRef.current += 1;
    armAttemptRevisionRef.current += 1;
    stopBikeRaceAudio();
    fullscreenChangeRef.current(false);
    if (scheduledStartTimerRef.current != null) {
      window.clearTimeout(scheduledStartTimerRef.current);
    }
    const pendingArm = pendingRideArmRef.current;
    if (pendingArm) {
      rideSessionCancelRef.current?.({
        sessionId: pendingArm.sessionId,
        at: Date.now(),
        activeElapsedMs: 0,
        reason: 'view-closed',
        arm: pendingArm,
      });
      pendingRideArmRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !currentRoom?.exploreSession) {
      appliedRoomSessionRef.current = null;
      return;
    }
    const session = currentRoom.exploreSession;
    if (session.routeId !== route?.id) {
      return;
    }
    if (session.status === 'ready') {
      appliedRoomSessionRef.current = session.id;
      resetLocalRide();
      onFullscreenChange(false);
      return;
    }
    if (session.status === 'paused') {
      pauseLocalRide();
      return;
    }
    if (session.status === 'riding') {
      onFullscreenChange(true);
      if (appliedRoomSessionRef.current === session.id) {
        resumeLocalRide();
        return;
      }
      appliedRoomSessionRef.current = session.id;
      const startAt = session.startedAt ?? Date.now();
      const delayMs = Math.max(0, startAt - Date.now());
      if (scheduledStartTimerRef.current != null) {
        window.clearTimeout(scheduledStartTimerRef.current);
      }
      scheduledStartTimerRef.current = window.setTimeout(() => {
        scheduledStartTimerRef.current = null;
        void primeBikeRaceAudio().then(() => startLocalRide(startAt));
      }, delayMs);
    }
  }, [
    currentRoom?.exploreSession,
    pauseLocalRide,
    onFullscreenChange,
    playMode,
    resetLocalRide,
    resumeLocalRide,
    route?.id,
    startLocalRide,
  ]);

  useEffect(() => {
    if (
      ride.status === 'finished'
      && previousRideStatusRef.current !== 'finished'
    ) {
      const endedAt = Math.max(Date.now(), ...ride.riders.map((rider) => rider.finishedAt ?? 0));
      if (playMode === 'local' && recentProfileKey) {
        clearExploreRideCheckpoint(recentProfileKey);
      }
      if (route) {
        const session = rideSessionRef.current ?? {
          sessionId: `explore:${route.id}:${Math.round(Math.max(1, endedAt - ride.elapsedMs))}`,
          startedAt: Math.max(1, endedAt - ride.elapsedMs),
        };
        onRideComplete?.({
          sessionId: session.sessionId,
          route,
          riders: ride.riders,
          startedAt: session.startedAt,
          endedAt,
          durationMs: ride.elapsedMs,
          activeClockSegments: ride.activeClockSegments,
          ...(session.studioBinding ? { studioBinding: session.studioBinding } : {}),
        });
        rideSessionRef.current = null;
      }
      if (fullscreen) {
        onFullscreenChange(false);
      }
    }
    previousRideStatusRef.current = ride.status;
  }, [
    fullscreen,
    onFullscreenChange,
    onRideComplete,
    playMode,
    recentProfileKey,
    ride.elapsedMs,
    ride.activeClockSegments,
    ride.riders,
    ride.status,
    route,
  ]);

  useEffect(() => {
    if (playMode !== 'multiplayer' || !currentRoom || !route) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      onSendState({
        sessionId: currentRoom.exploreSession?.id ?? `${currentRoom.id}:${route.id}`,
        routeId: route.id,
        riders: latestRidersRef.current.map(({ photoUrl: _photoUrl, ...rider }) => rider),
      });
    }, 300);
    return () => window.clearInterval(timer);
  }, [currentRoom, onSendState, playMode, route]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setRouteStatus('error');
      setRouteMessage('This browser does not provide current location.');
      return;
    }
    routeRequestRef.current += 1;
    setRouteStatus('loading');
    setRouteMessage('Finding your current location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setSelectedOrigin({ point, label: 'My current location' });
        setSelectedOriginPrediction(null);
        setOriginText('My current location');
        setRouteStatus('idle');
        setRouteMessage('');
      },
      () => {
        setRouteStatus('error');
        setRouteMessage('Location permission was not available. Type a starting place instead.');
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  };

  const applyExploreRoute = (nextRoute: ExploreRoute, message = '') => {
    if (playMode === 'local' && recentProfileKey && nextRoute.id !== localRoute?.id) {
      clearExploreRideCheckpoint(recentProfileKey);
    }
    setLocalRoute(nextRoute);
    if (playMode === 'multiplayer') {
      onSyncRoute(nextRoute);
    }
    rememberExploreRoute(nextRoute);
    setRouteStatus('idle');
    setRouteMessage(message);
  };

  const applyMapPoints = (
    nextOrigin: { point: TrackPoint; label: string },
    nextDestination: { point: TrackPoint; label: string },
  ) => {
    routeRequestRef.current += 1;
    setSmartRoutePlan(null);
    setSelectedOrigin(nextOrigin);
    setSelectedOriginPrediction(null);
    setOriginText(nextOrigin.label);
    setSelectedDestination(nextDestination);
    setSelectedDestinationPrediction(null);
    setDestinationText(nextDestination.label);
    setRouteStatus('idle');
    setRouteMessage('Map points selected. Build your bicycle route when ready.');
    setMapPickerOpen(false);
    resetPlaceAutocompleteSession();
  };

  const applyRecentRoute = (routeId: string) => {
    const recentRoute = recentRoutes.find((candidate) => candidate.id === routeId);
    if (!recentRoute || !canChooseRoute) {
      return;
    }
    setSelectedOrigin({ point: recentRoute.origin, label: recentRoute.originLabel });
    setSelectedOriginPrediction(null);
    setOriginText(recentRoute.originLabel);
    setSelectedDestination({ point: recentRoute.destination, label: recentRoute.destinationLabel });
    setSelectedDestinationPrediction(null);
    setDestinationText(recentRoute.destinationLabel);
    setRouteName(recentRoute.name ?? '');
    setSmartRoutePlan(null);
    resetPlaceAutocompleteSession();
    resetLocalRide();
    applyExploreRoute(
      recentRoute,
      `Recent route loaded: ${recentRoute.originLabel} to ${recentRoute.destinationLabel}.`,
    );
  };

  const markRouteInputsChanged = () => {
    routeRequestRef.current += 1;
    setSmartRoutePlan(null);
    if (routeStatus === 'loading' || route) {
      setRouteStatus('idle');
      setRouteMessage('Location changed. Select Build Explore the World route to update the map.');
    }
  };

  const createRoute = async () => {
    if (!canChooseRoute) {
      return;
    }
    if (!destinationText.trim()) {
      setRouteStatus('error');
      setRouteMessage('Enter a destination.');
      return;
    }
    if (!selectedOrigin && !originText.trim()) {
      setRouteStatus('error');
      setRouteMessage('Enter a starting location or use your current location.');
      return;
    }

    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;
    setRouteStatus('loading');
    setRouteMessage('Google is calculating the route…');
    try {
      const origin = selectedOrigin
        ?? (selectedOriginPrediction
          ? await resolvePlacePrediction(selectedOriginPrediction)
          : await resolveLocationText(originText));
      const destination = selectedDestination
        ?? (selectedDestinationPrediction
          ? await resolvePlacePrediction(selectedDestinationPrediction)
          : await resolveLocationText(destinationText));
      const nextRoute = await fetchExploreRoute({
        origin: origin.point,
        destination: destination.point,
        originLabel: selectedOrigin?.label
          || selectedOriginPrediction?.label
          || origin.label
          || originText.trim(),
        destinationLabel: selectedDestination?.label
          || selectedDestinationPrediction?.label
          || destination.label
          || destinationText.trim(),
        travelMode: exploreTravelMode,
        routeName: routeName.trim(),
      });
      if (routeRequestRef.current !== requestId) {
        return;
      }
      applyExploreRoute(nextRoute);
    } catch (error) {
      if (routeRequestRef.current !== requestId) {
        return;
      }
      setRouteStatus('error');
      setRouteMessage(error instanceof Error ? error.message : 'The route could not be created.');
    }
  };

  const createSmartRoute = async () => {
    if (!canChooseRoute || routeStatus === 'loading') {
      return;
    }
    if (smartRoutePrompt.trim().length < 8) {
      setRouteStatus('error');
      setRouteMessage('Describe the ride you want in a little more detail.');
      return;
    }
    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;
    setRouteStatus('loading');
    setRouteMessage('Smart Route is researching locations and matching your ride…');
    setSmartRoutePlan(null);
    try {
      const plan = await fetchSmartExploreRoutePlan(smartRoutePrompt.trim());
      const origin = await resolveLocationText(plan.originQuery);
      const waypointLocations = [];
      for (const query of plan.waypointQueries) {
        const resolved = await resolveLocationText(query);
        waypointLocations.push({ point: resolved.point, label: resolved.label ?? query });
      }
      const destination = await resolveLocationText(plan.destinationQuery);
      const nextRoute = await fetchExploreRoute({
        origin: origin.point,
        destination: destination.point,
        originLabel: origin.label ?? plan.originQuery,
        destinationLabel: destination.label ?? plan.destinationQuery,
        travelMode: exploreTravelMode,
        routeName: plan.name,
        waypoints: waypointLocations,
      });
      if (routeRequestRef.current !== requestId) {
        return;
      }
      setSelectedOrigin({ point: origin.point, label: origin.label ?? plan.originQuery });
      setSelectedOriginPrediction(null);
      setOriginText(origin.label ?? plan.originQuery);
      setSelectedDestination({
        point: destination.point,
        label: destination.label ?? plan.destinationQuery,
      });
      setSelectedDestinationPrediction(null);
      setDestinationText(destination.label ?? plan.destinationQuery);
      setRouteName(plan.name);
      setSmartRoutePlan(plan);
      resetPlaceAutocompleteSession();
      resetLocalRide();
      applyExploreRoute(nextRoute, plan.summary);
    } catch (error) {
      if (routeRequestRef.current !== requestId) {
        return;
      }
      setRouteStatus('error');
      setRouteMessage(error instanceof Error ? error.message : 'Smart Route could not build that ride.');
    }
  };

  const reverseCompletedRoute = async () => {
    if (!route || !canChooseRoute || routeStatus === 'loading') {
      return;
    }

    const requestId = routeRequestRef.current + 1;
    routeRequestRef.current = requestId;
    setRouteStatus('loading');
    setRouteMessage('Google is reversing the completed route…');
    try {
      const nextRoute = await fetchExploreRoute({
        origin: route.destination,
        destination: route.origin,
        originLabel: route.destinationLabel,
        destinationLabel: route.originLabel,
        travelMode: exploreTravelMode,
        routeName: route.name ? `${route.name} — Reverse` : '',
        waypoints: [...(route.waypoints ?? [])].reverse(),
      });
      if (routeRequestRef.current !== requestId) {
        return;
      }
      setSelectedOrigin({ point: route.destination, label: route.destinationLabel });
      setSelectedOriginPrediction(null);
      setOriginText(route.destinationLabel);
      setSelectedDestinationPrediction(null);
      setSelectedDestination({ point: route.origin, label: route.originLabel });
      setDestinationText(route.originLabel);
      setRouteName(nextRoute.name ?? '');
      setSmartRoutePlan(null);
      resetPlaceAutocompleteSession();
      applyExploreRoute(nextRoute);
    } catch (error) {
      if (routeRequestRef.current !== requestId) {
        return;
      }
      setRouteStatus('error');
      setRouteMessage(error instanceof Error ? error.message : 'The reverse route could not be created.');
    }
  };

  const chooseNewDestination = () => {
    if (!route || !canChooseRoute) {
      return;
    }

    routeRequestRef.current += 1;
    setSelectedOrigin({ point: route.destination, label: route.destinationLabel });
    setSelectedOriginPrediction(null);
    setOriginText(route.destinationLabel);
    setSelectedDestinationPrediction(null);
    setSelectedDestination(null);
    setDestinationText('');
    setRouteName('');
    setSmartRoutePlan(null);
    setRouteStatus('idle');
    setRouteMessage(`Starting from ${route.destinationLabel}. Choose your next destination.`);
    resetPlaceAutocompleteSession();
    window.setTimeout(() => destinationInputRef.current?.focus(), 0);
  };

  const startOrResume = async () => {
    void primeBikeRaceAudio();
    if (playMode === 'multiplayer') {
      if (!roomHost) {
        return;
      }
      onFullscreenChange(true);
      onControlSession(ride.status === 'paused' ? 'resume' : 'start');
      return;
    }
    if (ride.status === 'paused') {
      const session = rideSessionRef.current ?? {
        sessionId: `explore:${route?.id ?? 'route'}:${Date.now()}`,
        startedAt: Math.max(1, Date.now() - ride.elapsedMs),
      };
      rideSessionRef.current = session;
      if (session.studioBinding && restoredBindingPendingRef.current) {
        if (!route) return;
        try {
          await onRideSessionRestore?.({
            sessionId: session.sessionId,
            route,
            startedAt: session.startedAt,
            elapsedMs: ride.elapsedMs,
            activeClockSegments: ride.activeClockSegments,
            studioBinding: session.studioBinding,
          });
          restoredBindingPendingRef.current = false;
        } catch (error) {
          setRouteStatus('error');
          setRouteMessage(`This studio ride could not recover its authorization. ${error instanceof Error ? error.message : String(error)}`);
          onFullscreenChange(false);
          return;
        }
      }
      const at = Date.now();
      onFullscreenChange(true);
      resumeLocalRide();
      onRideSessionResume?.({
        sessionId: session.sessionId,
        at,
        activeElapsedMs: ride.elapsedMs,
        ...(session.studioBinding ? { studioBinding: session.studioBinding } : {}),
      });
    } else {
      if (!route || armingRideRef.current) return;
      const arm = createExploreRideSessionArm(route, ride.riders, players, Date.now());
      if (!arm) {
        setRouteStatus('error');
        setRouteMessage('Every Explore athlete needs one connected Wattbike before this ride can start.');
        onFullscreenChange(false);
        return;
      }
      armingRideRef.current = true;
      const armAttemptRevision = armAttemptRevisionRef.current + 1;
      armAttemptRevisionRef.current = armAttemptRevision;
      pendingRideArmRef.current = arm;
      let studioBinding: ExploreRideStudioBinding | undefined;
      try {
        if (!demoMode && onRideSessionArm) {
          const references = await onRideSessionArm(arm);
          if (references != null) {
            const binding = createExploreRideStudioBinding(arm, references);
            if (!binding) throw new Error('The returned studio authorization did not match the armed bikes.');
            studioBinding = binding;
          }
        }
        if (armAttemptRevisionRef.current !== armAttemptRevision) return;
        if (!exploreRideSessionArmMatches(
          arm,
          latestCheckpointStateRef.current.route,
          latestRidersRef.current,
          latestPlayersRef.current,
        )) {
          onRideSessionCancel?.({
            sessionId: arm.sessionId,
            at: Date.now(),
            activeElapsedMs: 0,
            reason: 'binding-changed',
            arm,
            ...(studioBinding ? { studioBinding } : {}),
          });
          setRouteStatus('error');
          setRouteMessage('An athlete or Wattbike assignment changed while this ride was arming. Review the assignments and start again.');
          onFullscreenChange(false);
          return;
        }
        const startedAt = Date.now();
        if (!startLocalRide(startedAt)) return;
        const session: LocalExploreRideSession = {
          sessionId: arm.sessionId,
          startedAt,
          arm,
          ...(studioBinding ? { studioBinding } : {}),
        };
        rideSessionRef.current = session;
        restoredBindingPendingRef.current = false;
        onFullscreenChange(true);
        onRideSessionStart?.({
          ...arm,
          riders: ride.riders,
          startedAt,
          ...(studioBinding ? { studioBinding } : {}),
        });
      } catch (error) {
        if (armAttemptRevisionRef.current !== armAttemptRevision) return;
        onRideSessionCancel?.({
          sessionId: arm.sessionId,
          at: Date.now(),
          activeElapsedMs: 0,
          reason: 'authorization-failed',
          arm,
          ...(studioBinding ? { studioBinding } : {}),
        });
        setRouteStatus('error');
        setRouteMessage(`This studio ride could not be armed. ${error instanceof Error ? error.message : String(error)}`);
        onFullscreenChange(false);
      } finally {
        if (armAttemptRevisionRef.current === armAttemptRevision) {
          armingRideRef.current = false;
          pendingRideArmRef.current = null;
        }
      }
    }
  };

  const pauseRide = () => {
    if (playMode === 'multiplayer') {
      if (roomHost) {
        onControlSession('pause');
      }
    } else {
      const session = rideSessionRef.current;
      const at = Date.now();
      pauseLocalRide();
      if (session && ride.status === 'riding') {
        onRideSessionPause?.({
          sessionId: session.sessionId,
          at,
          activeElapsedMs: ride.elapsedMs,
          ...(session.studioBinding ? { studioBinding: session.studioBinding } : {}),
        });
      }
    }
  };

  const resetRide = () => {
    onFullscreenChange(false);
    if (playMode === 'multiplayer') {
      if (roomHost) {
        onControlSession('reset');
      }
    } else {
      armAttemptRevisionRef.current += 1;
      armingRideRef.current = false;
      if (pendingRideArmRef.current) {
        onRideSessionCancel?.({
          sessionId: pendingRideArmRef.current.sessionId,
          at: Date.now(),
          activeElapsedMs: 0,
          reason: 'reset',
          arm: pendingRideArmRef.current,
        });
        pendingRideArmRef.current = null;
      }
      if (rideSessionRef.current) {
        onRideSessionCancel?.({
          sessionId: rideSessionRef.current.sessionId,
          at: Date.now(),
          activeElapsedMs: ride.elapsedMs,
          reason: 'reset',
          ...(rideSessionRef.current.studioBinding
            ? { studioBinding: rideSessionRef.current.studioBinding }
            : {}),
        });
        onRideSessionReset?.(rideSessionRef.current.sessionId);
        rideSessionRef.current = null;
      }
      restoredBindingPendingRef.current = false;
      if (recentProfileKey) {
        clearExploreRideCheckpoint(recentProfileKey);
      }
      resetLocalRide();
    }
  };

  return (
    <div className="explore-view">
      <header className="explore-hero">
        <div>
          <span className="eyebrow">Wattbike virtual travel</span>
          <h2>Explore the World</h2>
          <p>Choose two real places, then pedal the Google route in satellite view.</p>
        </div>
        <div className="explore-mode-switch" aria-label="Explore the World session type">
          <button
            className={playMode === 'local' ? 'selected' : ''}
            type="button"
            onClick={() => onPlayModeChange('local')}
          >
            <Bike size={17} /> Local bikes
          </button>
          <button
            className={playMode === 'multiplayer' ? 'selected' : ''}
            type="button"
            onClick={() => onPlayModeChange('multiplayer')}
          >
            <Users size={17} /> Private room
          </button>
        </div>
      </header>

      {demoMode && (
        <div className="explore-demo-banner">
          <Radio size={17} />
          <strong>Developer Demo active</strong>
          <span>
            {exploreRolloutConfig.frontChainringTeeth}/{exploreRolloutConfig.rearCogTeeth} road rollout ·{' '}
            {formatExploreDemoRollout(distanceUnit)} per crank · natural launch ·{' '}
            {speedUnit === 'mph'
              ? `${exploreDemoMinimumCruiseMph}–${exploreDemoMaximumCruiseMph} MPH`
              : `${formatSpeedFromKph(exploreDemoMinimumCruiseMph * 1.609344, speedUnit)}–${formatSpeedFromKph(exploreDemoMaximumCruiseMph * 1.609344, speedUnit)} ${speedUnitLabel(speedUnit)}`} averages.
            {' '}Commentary is off; bike sounds remain on.
          </span>
        </div>
      )}

      <div className="explore-layout">
        <aside className="explore-setup-card">
          {demoMode && (
            <section className="explore-demo-rider-picker">
              <div>
                <span className="eyebrow">Demo riders</span>
                <small>Choose the exact riders entering this session.</small>
              </div>
              <div role="group" aria-label="Choose demo riders">
                {demoPlayerOptions.map((player) => {
                  const selected = selectedDemoPlayerIds.includes(player.id);
                  const lastSelected = selected && selectedDemoPlayerIds.length === 1;
                  const selectionLocked = ride.status === 'riding' || ride.status === 'paused';
                  return (
                    <button
                      key={player.id}
                      type="button"
                      className={selected ? 'selected' : ''}
                      style={{ '--player-color': player.accent } as CSSProperties}
                      aria-pressed={selected}
                      disabled={selectionLocked || lastSelected}
                      onClick={() => {
                        const requestedIds = selected
                          ? selectedDemoPlayerIds.filter((playerId) => playerId !== player.id)
                          : [...selectedDemoPlayerIds, player.id];
                        onDemoPlayerSelectionChange(
                          demoPlayerOptions
                            .map((option) => option.id)
                            .filter((playerId) => requestedIds.includes(playerId)),
                        );
                      }}
                    >
                      {player.photoUrl
                        ? <img src={player.photoUrl} alt="" />
                        : (
                          <span className="explore-demo-rider-initials">
                            {profileInitials(player.name)}
                          </span>
                        )}
                      <span>
                        <small>P{player.id}</small>
                        <strong>{player.name}</strong>
                      </span>
                      <b>{selected ? 'Selected' : 'Use'}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {!demoMode && players.length > 0 && (
            <section className="workflow-race-entry" aria-label="Explore the World rider profiles">
              <div className="workflow-race-entry-heading">
                <span>Explore the World Riders</span>
                <small>{players.length} connected</small>
              </div>
              <div className="workflow-race-entry-list">
                {players.map((player) => {
                  const deviceId = player.deviceId;
                  const assignedRiderId = deviceId == null
                    ? ''
                    : liveRiderAssignments[deviceId] ?? player.riderId ?? '';
                  const assignedRider = liveRiderProfiles.find((profile) => (
                    profile.id === assignedRiderId
                  ));
                  const selectionLocked = ride.status === 'riding' || ride.status === 'paused';
                  return (
                    <div className={`race-entry-card${assignedRider ? ' entered' : ''}`} key={deviceId ?? player.id}>
                      <div className={`race-entry-row${assignedRider ? ' entered' : ''}`}>
                        <span
                          className="player-chip"
                          style={{ '--player-color': player.accent } as CSSProperties}
                        >
                          P{player.id}
                        </span>
                        <span className="race-entry-copy">
                          <small className="race-entry-bike-name">
                            {player.bikeName ?? player.deviceLabel ?? 'Connected Wattbike'}
                          </small>
                          <strong>{assignedRider?.name ?? 'Choose your rider profile'}</strong>
                        </span>
                        <span className={`race-entry-status${assignedRider ? ' entered' : ''}`}>
                          {assignedRider ? 'Ready' : 'Profile'}
                        </span>
                      </div>
                      <label className="race-entry-rider-select">
                        <span>Rider</span>
                        <select
                          aria-label={`Rider profile for P${player.id}`}
                          value={assignedRiderId}
                          disabled={selectionLocked || deviceId == null}
                          onChange={(event) => {
                            if (deviceId != null) {
                              onLiveRiderAssignment(deviceId, event.target.value || null);
                            }
                          }}
                        >
                          <option value="">Use Wattbike name</option>
                          {liveRiderProfiles.map((profile) => {
                            const assignedDeviceId = liveDeviceByRider.get(profile.id);
                            return (
                              <option
                                value={profile.id}
                                disabled={assignedDeviceId != null && assignedDeviceId !== deviceId}
                                key={profile.id}
                              >
                                {profile.name}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      {assignedRider && (
                        <div className="race-entry-rider-photo">
                          <RiderAvatar
                            name={assignedRider.name}
                            photoUrl={assignedRider.photoUrl}
                            accent={player.accent}
                          />
                          <span>Connected rider profile</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {liveRiderProfiles.length === 0 && (
                <p className="race-entry-empty">Add a saved profile from Riders, then select it here.</p>
              )}
            </section>
          )}

          {playMode === 'multiplayer' && (
            <section className="explore-room-card">
              <span className="eyebrow">Private multiplayer</span>
              {currentRoom ? (
                <>
                  <strong>Room {currentRoom.id}</strong>
                  <small>{currentRoom.racerSeatCount ?? 0} / 4 rider seats</small>
                  <button type="button" onClick={onShareInvite} disabled={!inviteUrl}>
                    <Share2 size={15} /> Share room link
                  </button>
                  <button
                    type="button"
                    disabled={!voiceSupported}
                    aria-pressed={voiceEnabled}
                    onClick={voiceEnabled ? onVoiceStop : onVoiceStart}
                  >
                    {voiceEnabled ? <MicOff size={15} /> : <Mic size={15} />}
                    {voiceEnabled ? 'Mute microphone' : 'Enable microphone'}
                  </button>
                  <small aria-live="polite">
                    {voiceStatus}{voiceEnabled ? ` ${voiceRemoteCount} rider${voiceRemoteCount === 1 ? '' : 's'} connected.` : ''}
                    {' '}Off by default. TrackLab does not record room audio.
                  </small>
                  {!roomHost && <p>The room host chooses and controls the shared route.</p>}
                </>
              ) : (
                <>
                  <strong>{multiplayerConnection === 'open' ? 'Open a room' : 'Connecting…'}</strong>
                  <button type="button" onClick={onCreatePrivateRoom} disabled={multiplayerConnection !== 'open'}>
                    <Users size={15} /> Create private room
                  </button>
                </>
              )}
            </section>
          )}

          {developerMode && (
            <section className="explore-route-builder">
              <span className="eyebrow">Developer map comparison</span>
              <div className="explore-travel-mode" role="group" aria-label="Explore map renderer">
                <button
                  className={mapRenderer === 'google-satellite' ? 'selected' : ''}
                  type="button"
                  onClick={() => setMapRenderer('google-satellite')}
                >
                  Google Satellite
                </button>
                <button
                  className={mapRenderer === 'google-3d' ? 'selected' : ''}
                  type="button"
                  onClick={() => setMapRenderer('google-3d')}
                >
                  Google 3D
                </button>
                <button
                  className={mapRenderer === 'apple-satellite' ? 'selected' : ''}
                  type="button"
                  onClick={() => setMapRenderer('apple-satellite')}
                >
                  Apple Satellite
                </button>
              </div>
              <small className="explore-route-warning">
                Developer testing only. Riders always use the same route and Explore the World physics.
              </small>
            </section>
          )}

          <section className="explore-route-builder">
            <span className="eyebrow">Route</span>
            <label className="explore-recent-route-field">
              <span>Recent routes</span>
              <select
                aria-label="Recent Explore routes"
                value=""
                disabled={!canChooseRoute || recentRoutes.length === 0}
                onChange={(event) => applyRecentRoute(event.target.value)}
              >
                <option value="">
                  {recentRoutes.length > 0 ? 'Choose a recent route…' : 'No recent routes yet'}
                </option>
                {recentRoutes.map((recentRoute) => (
                  <option key={recentRoute.id} value={recentRoute.id}>
                    {recentRoute.name || `${recentRoute.originLabel} → ${recentRoute.destinationLabel}`}
                  </option>
                ))}
              </select>
            </label>
            <section className="explore-smart-route">
              <div>
                <Sparkles size={17} />
                <span><strong>Smart Route</strong><small>Describe the experience you want</small></span>
              </div>
              <textarea
                value={smartRoutePrompt}
                aria-label="Describe your Smart Route"
                placeholder={exploreSmartRoutePlaceholder(distanceUnit)}
                disabled={!canChooseRoute || routeStatus === 'loading'}
                maxLength={600}
                onChange={(event) => setSmartRoutePrompt(event.target.value)}
              />
              <button
                type="button"
                disabled={!canChooseRoute || routeStatus === 'loading' || smartRoutePrompt.trim().length < 8}
                onClick={createSmartRoute}
              >
                <Sparkles size={16} /> Find and build this ride
              </button>
            </section>
            <div className="explore-route-method-divider"><span>or choose your own route</span></div>
            <button
              className="explore-map-route-button"
              type="button"
              disabled={!canChooseRoute || routeStatus === 'loading'}
              onClick={() => setMapPickerOpen(true)}
            >
              <MapPin size={16} /> Choose start and destination on map
            </button>
            <div className="explore-route-method-divider"><span>or enter locations</span></div>
            <div className="location-field explore-location-field">
              <label>
                <span>Starting location</span>
                <input
                  type="text"
                  value={originText}
                  placeholder="Address, landmark, city, or coordinates"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={originSuggestions.predictions.length > 0}
                  aria-controls="explore-origin-suggestions"
                  disabled={!canChooseRoute}
                  onChange={(event) => {
                    const value = event.target.value;
                    markRouteInputsChanged();
                    if (selectedOriginPrediction && selectedOriginPrediction.label !== value) {
                      resetPlaceAutocompleteSession();
                    }
                    setOriginText(value);
                    setSelectedOrigin(null);
                    setSelectedOriginPrediction(null);
                  }}
                />
              </label>
              {originSuggestions.predictions.length > 0 && (
                <div
                  className="location-suggestions"
                  id="explore-origin-suggestions"
                  role="listbox"
                  aria-label="Starting location suggestions"
                >
                  {originSuggestions.predictions.map((prediction) => (
                    <button
                      key={prediction.id}
                      type="button"
                      role="option"
                      aria-selected={selectedOriginPrediction?.id === prediction.id}
                      onClick={() => {
                        markRouteInputsChanged();
                        setSelectedOrigin(null);
                        setSelectedOriginPrediction(prediction);
                        setOriginText(prediction.label);
                      }}
                    >
                      <strong>{prediction.mainText}</strong>
                      {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                    </button>
                  ))}
                </div>
              )}
              {originSuggestions.status && <p className="autocomplete-status">{originSuggestions.status}</p>}
            </div>
            <button type="button" onClick={useCurrentLocation} disabled={!canChooseRoute || routeStatus === 'loading'}>
              <LocateFixed size={15} /> Use my current location
            </button>
            <div className="location-field explore-location-field">
              <label>
                <span>Destination</span>
                <input
                  ref={destinationInputRef}
                  type="text"
                  value={destinationText}
                  placeholder="Where do you want to ride?"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={destinationSuggestions.predictions.length > 0}
                  aria-controls="explore-destination-suggestions"
                  disabled={!canChooseRoute}
                  onChange={(event) => {
                    const value = event.target.value;
                    markRouteInputsChanged();
                    if (selectedDestinationPrediction && selectedDestinationPrediction.label !== value) {
                      resetPlaceAutocompleteSession();
                    }
                    setDestinationText(value);
                    setSelectedDestination(null);
                    setSelectedDestinationPrediction(null);
                  }}
                />
              </label>
              {destinationSuggestions.predictions.length > 0 && (
                <div
                  className="location-suggestions"
                  id="explore-destination-suggestions"
                  role="listbox"
                  aria-label="Destination suggestions"
                >
                  {destinationSuggestions.predictions.map((prediction) => (
                    <button
                      key={prediction.id}
                      type="button"
                      role="option"
                      aria-selected={selectedDestinationPrediction?.id === prediction.id}
                      onClick={() => {
                        markRouteInputsChanged();
                        setSelectedDestination(null);
                        setSelectedDestinationPrediction(prediction);
                        setDestinationText(prediction.label);
                      }}
                    >
                      <strong>{prediction.mainText}</strong>
                      {prediction.secondaryText && <small>{prediction.secondaryText}</small>}
                    </button>
                  ))}
                </div>
              )}
              {destinationSuggestions.status && <p className="autocomplete-status">{destinationSuggestions.status}</p>}
            </div>
            <label>
              <span>Route name <small>(optional)</small></span>
              <input
                type="text"
                value={routeName}
                maxLength={80}
                placeholder="Example: Saturday Malibu coast ride"
                disabled={!canChooseRoute}
                onChange={(event) => setRouteName(event.target.value)}
              />
            </label>
            <button
              className="explore-create-route"
              type="button"
              disabled={!canChooseRoute || routeStatus === 'loading'}
              onClick={createRoute}
            >
              <MapPinned size={16} />
              {routeStatus === 'loading' ? 'Building route…' : 'Build Explore the World route'}
            </button>
            {routeMessage && <p className={`explore-route-message ${routeStatus}`}>{routeMessage}</p>}
            {smartRoutePlan && (
              <section className="explore-smart-route-result" aria-label="Smart Route research">
                <strong>{smartRoutePlan.name}</strong>
                <p>{smartRoutePlan.disclaimer}</p>
                {smartRoutePlan.sources.length > 0 && (
                  <div>
                    <span>Research sources</span>
                    {smartRoutePlan.sources.slice(0, 4).map((source) => (
                      <a key={source.url} href={safeExternalHttpUrl(source.url)} target="_blank" rel="noreferrer">
                        {source.title} <ExternalLink size={12} />
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}
            <small className="explore-route-warning">
              Routes favor bicycle-accessible roads and paths and avoid major interstates. This is an indoor virtual ride—not outdoor navigation.
            </small>
          </section>
        </aside>

        <div className="explore-stage">
          {route ? (
            <>
              <header className="explore-route-summary">
                <div>
                  {route.name && <small>{route.name}</small>}
                  <span>{route.originLabel}</span>
                  <strong><Flag size={16} /> {route.destinationLabel}</strong>
                </div>
                <dl>
                  <div><dt>Route</dt><dd>{formatExploreDistanceMeters(route.distanceMeters, exploreDistanceUnit)}</dd></div>
                  <div><dt>Google estimate</dt><dd>{formatDuration(route.durationSeconds)}</dd></div>
                  <div>
                    <dt>Elevation gain</dt>
                    <dd>{elevationAvailable
                      ? formatExploreElevation(route.elevationGainMeters ?? 0, exploreDistanceUnit)
                      : elevationRecoveryStatus === 'loading' ? 'Loading…' : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Descent</dt>
                    <dd>{elevationAvailable
                      ? formatExploreElevation(route.elevationLossMeters ?? 0, exploreDistanceUnit)
                      : elevationRecoveryStatus === 'loading' ? 'Loading…' : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>View</dt>
                    <dd>
                      {effectiveMapRenderer === 'google-3d'
                        ? `Google 3D${showMapLabels ? ' + labels' : ''}`
                        : effectiveMapRenderer === 'apple-satellite'
                          ? `Apple satellite${showMapLabels ? ' + labels' : ''}`
                          : showMapLabels ? 'Labeled satellite' : 'Google satellite'}
                    </dd>
                  </div>
                  <div><dt>Maps</dt><dd>{groups.length || 1} screen{groups.length === 1 ? '' : 's'}</dd></div>
                </dl>
              </header>

              <div className="explore-camera-toolbar" aria-label="Explore camera controls">
                <div
                  className="explore-destination-overlay"
                  aria-label={`Destination: ${route.destinationLabel}`}
                >
                  <Flag size={17} />
                  <small>Destination</small>
                  <strong>{route.destinationLabel}</strong>
                </div>
                <button
                  type="button"
                  aria-label="Show more of the route"
                  title="Show more of the route"
                  disabled={followZoom <= 12}
                  onClick={() => {
                    setCameraFollowEnabled(true);
                    setFollowZoom((zoom) => Math.max(12, zoom - 1));
                  }}
                >
                  <ZoomOut size={18} />
                </button>
                <label>
                  <span>Follow zoom</span>
                  <input
                    type="range"
                    min="12"
                    max="20"
                    step="1"
                    value={followZoom}
                    aria-label="Follow camera zoom"
                    aria-valuetext={`${followZoom}, ${followZoom <= 14 ? 'more route visible' : followZoom >= 19 ? 'closer rider view' : 'balanced rider view'}`}
                    onChange={(event) => {
                      setCameraFollowEnabled(true);
                      setFollowZoom(Number(event.target.value));
                    }}
                  />
                  <small>{followZoom <= 14 ? 'More route' : followZoom >= 19 ? 'Closer' : 'Balanced'}</small>
                </label>
                <button
                  type="button"
                  aria-label="Move closer to the riders"
                  title="Move closer to the riders"
                  disabled={followZoom >= 20}
                  onClick={() => {
                    setCameraFollowEnabled(true);
                    setFollowZoom((zoom) => Math.min(20, zoom + 1));
                  }}
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  className={`explore-camera-position-toggle ${cameraFollowPosition}${cameraFollowPosition === 'center'
                    ? ''
                    : ' explore-map-labels-toggle active'}`}
                  type="button"
                  aria-label={`Camera follow position: ${exploreCameraFollowLabels[cameraFollowPosition].toLowerCase()}`}
                  title={`Camera focus: ${exploreCameraFollowLabels[cameraFollowPosition]}. Select to change.`}
                  onClick={() => {
                    setCameraFollowEnabled(true);
                    setCameraFollowPosition((position) => (
                      nextExploreCameraFollowPosition(position)
                    ));
                  }}
                >
                  {cameraFollowPosition === 'center'
                    ? <LocateFixed size={18} />
                    : (
                      <Navigation2
                        className={cameraFollowPosition}
                        size={18}
                      />
                    )}
                  <span>{exploreCameraFollowLabels[cameraFollowPosition]}</span>
                </button>
                <button
                  className={`explore-map-labels-toggle${cameraFollowEnabled ? '' : ' active'}`}
                  type="button"
                  aria-label={cameraFollowEnabled ? 'Enable free camera' : 'Resume automatic camera'}
                  aria-pressed={!cameraFollowEnabled}
                  title={cameraFollowEnabled
                    ? 'Adjust zoom, tilt, and heading while the camera keeps following the riders'
                    : 'Return zoom and heading to automatic rider tracking'}
                  onClick={() => setCameraFollowEnabled((enabled) => !enabled)}
                >
                  <Compass size={18} />
                  <span>{cameraFollowEnabled ? 'Free camera' : 'Auto camera'}</span>
                </button>
                <div className="explore-toolbar-toggle" role="group" aria-label="Map orientation">
                  <button
                    className={!followTravelHeading ? 'active' : ''}
                    type="button"
                    aria-label="North up"
                    aria-pressed={!followTravelHeading}
                    title="Keep north at the top of the map"
                    onClick={() => {
                      setCameraFollowEnabled(true);
                      setFollowTravelHeading(false);
                    }}
                  >
                    <Compass size={18} />
                    <span>North up</span>
                  </button>
                  <button
                    className={followTravelHeading ? 'active' : ''}
                    type="button"
                    aria-label="Direction of travel up"
                    aria-pressed={followTravelHeading}
                    title="Keep the direction of travel at the top of the map"
                    onClick={() => {
                      setCameraFollowEnabled(true);
                      setFollowTravelHeading(true);
                    }}
                  >
                    <Navigation2 size={18} />
                    <span>Travel up</span>
                  </button>
                </div>
                <div className="explore-toolbar-toggle distance" role="group" aria-label="Explore distance unit">
                  <button
                    className={exploreDistanceUnit === 'mi' ? 'active' : ''}
                    type="button"
                    aria-label="Show distances in miles"
                    aria-pressed={exploreDistanceUnit === 'mi'}
                    onClick={() => onDistanceUnitChange('ft')}
                  >
                    <span className="distance-long">Miles</span>
                    <span className="distance-short">mi</span>
                  </button>
                  <button
                    className={exploreDistanceUnit === 'km' ? 'active' : ''}
                    type="button"
                    aria-label="Show distances in kilometers"
                    aria-pressed={exploreDistanceUnit === 'km'}
                    onClick={() => onDistanceUnitChange('m')}
                  >
                    <span className="distance-long">Kilometers</span>
                    <span className="distance-short">km</span>
                  </button>
                </div>
                <button
                  className={`explore-map-labels-toggle${showMapLabels ? ' active' : ''}`}
                  type="button"
                  aria-label={showMapLabels
                    ? 'Hide street names and landmarks'
                    : 'Show street names and landmarks'}
                  aria-pressed={showMapLabels}
                  title={showMapLabels
                    ? 'Hide street names and landmarks'
                    : 'Show street names and landmarks'}
                  onClick={toggleInteractiveLandmarks}
                >
                  <Landmark size={18} />
                  <span>{showMapLabels ? 'Labels on' : 'Street names'}</span>
                </button>
                {playMode === 'multiplayer' && currentRoom && (
                  <button
                    className={`explore-map-labels-toggle${voiceEnabled ? ' active' : ''}`}
                    type="button"
                    disabled={!voiceSupported}
                    aria-label={voiceEnabled ? 'Mute room microphone' : 'Enable room microphone'}
                    aria-pressed={voiceEnabled}
                    title={`${voiceStatus}${voiceEnabled ? ` ${voiceRemoteCount} connected.` : ''}`}
                    onClick={voiceEnabled ? onVoiceStop : onVoiceStart}
                  >
                    {voiceEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                    <span>{voiceEnabled ? 'Mic on' : 'Mic off'}</span>
                  </button>
                )}
                {fullscreen && (
                  <div className="explore-session-actions">
                    {ride.status === 'riding' ? (
                      <button
                        className="explore-pause-ride"
                        type="button"
                        aria-label={playMode === 'multiplayer' ? 'Pause everyone' : 'Pause ride'}
                        onClick={pauseRide}
                        disabled={playMode === 'multiplayer' && !roomHost}
                      >
                        <Pause size={18} />
                        <span>Pause</span>
                      </button>
                    ) : (
                      <button
                        className="explore-resume-ride"
                        type="button"
                        onPointerDown={() => { void primeBikeRaceAudio(); }}
                        onClick={startOrResume}
                        disabled={
                          players.length === 0
                          || (playMode === 'multiplayer' && (!currentRoom || !roomHost))
                        }
                      >
                        <Play size={18} />
                        <span>{ride.status === 'paused' ? 'Resume' : 'Start'}</span>
                      </button>
                    )}
                    <button
                      className="explore-exit-fullscreen"
                      type="button"
                      aria-label="Exit full screen"
                      onClick={() => onFullscreenChange(false)}
                    >
                      <Minimize2 size={18} />
                      <span>Exit full screen</span>
                    </button>
                  </div>
                )}
              </div>

              {showMapLabels
                && effectiveMapRenderer !== 'apple-satellite'
                && !selectedLandmark
                && !streetViewLandmark && (
                <div className="explore-landmark-hint" role="status">
                  <Landmark size={16} />
                  <span><strong>Landmarks are interactive.</strong> Every landmark card includes Street View, its official website, and details—the ride keeps moving.</span>
                </div>
              )}

              <div className={exploreGridClass(groups.length)}>
                {(groups.length > 0 ? groups : [{
                  id: 'route-preview',
                  riders: [],
                  startMeter: 0,
                  endMeter: 0,
                }]).map((group) => (
                  <Suspense
                    fallback={<div className="explore-map-status">Loading comparison map…</div>}
                    key={`${effectiveMapRenderer}-${group.id}`}
                  >
                    {effectiveMapRenderer === 'google-3d' ? (
                      <ExploreGoogle3DMapPanel
                        group={group}
                        route={route}
                        distanceUnit={exploreDistanceUnit}
                        followZoom={followZoom}
                        cameraFollowPosition={cameraFollowPosition}
                        cameraFollowEnabled={cameraFollowEnabled}
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
                        onCameraInteraction={useFreeCamera}
                        onLandmarkSelect={selectLandmark}
                      />
                    ) : effectiveMapRenderer === 'apple-satellite' ? (
                      <ExploreAppleMapPanel
                        group={group}
                        route={route}
                        distanceUnit={exploreDistanceUnit}
                        followZoom={followZoom}
                        cameraFollowPosition={cameraFollowPosition}
                        cameraFollowEnabled={cameraFollowEnabled}
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
                        onCameraInteraction={useFreeCamera}
                        onLandmarkSelect={selectLandmark}
                      />
                    ) : (
                      <ExploreMapPanel
                        group={group}
                        route={route}
                        distanceUnit={exploreDistanceUnit}
                        followZoom={followZoom}
                        cameraFollowPosition={cameraFollowPosition}
                        cameraFollowEnabled={cameraFollowEnabled}
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
                        onCameraInteraction={useFreeCamera}
                        onLandmarkSelect={selectLandmark}
                      />
                    )}
                  </Suspense>
                ))}
              </div>

              {selectedLandmark && (
                <div className="explore-landmark-dialog-layer">
                  <section
                    className="explore-landmark-dialog"
                    role="dialog"
                    aria-label="Landmark information"
                    aria-modal="false"
                  >
                    <header>
                      <span><Landmark size={19} /> Google landmark</span>
                      <button type="button" aria-label="Close landmark information" onClick={closeLandmark}>
                        <X size={20} />
                      </button>
                    </header>
                    {selectedLandmark.status === 'loading' && (
                      <div className="explore-landmark-loading" aria-live="polite">
                        <span className="explore-landmark-spinner" aria-hidden="true" />
                        <strong>Loading place information…</strong>
                      </div>
                    )}
                    {selectedLandmark.status === 'error' && (
                      <div className="explore-landmark-error" role="alert">
                        <strong>Place details unavailable</strong>
                        <p>{selectedLandmark.error}</p>
                        <button type="button" onClick={() => selectLandmark(selectedLandmark.placeId)}>
                          Try again
                        </button>
                      </div>
                    )}
                    {selectedLandmark.status === 'ready' && selectedLandmark.details && (
                      <div className="explore-landmark-details">
                        <div className="explore-landmark-title">
                          <span>{selectedLandmark.details.category || 'Point of interest'}</span>
                          <h3>{selectedLandmark.details.name}</h3>
                          {selectedLandmark.details.address && <p>{selectedLandmark.details.address}</p>}
                        </div>
                        <div className="explore-landmark-facts">
                          {typeof selectedLandmark.details.rating === 'number' && (
                            <span>
                              <Star size={16} fill="currentColor" />
                              <strong>{selectedLandmark.details.rating.toFixed(1)}</strong>
                              {typeof selectedLandmark.details.userRatingCount === 'number'
                                ? ` (${selectedLandmark.details.userRatingCount.toLocaleString()} reviews)`
                                : ''}
                            </span>
                          )}
                          {typeof selectedLandmark.details.openNow === 'boolean' && (
                            <span className={selectedLandmark.details.openNow ? 'open' : 'closed'}>
                              {selectedLandmark.details.openNow ? 'Open now' : 'Closed now'}
                            </span>
                          )}
                          {selectedLandmark.details.phoneNumber && (
                            <span>{selectedLandmark.details.phoneNumber}</span>
                          )}
                        </div>
                        <div className="explore-landmark-actions">
                          <button
                            type="button"
                            onClick={() => openStreetView(selectedLandmark.details as GoogleLandmarkDetails)}
                          >
                            <MapPinned size={15} /> View Street View
                          </button>
                          {safeExternalHttpUrl(selectedLandmark.details.websiteUrl) && (
                            <a
                              href={safeExternalHttpUrl(selectedLandmark.details.websiteUrl)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Official website <ExternalLink size={15} />
                            </a>
                          )}
                          <a
                            href={safeExternalHttpUrl(selectedLandmark.details.googleMapsUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Google Maps <ExternalLink size={15} />
                          </a>
                        </div>
                        <small>Place details provided by Google. Your Explore the World ride continues while this card is open.</small>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {streetViewLandmark && (
                <ExploreStreetViewOverlay
                  landmark={streetViewLandmark}
                  onClose={closeStreetView}
                />
              )}

              <section className="explore-rider-strip" aria-label="Explore the World riders">
                {visibleRiders.length > 0 ? visibleRiders.map((rider) => {
                  const elevationMeters = elevationAvailable
                    ? exploreElevationAtMeter(route.elevationSamples, rider.distanceMeters)
                    : null;
                  const gradePercent = elevationAvailable
                    ? exploreGradeAtMeter(route.elevationSamples, rider.distanceMeters)
                    : 0;
                  const slopeDirection = exploreSlopeDirection(gradePercent);
                  const slopeLabel = slopeDirection === 'climb'
                    ? 'Climbing'
                    : slopeDirection === 'descent' ? 'Descending' : 'Level';
                  const recommendedAirSetting = elevationAvailable
                    ? recommendedExploreAirSetting(gradePercent)
                    : 1;
                  const airInstruction = elevationAvailable
                    ? recommendedAirSetting === 1
                      ? 'Set air lever to minimum'
                      : `Set air lever to ${recommendedAirSetting}`
                    : elevationRecoveryStatus === 'loading'
                      ? 'Calculating route grade'
                      : 'Set air lever to minimum';
                  const gradeStatus = elevationRecoveryStatus === 'loading'
                    ? 'Grade loading…'
                    : 'Grade unavailable · Retrying every 15s';
                  const heartRatePlayer = players.find((player) => player.id === rider.playerId);
                  const heartRateReading = demoHeartRateReadingForBikeSample(
                    heartRatePlayer?.deviceId == null
                      ? null
                      : samplesByDevice.get(heartRatePlayer.deviceId),
                  ) ?? heartRateByPlayer[rider.playerId];
                  const heartRate = heartRateReadingState(
                    heartRateReading?.bpm,
                    heartRateReading?.recordedAt,
                  );
                  const heartRateSimulated = heartRateReading?.source === 'demo-simulated';
                  return (
                    <article style={{ '--player-color': rider.accent } as CSSProperties} key={rider.id}>
                      {rider.photoUrl
                        ? <img src={rider.photoUrl} alt={`${rider.name} profile`} />
                        : <span className="explore-rider-initials">{profileInitials(rider.name)}</span>}
                      <div>
                        <strong>{rider.name}</strong>
                        <span>
                          {formatExploreDistanceMeters(rider.distanceMeters, exploreDistanceUnit)}
                          {' · '}
                          {formatSpeedFromKph(rider.velocityMps * 3.6, speedUnit)}
                          {' '}
                          {speedUnitLabel(speedUnit)}
                        </span>
                        <span>
                          Avg{' '}
                          {formatSpeedFromKph(
                            exploreAverageSpeedMph(rider.distanceMeters, ride.elapsedMs) * 1.609344,
                            speedUnit,
                          )}{' '}
                          {speedUnitLabel(speedUnit)}
                        </span>
                        <span
                          className={`explore-heart-rate ${heartRate.state}`}
                          aria-label={heartRate.bpm == null
                            ? `Heart rate: ${heartRate.detail}`
                            : `${heartRateSimulated ? 'Simulated heart rate' : 'Heart rate'} ${heartRate.bpm} beats per minute`}
                        >
                          <HeartPulse size={14} aria-hidden="true" />
                          {heartRate.bpm == null
                            ? heartRate.detail
                            : `${heartRateSimulated ? 'Simulated · ' : ''}${heartRate.bpm} BPM`}
                        </span>
                        <span
                          className="explore-air-status"
                          role="status"
                          aria-live="polite"
                          aria-label={`Recommended Wattbike air setting ${recommendedAirSetting}. ${airInstruction}.`}
                        >
                          <strong style={{ color: rider.accent, fontSize: 16 }}>
                            AIR {recommendedAirSetting}
                          </strong>
                          <span className="explore-air-instruction">
                            {' · '}
                            {airInstruction}
                          </span>
                        </span>
                        {elevationMeters != null ? (
                          <span
                            className="explore-elevation-status"
                            aria-label={`${slopeLabel}, grade ${formatExploreGrade(gradePercent)}`}
                          >
                            {formatExploreElevation(elevationMeters, exploreDistanceUnit)}
                            {' · '}
                            {formatExploreGrade(gradePercent)} {slopeLabel}
                          </span>
                        ) : (
                          <span className="explore-elevation-status" aria-label={gradeStatus}>{gradeStatus}</span>
                        )}
                      </div>
                      <b>{route.distanceMeters > 0 ? Math.round(rider.distanceMeters / route.distanceMeters * 100) : 0}%</b>
                    </article>
                  );
                }) : <p>Connect at least one Wattbike to begin.</p>}
              </section>

              {ride.status === 'finished' && (
                <section className="explore-completion-actions" aria-label="Completed route options">
                  <div>
                    <Flag size={20} />
                    <span>
                      <strong>Route complete</strong>
                      <small>Continue from {route.destinationLabel}.</small>
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      disabled={!canChooseRoute || routeStatus === 'loading'}
                      onClick={() => { void reverseCompletedRoute(); }}
                    >
                      <ArrowLeftRight size={17} />
                      {routeStatus === 'loading' ? 'Reversing…' : 'Reverse route'}
                    </button>
                    <button
                      type="button"
                      disabled={!canChooseRoute || routeStatus === 'loading'}
                      onClick={chooseNewDestination}
                    >
                      <MapPin size={17} /> New destination
                    </button>
                  </div>
                </section>
              )}

              <div className="explore-controls">
                {ride.status === 'riding' ? (
                  <button
                    className="explore-pause-ride"
                    type="button"
                    aria-label={playMode === 'multiplayer' ? 'Pause everyone' : 'Pause ride'}
                    onClick={pauseRide}
                    disabled={playMode === 'multiplayer' && !roomHost}
                  >
                    <Pause size={18} />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button
                    className="primary"
                    type="button"
                    onPointerDown={() => { void primeBikeRaceAudio(); }}
                    onClick={startOrResume}
                    disabled={
                      players.length === 0
                      || (playMode === 'multiplayer' && (!currentRoom || !roomHost))
                    }
                  >
                    <Play size={18} />
                    {ride.status === 'paused'
                      ? 'Resume ride'
                      : ride.status === 'finished'
                        ? 'Ride again'
                        : 'Start Explore the World ride'}
                  </button>
                )}
                <button
                  className="explore-reset-ride"
                  type="button"
                  onClick={resetRide}
                  disabled={playMode === 'multiplayer' && !roomHost}
                >
                  <RotateCcw size={18} /> Reset
                </button>
              </div>
            </>
          ) : (
            <div className="explore-empty-state">
              <MapPinned size={48} />
              <h3>{playMode === 'multiplayer' && currentRoom && !roomHost ? 'Waiting for the host' : 'Where should we ride?'}</h3>
              <p>
                {playMode === 'multiplayer' && currentRoom && !roomHost
                  ? 'The route will appear here for everyone in the private room.'
                  : 'Choose a real starting location and destination to create a satellite ride.'}
              </p>
            </div>
          )}
        </div>
      </div>
      {mapPickerOpen && (
        <ExploreRouteMapPicker
          initialOrigin={selectedOrigin?.point ?? route?.origin ?? null}
          initialOriginLabel={selectedOrigin?.label ?? route?.originLabel}
          initialDestination={selectedDestination?.point ?? route?.destination ?? null}
          initialDestinationLabel={selectedDestination?.label ?? route?.destinationLabel}
          onApply={applyMapPoints}
          onClose={() => setMapPickerOpen(false)}
        />
      )}
    </div>
  );
}
