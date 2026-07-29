import {
  Bike,
  Car,
  Flag,
  LocateFixed,
  MapPinned,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Share2,
  Users,
} from 'lucide-react';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { primeBikeRaceAudio, stopBikeRaceAudio, updateExploreBikeAudio } from '../lib/bikeRaceAudio';
import { groupExploreRiders, exploreGridClass, exploreRemoteStateFreshMs } from '../lib/explore';
import { fetchExploreRoute } from '../lib/exploreRoutes';
import { resolveLocationText } from '../lib/googleMaps';
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
}: ExploreViewProps) {
  const [localRoute, setLocalRoute] = useState<ExploreRoute | null>(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState<ExploreOrigin | null>(null);
  const [travelMode, setTravelMode] = useState<ExploreTravelMode>('bicycle');
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeMessage, setRouteMessage] = useState('');
  const appliedRoomSessionRef = useRef<string | null>(null);
  const scheduledStartTimerRef = useRef<number | null>(null);
  const latestRidersRef = useRef<ReturnType<typeof useExploreRide>['riders']>([]);
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
    if (scheduledStartTimerRef.current != null) {
      window.clearTimeout(scheduledStartTimerRef.current);
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
      return;
    }
    if (session.status === 'paused') {
      pauseLocalRide();
      return;
    }
    if (session.status === 'riding') {
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
    playMode,
    resetLocalRide,
    resumeLocalRide,
    route?.id,
    startLocalRide,
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
    setRouteStatus('loading');
    setRouteMessage('Finding your current location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setSelectedOrigin({ point, label: 'My current location' });
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
      const origin = selectedOrigin ?? await resolveLocationText(originText);
      const destination = await resolveLocationText(destinationText);
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
            <label>
              <span>Starting location</span>
              <input
                type="text"
                value={originText}
                placeholder="Address, landmark, city, or coordinates"
                disabled={!canChooseRoute}
                onChange={(event) => {
                  setOriginText(event.target.value);
                  setSelectedOrigin(null);
                }}
              />
            </label>
            <button type="button" onClick={useCurrentLocation} disabled={!canChooseRoute || routeStatus === 'loading'}>
              <LocateFixed size={15} /> Use my current location
            </button>
            <label>
              <span>Destination</span>
              <input
                type="text"
                value={destinationText}
                placeholder="Where do you want to ride?"
                disabled={!canChooseRoute}
                onChange={(event) => setDestinationText(event.target.value)}
              />
            </label>
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
                  <div><dt>View</dt><dd>Satellite</dd></div>
                  <div><dt>Maps</dt><dd>{groups.length || 1} screen{groups.length === 1 ? '' : 's'}</dd></div>
                </dl>
              </header>

              <div className={exploreGridClass(groups.length)}>
                {(groups.length > 0 ? groups : [{
                  id: 'route-preview',
                  riders: [],
                  startMeter: 0,
                  endMeter: 0,
                }]).map((group) => (
                  <ExploreMapPanel group={group} route={route} distanceUnit={distanceUnit} key={group.id} />
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
                    disabled={players.length === 0 || (playMode === 'multiplayer' && (!currentRoom || !roomHost))}
                  >
                    <Play size={18} />
                    {ride.status === 'paused' ? 'Resume ride' : ride.status === 'finished' ? 'Ride again' : 'Start Explore ride'}
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
