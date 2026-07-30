import {
  Bike,
  Car,
  Compass,
  Flag,
  Landmark,
  LocateFixed,
  MapPinned,
  Minimize2,
  Navigation2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { primeBikeRaceAudio, stopBikeRaceAudio, updateExploreBikeAudio } from '../lib/bikeRaceAudio';
import {
  groupExploreRiders,
  exploreGridClass,
  exploreRemoteStateFreshMs,
  type ExploreCameraFollowPosition,
} from '../lib/explore';
import { fetchExploreRoute } from '../lib/exploreRoutes';
import {
  fetchLocationPredictions,
  resetPlaceAutocompleteSession,
  resolveLocationText,
  resolvePlacePrediction,
  type PlacePredictionOption,
} from '../lib/googleMaps';
import { useExploreRide } from '../hooks/useExploreRide';
import { formatDistanceMeters, formatSpeedFromKph } from '../units';
import type {
  BikeSample,
  DistanceUnit,
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

type ExploreViewProps = {
  players: PlayerSlot[];
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
  onDemoRideStatusChange?: (status: 'ready' | 'riding' | 'paused' | 'finished') => void;
  fullscreen: boolean;
  onFullscreenChange: (enabled: boolean) => void;
};

type ExploreOrigin = {
  point: TrackPoint;
  label: string;
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
  const [followZoom, setFollowZoom] = useState(18);
  const [cameraFollowPosition, setCameraFollowPosition] = useState<ExploreCameraFollowPosition>('center');
  const [showMapLabels, setShowMapLabels] = useState(false);
  const [followTravelHeading, setFollowTravelHeading] = useState(false);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const appliedRoomSessionRef = useRef<string | null>(null);
  const scheduledStartTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    updateExploreBikeAudio(ride.status, ride.riders);
  }, [ride.riders, ride.status]);

  useEffect(() => {
    if (demoMode) {
      onDemoRideStatusChange?.(ride.status);
    }
  }, [demoMode, onDemoRideStatusChange, ride.status]);

  useEffect(() => () => {
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
        originLabel: selectedOrigin?.label || origin.label || originText.trim(),
        destinationLabel: destination.label || destinationText.trim(),
        travelMode,
      });
      setLocalRoute(nextRoute);
      if (playMode === 'multiplayer') {
        onSyncRoute(nextRoute);
      }
      setRouteStatus('idle');
      setRouteMessage('');
    } catch (error) {
      setRouteStatus('error');
      setRouteMessage(error instanceof Error ? error.message : 'The route could not be created.');
    }
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
          <span>AI commentary is off. Pedaling and freewheel sounds remain on.</span>
        </div>
      )}

      <div className="explore-layout">
        <aside className="explore-setup-card">
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
                onClick={() => setTravelMode('bicycle')}
              >
                <Bike size={16} /> Bicycle
              </button>
              <button
                className={travelMode === 'drive' ? 'selected' : ''}
                type="button"
                disabled={!canChooseRoute}
                onClick={() => setTravelMode('drive')}
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
                  <div><dt>Route</dt><dd>{formatDistanceMeters(route.distanceMeters, distanceUnit)}</dd></div>
                  <div><dt>Google estimate</dt><dd>{formatDuration(route.durationSeconds)}</dd></div>
                  <div>
                    <dt>View</dt>
                    <dd>{showMapLabels ? 'Labeled satellite' : 'Satellite'}</dd>
                  </div>
                  <div><dt>Maps</dt><dd>{groups.length || 1} screen{groups.length === 1 ? '' : 's'}</dd></div>
                </dl>
              </header>

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
                <button
                  className={`explore-map-labels-toggle explore-direction-toggle${followTravelHeading ? ' active' : ''}`}
                  type="button"
                  aria-label={followTravelHeading ? 'Keep map north up' : 'Follow direction of travel'}
                  aria-pressed={followTravelHeading}
                  title={followTravelHeading
                    ? 'Return the map to north-up'
                    : 'Rotate the map so the direction of travel stays at the top'}
                  onClick={() => setFollowTravelHeading((enabled) => !enabled)}
                >
                  <Compass size={18} />
                  <span>{followTravelHeading ? 'Direction up' : 'North up'}</span>
                </button>
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
                    distanceUnit={distanceUnit}
                    followZoom={followZoom}
                    cameraFollowPosition={cameraFollowPosition}
                    showMapLabels={showMapLabels}
                    followTravelHeading={followTravelHeading}
                    key={group.id}
                  />
                ))}
              </div>

              <section className="explore-rider-strip" aria-label="Explore riders">
                {visibleRiders.length > 0 ? visibleRiders.map((rider) => (
                  <article style={{ '--player-color': rider.accent } as CSSProperties} key={rider.id}>
                    {rider.photoUrl
                      ? <img src={rider.photoUrl} alt={`${rider.name} profile`} />
                      : <span className="explore-rider-initials">{profileInitials(rider.name)}</span>}
                    <div>
                      <strong>{rider.name}</strong>
                      <span>
                        {formatDistanceMeters(rider.distanceMeters, distanceUnit)}
                        {' · '}
                        {formatSpeedFromKph(rider.velocityMps * 3.6, speedUnit)}
                      </span>
                    </div>
                    <b>{route.distanceMeters > 0 ? Math.round(rider.distanceMeters / route.distanceMeters * 100) : 0}%</b>
                  </article>
                )) : <p>Connect at least one Wattbike to begin.</p>}
              </section>

              <div className="explore-controls">
                {ride.status === 'riding' ? (
                  <button type="button" onClick={pauseRide} disabled={playMode === 'multiplayer' && !roomHost}>
                    <Pause size={18} /> Pause everyone
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
                <button type="button" onClick={resetRide} disabled={playMode === 'multiplayer' && !roomHost}>
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
    </div>
  );
}
