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
import { fetchExploreRoute } from '../lib/exploreRoutes';
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
  TrackPoint,
} from '../types';
import { ExploreMapPanel } from './ExploreMapPanel';
import { ExploreStreetViewOverlay } from './ExploreStreetViewOverlay';

type ExploreViewProps = {
  players: PlayerSlot[];
  demoPlayerOptions: PlayerSlot[];
  selectedDemoPlayerIds: PlayerSlot['id'][];
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
  onPlayModeChange: (mode: PlayMode) => void;
  onCreatePrivateRoom: () => boolean;
  onShareInvite: () => void;
  onSyncRoute: (route: ExploreRoute) => boolean;
  onControlSession: (action: 'start' | 'pause' | 'resume' | 'reset') => boolean;
  onSendState: (state: Omit<MultiplayerExploreState, 'clientId' | 'roomId' | 'at'>) => boolean;
  onDemoPlayerSelectionChange: (playerIds: PlayerSlot['id'][]) => void;
  onDemoRideStatusChange?: (status: 'ready' | 'riding' | 'paused' | 'finished') => void;
  fullscreen: boolean;
  onFullscreenChange: (enabled: boolean) => void;
};

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
  players,
  demoPlayerOptions,
  selectedDemoPlayerIds,
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
  onPlayModeChange,
  onCreatePrivateRoom,
  onShareInvite,
  onSyncRoute,
  onControlSession,
  onSendState,
  onDemoPlayerSelectionChange,
  onDemoRideStatusChange,
  fullscreen,
  onFullscreenChange,
}: ExploreViewProps) {
  const [localRoute, setLocalRoute] = useState<ExploreRoute | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState<ExploreOrigin | null>(null);
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
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const [selectedLandmark, setSelectedLandmark] = useState<ExploreLandmarkPopup | null>(null);
  const [streetViewLandmark, setStreetViewLandmark] = useState<GoogleLandmarkDetails | null>(null);
  const appliedRoomSessionRef = useRef<string | null>(null);
  const landmarkRequestRef = useRef(0);
  const routeRequestRef = useRef(0);
  const scheduledStartTimerRef = useRef<number | null>(null);
  const destinationInputRef = useRef<HTMLInputElement | null>(null);
  const latestRidersRef = useRef<ReturnType<typeof useExploreRide>['riders']>([]);
  const previousRideStatusRef = useRef<ReturnType<typeof useExploreRide>['status']>('ready');
  const route = playMode === 'multiplayer'
    ? currentRoom?.exploreRoute ?? null
    : localRoute;
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
  const originSuggestions = useLocationSuggestions(
    originText,
    selectedOriginPrediction,
    canChooseRoute && !selectedOrigin,
  );
  const destinationSuggestions = useLocationSuggestions(
    destinationText,
    selectedDestinationPrediction,
    canChooseRoute,
  );

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

  const applyExploreRoute = (nextRoute: ExploreRoute) => {
    setLocalRoute(nextRoute);
    if (playMode === 'multiplayer') {
      onSyncRoute(nextRoute);
    }
    setRouteStatus('idle');
    setRouteMessage('');
  };

  const markRouteInputsChanged = () => {
    routeRequestRef.current += 1;
    if (routeStatus === 'loading' || route) {
      setRouteStatus('idle');
      setRouteMessage('Location changed. Select Build Explore route to update the map.');
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
      const destination = selectedDestinationPrediction
        ? await resolvePlacePrediction(selectedDestinationPrediction)
        : await resolveLocationText(destinationText);
      const nextRoute = await fetchExploreRoute({
        origin: origin.point,
        destination: destination.point,
        originLabel: selectedOrigin?.label
          || selectedOriginPrediction?.label
          || origin.label
          || originText.trim(),
        destinationLabel: selectedDestinationPrediction?.label
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
          <h2>Explore</h2>
          <p>Choose two real places, then pedal the Google route in satellite view.</p>
        </div>
        <div className="explore-mode-switch" aria-label="Explore session type">
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
          <span>44/16 rollout · natural launch · 12–18 MPH averages. Commentary is off; bike sounds remain on.</span>
        </div>
      )}

      <div className="explore-layout">
        <aside className="explore-setup-card">
          {demoMode && (
            <section className="explore-demo-rider-picker">
              <div>
                <span className="eyebrow">Explore demo riders</span>
                <small>Choose the exact riders for this route.</small>
              </div>
              <div role="group" aria-label="Choose Explore demo riders">
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

          <section className="explore-route-builder">
            <span className="eyebrow">Route</span>
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
              {routeStatus === 'loading' ? 'Building route…' : 'Build Explore route'}
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
                    <dt>View</dt>
                    <dd>{showMapLabels ? 'Labeled satellite' : 'Satellite'}</dd>
                  </div>
                  <div><dt>Maps</dt><dd>{groups.length || 1} screen{groups.length === 1 ? '' : 's'}</dd></div>
                </dl>
              </header>

              <div
                className="explore-destination-overlay"
                aria-label={`Destination: ${route.destinationLabel}`}
              >
                <Flag size={17} />
                <small>Riding to</small>
                <strong>{route.destinationLabel}</strong>
              </div>

              <div className="explore-camera-toolbar" aria-label="Explore camera controls">
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
              </div>

              {showMapLabels && !selectedLandmark && !streetViewLandmark && (
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
                  <ExploreMapPanel
                    group={group}
                    route={route}
                    distanceUnit={exploreDistanceUnit}
                    followZoom={followZoom}
                    cameraFollowPosition={cameraFollowPosition}
                    showMapLabels={showMapLabels}
                    followTravelHeading={followTravelHeading}
                    onLandmarkSelect={selectLandmark}
                    key={group.id}
                  />
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
                        <small>Place details provided by Google. Your Explore ride continues while this card is open.</small>
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

              <section className="explore-rider-strip" aria-label="Explore riders">
                {visibleRiders.length > 0 ? visibleRiders.map((rider) => (
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
                    </div>
                    <b>{route.distanceMeters > 0 ? Math.round(rider.distanceMeters / route.distanceMeters * 100) : 0}%</b>
                  </article>
                )) : <p>Connect at least one Wattbike to begin.</p>}
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
                        : 'Start Explore ride'}
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
    </div>
  );
}
