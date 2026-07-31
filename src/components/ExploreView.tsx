import {
  ArrowLeftRight,
  Bike,
  Car,
  Compass,
  ExternalLink,
  Flag,
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
  Star,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
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
  groupExploreRiders,
  exploreGridClass,
  exploreRemoteStateFreshMs,
  type ExploreCameraFollowPosition,
} from '../lib/explore';
import {
  fetchExploreElevationProfile,
  fetchExploreRoute,
  type ExploreElevationProfile,
} from '../lib/exploreRoutes';
import {
  loadRecentExploreRoutes,
  rememberRecentExploreRoute,
} from '../lib/exploreRecentRoutes';
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
  ExploreRoute,
  ExploreTravelMode,
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
  playMode: PlayMode;
  demoMode: boolean;
  multiplayerConnection: string;
  currentRoom: MultiplayerRoom | null;
  currentUserId: string | null;
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
  fullscreen: boolean;
  onFullscreenChange: (enabled: boolean) => void;
};

type ExploreMapRenderer = 'google-satellite' | 'google-3d' | 'apple-satellite';

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

function mapPointLabel(prefix: string, point: TrackPoint) {
  return `${prefix} · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
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
  playMode,
  demoMode,
  multiplayerConnection,
  currentRoom,
  currentUserId,
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
  fullscreen,
  onFullscreenChange,
}: ExploreViewProps) {
  const recentProfileKey = currentUserId ?? 'local';
  const [localRoute, setLocalRoute] = useState<ExploreRoute | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState<ExploreOrigin | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<ExploreOrigin | null>(null);
  const [selectedOriginPrediction, setSelectedOriginPrediction] = useState<PlacePredictionOption | null>(null);
  const [selectedDestinationPrediction, setSelectedDestinationPrediction] = useState<PlacePredictionOption | null>(null);
  const [travelMode, setTravelMode] = useState<ExploreTravelMode>('bicycle');
  const [exploreDistanceUnit, setExploreDistanceUnit] = useState<ExploreDistanceUnit>(
    distanceUnit === 'm' ? 'km' : 'mi',
  );
  const [followZoom, setFollowZoom] = useState(18);
  const [cameraFollowPosition, setCameraFollowPosition] = useState<ExploreCameraFollowPosition>('center');
  const [showMapLabels, setShowMapLabels] = useState(false);
  const [followTravelHeading, setFollowTravelHeading] = useState(false);
  const [mapRenderer, setMapRenderer] = useState<ExploreMapRenderer>(savedExploreMapRenderer);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [recentRoutes, setRecentRoutes] = useState<ExploreRoute[]>(() => (
    loadRecentExploreRoutes(recentProfileKey)
  ));
  const [elevationRecoveryStatus, setElevationRecoveryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [recoveredElevation, setRecoveredElevation] = useState<RecoveredExploreElevation | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<ExploreLandmarkPopup | null>(null);
  const [streetViewLandmark, setStreetViewLandmark] = useState<GoogleLandmarkDetails | null>(null);
  const appliedRoomSessionRef = useRef<string | null>(null);
  const landmarkRequestRef = useRef(0);
  const routeRequestRef = useRef(0);
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
  });
  const {
    pause: pauseLocalRide,
    reset: resetLocalRide,
    resume: resumeLocalRide,
    start: startLocalRide,
  } = ride;
  latestRidersRef.current = ride.riders;

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

  useEffect(() => {
    setRecentRoutes(loadRecentExploreRoutes(recentProfileKey));
  }, [recentProfileKey]);

  const closeLandmark = useCallback(() => {
    landmarkRequestRef.current += 1;
    setSelectedLandmark(null);
  }, []);

  const closeStreetView = useCallback(() => {
    setStreetViewLandmark(null);
  }, []);

  const openStreetView = useCallback((landmark: GoogleLandmarkDetails) => {
    closeLandmark();
    setStreetViewLandmark(landmark);
  }, [closeLandmark]);

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

    const controller = new AbortController();
    setRecoveredElevation(null);
    setElevationRecoveryStatus('loading');
    void fetchExploreElevationProfile(sourceRoute, controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) {
          return;
        }
        const recovered = { ...profile, routeId: sourceRoute.id };
        const enrichedRoute = { ...sourceRoute, ...profile };
        setRecoveredElevation(recovered);
        setElevationRecoveryStatus('ready');
        if (playMode === 'local') {
          setLocalRoute(enrichedRoute);
          setRecentRoutes(rememberRecentExploreRoute(recentProfileKey, enrichedRoute));
        } else if (roomHost) {
          onSyncRoute(enrichedRoute);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        setElevationRecoveryStatus('error');
      });

    return () => controller.abort();
  }, [
    onSyncRoute,
    playMode,
    recentProfileKey,
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
    if (demoMode) {
      onDemoRideStatusChange?.(ride.status);
    }
  }, [demoMode, onDemoRideStatusChange, ride.status]);

  useEffect(() => () => {
    routeRequestRef.current += 1;
    stopBikeRaceAudio();
    onFullscreenChange(false);
    if (scheduledStartTimerRef.current != null) {
      window.clearTimeout(scheduledStartTimerRef.current);
    }
  }, [onFullscreenChange]);

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
      && fullscreen
    ) {
      onFullscreenChange(false);
    }
    previousRideStatusRef.current = ride.status;
  }, [fullscreen, onFullscreenChange, ride.status]);

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
    setLocalRoute(nextRoute);
    if (playMode === 'multiplayer') {
      onSyncRoute(nextRoute);
    }
    setRecentRoutes(rememberRecentExploreRoute(recentProfileKey, nextRoute));
    setRouteStatus('idle');
    setRouteMessage(message);
  };

  const applyMapPoints = (origin: TrackPoint, destination: TrackPoint) => {
    const nextOrigin = {
      point: origin,
      label: mapPointLabel('Map start', origin),
    };
    const nextDestination = {
      point: destination,
      label: mapPointLabel('Map destination', destination),
    };
    routeRequestRef.current += 1;
    setSelectedOrigin(nextOrigin);
    setSelectedOriginPrediction(null);
    setOriginText(nextOrigin.label);
    setSelectedDestination(nextDestination);
    setSelectedDestinationPrediction(null);
    setDestinationText(nextDestination.label);
    setRouteStatus('idle');
    setRouteMessage('Map points selected. Choose Bicycle or Car route, then build your ride.');
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
    setTravelMode(recentRoute.travelMode);
    resetPlaceAutocompleteSession();
    resetLocalRide();
    applyExploreRoute(
      recentRoute,
      `Recent route loaded: ${recentRoute.originLabel} to ${recentRoute.destinationLabel}.`,
    );
  };

  const markRouteInputsChanged = () => {
    routeRequestRef.current += 1;
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
        travelMode,
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
        travelMode: route.travelMode,
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
      setTravelMode(route.travelMode);
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
    setTravelMode(route.travelMode);
    setRouteStatus('idle');
    setRouteMessage(`Starting from ${route.destinationLabel}. Choose your next destination.`);
    resetPlaceAutocompleteSession();
    window.setTimeout(() => destinationInputRef.current?.focus(), 0);
  };

  const startOrResume = () => {
    void primeBikeRaceAudio();
    onFullscreenChange(true);
    if (playMode === 'multiplayer') {
      if (!roomHost) {
        return;
      }
      onControlSession(ride.status === 'paused' ? 'resume' : 'start');
      return;
    }
    if (ride.status === 'paused') {
      resumeLocalRide();
    } else {
      startLocalRide();
    }
  };

  const pauseRide = () => {
    if (playMode === 'multiplayer') {
      if (roomHost) {
        onControlSession('pause');
      }
    } else {
      pauseLocalRide();
    }
  };

  const resetRide = () => {
    onFullscreenChange(false);
    if (playMode === 'multiplayer') {
      if (roomHost) {
        onControlSession('reset');
      }
    } else {
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
          <span>54/17 road rollout · 6.9 m (22.6 ft) per crank · natural launch · 12–18 MPH averages. Commentary is off; bike sounds remain on.</span>
        </div>
      )}

      <div className="explore-layout">
        <aside className="explore-setup-card">
          {demoMode && (
            <section className="explore-demo-rider-picker">
              <div>
                <span className="eyebrow">Explore the World demo riders</span>
                <small>Choose the exact riders for this route.</small>
              </div>
              <div role="group" aria-label="Choose Explore the World demo riders">
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
                    {recentRoute.originLabel} → {recentRoute.destinationLabel}
                  </option>
                ))}
              </select>
            </label>
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
            <div className="explore-travel-mode" aria-label="Google route type">
              <button
                className={travelMode === 'bicycle' ? 'selected' : ''}
                type="button"
                disabled={!canChooseRoute}
                onClick={() => {
                  if (travelMode !== 'bicycle') {
                    markRouteInputsChanged();
                    setTravelMode('bicycle');
                  }
                }}
              >
                <Bike size={16} /> Bicycle
              </button>
              <button
                className={travelMode === 'drive' ? 'selected' : ''}
                type="button"
                disabled={!canChooseRoute}
                onClick={() => {
                  if (travelMode !== 'drive') {
                    markRouteInputsChanged();
                    setTravelMode('drive');
                  }
                }}
              >
                <Car size={16} /> Car route
              </button>
            </div>
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
            <small className="explore-route-warning">
              Bicycle directions can contain roads or paths without clear cycling facilities. This is an indoor virtual ride—not outdoor navigation.
            </small>
          </section>
        </aside>

        <div className="explore-stage">
          {route ? (
            <>
              <header className="explore-route-summary">
                <div>
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
                {fullscreen && (ride.status === 'riding' ? (
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
                ))}
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
                  onClick={() => setFollowZoom((zoom) => Math.max(12, zoom - 1))}
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
                    onChange={(event) => setFollowZoom(Number(event.target.value))}
                  />
                  <small>{followZoom <= 14 ? 'More route' : followZoom >= 19 ? 'Closer' : 'Balanced'}</small>
                </label>
                <button
                  type="button"
                  aria-label="Move closer to the riders"
                  title="Move closer to the riders"
                  disabled={followZoom >= 20}
                  onClick={() => setFollowZoom((zoom) => Math.min(20, zoom + 1))}
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
                  onClick={() => setCameraFollowPosition((position) => (
                    nextExploreCameraFollowPosition(position)
                  ))}
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
                <div className="explore-toolbar-toggle" role="group" aria-label="Map orientation">
                  <button
                    className={!followTravelHeading ? 'active' : ''}
                    type="button"
                    aria-label="North up"
                    aria-pressed={!followTravelHeading}
                    title="Keep north at the top of the map"
                    onClick={() => setFollowTravelHeading(false)}
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
                    onClick={() => setFollowTravelHeading(true)}
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
                    onClick={() => setExploreDistanceUnit('mi')}
                  >
                    <span className="distance-long">Miles</span>
                    <span className="distance-short">mi</span>
                  </button>
                  <button
                    className={exploreDistanceUnit === 'km' ? 'active' : ''}
                    type="button"
                    aria-label="Show distances in kilometers"
                    aria-pressed={exploreDistanceUnit === 'km'}
                    onClick={() => setExploreDistanceUnit('km')}
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
                  onClick={() => setShowMapLabels((visible) => !visible)}
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
                  <button
                    className="explore-exit-fullscreen"
                    type="button"
                    aria-label="Exit full screen"
                    onClick={() => onFullscreenChange(false)}
                  >
                    <Minimize2 size={18} />
                    <span>Exit full screen</span>
                  </button>
                )}
              </div>

              {showMapLabels
                && effectiveMapRenderer === 'google-satellite'
                && !selectedLandmark
                && !streetViewLandmark && (
                <div className="explore-landmark-hint" role="status">
                  <Landmark size={16} />
                  <span><strong>Landmarks are interactive.</strong> Tap an icon for details—the ride keeps moving.</span>
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
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
                        onLandmarkSelect={selectLandmark}
                      />
                    ) : effectiveMapRenderer === 'apple-satellite' ? (
                      <ExploreAppleMapPanel
                        group={group}
                        route={route}
                        distanceUnit={exploreDistanceUnit}
                        followZoom={followZoom}
                        cameraFollowPosition={cameraFollowPosition}
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
                        onLandmarkSelect={selectLandmark}
                      />
                    ) : (
                      <ExploreMapPanel
                        group={group}
                        route={route}
                        distanceUnit={exploreDistanceUnit}
                        followZoom={followZoom}
                        cameraFollowPosition={cameraFollowPosition}
                        showMapLabels={showMapLabels}
                        followTravelHeading={followTravelHeading}
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
                          {selectedLandmark.details.point && (
                            <button
                              type="button"
                              onClick={() => openStreetView(selectedLandmark.details as GoogleLandmarkDetails)}
                            >
                              <MapPinned size={15} /> View Street View
                            </button>
                          )}
                          {safeExternalHttpUrl(selectedLandmark.details.websiteUrl) && (
                            <a
                              href={safeExternalHttpUrl(selectedLandmark.details.websiteUrl)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Visit website <ExternalLink size={15} />
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
                    : 'Grade unavailable · Level-ground physics';
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
                        <span>Avg {exploreAverageSpeedMph(rider.distanceMeters, ride.elapsedMs).toFixed(1)} MPH</span>
                        <span
                          role="status"
                          aria-live="polite"
                          aria-label={`Recommended Wattbike air setting ${recommendedAirSetting}. ${airInstruction}.`}
                        >
                          <strong style={{ color: rider.accent, fontSize: 16 }}>
                            AIR {recommendedAirSetting}
                          </strong>
                          {' · '}
                          {airInstruction}
                        </span>
                        {elevationMeters != null ? (
                          <span aria-label={`${slopeLabel}, grade ${formatExploreGrade(gradePercent)}`}>
                            {formatExploreElevation(elevationMeters, exploreDistanceUnit)}
                            {' · '}
                            {formatExploreGrade(gradePercent)} {slopeLabel}
                          </span>
                        ) : (
                          <span aria-label={gradeStatus}>{gradeStatus}</span>
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
          initialDestination={selectedDestination?.point ?? route?.destination ?? null}
          onApply={applyMapPoints}
          onClose={() => setMapPickerOpen(false)}
        />
      )}
    </div>
  );
}
