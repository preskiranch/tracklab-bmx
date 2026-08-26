import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Box,
  CheckCircle2,
  Compass,
  Gamepad2,
  LoaderCircle,
  Play,
  RadioTower,
  Route,
  Satellite,
  Tablet,
  Users,
  X,
} from 'lucide-react';
import {
  cancelCurrentClubEvent,
  clubEventActivityTitle,
  clubEventLaunchAcknowledged,
  createClubEvent,
  loadCurrentClubEventForOwner,
  startCurrentClubEvent,
  type ClubEventActivityType,
  type ClubEventRaceView,
  type ClubEventRaceViewCamera,
  type ClubEventRaceViewMode,
  type ClubEventSnapshot,
} from '../lib/clubEvent';
import { prepareClubEventExploreConfiguration } from '../lib/clubEventExplore';
import { supportsDragStripGameArena } from '../lib/dragStripGameArena';
import { fetchExploreRoute } from '../lib/exploreRoutes';
import { resolveLocationText } from '../lib/googleMaps';
import { straightSprintDistanceOptions } from '../lib/straightSprint';
import type { TrackRecord } from '../types';
import './ClubEventConsole.css';

export type ClubEventCourseOption = Readonly<{
  id: string;
  name: string;
  track: TrackRecord;
  /** Saved owner view for this course. App supplies the current mapped mode and base camera. */
  raceView?: ClubEventRaceView;
  /** Straight Sprint cameras are saved separately for each selected distance. */
  sprintRaceViewCamerasByDistance?: Readonly<Partial<Record<number, ClubEventRaceViewCamera>>>;
}>;

type ClubEventConsoleProps = Readonly<{
  raceTracks: readonly ClubEventCourseOption[];
  sprintRoutes: readonly ClubEventCourseOption[];
  raceViewsReady?: boolean;
}>;

function displayAthlete(event: ClubEventSnapshot, deviceId: string | null) {
  const slot = event.slots.find((candidate) => candidate.deviceId === deviceId);
  return slot?.athlete?.athleteName || slot?.athlete?.riderName || null;
}

export function clubEventRaceViewForCourse(
  course: ClubEventCourseOption,
  mode: ClubEventRaceViewMode,
  sprintDistanceFeet?: number,
): ClubEventRaceView {
  const safeMode = mode === 'game' && !supportsDragStripGameArena(course.track)
    ? 'satellite'
    : mode;
  if (safeMode === 'game') return { mode: safeMode };
  const distanceCamera = sprintDistanceFeet == null
    ? undefined
    : course.sprintRaceViewCamerasByDistance?.[sprintDistanceFeet];
  const camera = distanceCamera ?? course.raceView?.camera;
  return { mode: safeMode, ...(camera ? { camera } : {}) };
}

export function clubEventLobbyNeedsRaceViews(
  activityType: ClubEventActivityType,
  raceViewsReady: boolean,
) {
  return activityType !== 'explore' && !raceViewsReady;
}

function raceViewLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const mode = (value as { mode?: unknown }).mode;
  return mode === 'game' ? 'Game Arena' : mode === '3d' ? '3D Terrain' : mode === 'satellite' ? 'Satellite' : '';
}

function eventConfigurationSummary(event: ClubEventSnapshot) {
  const configuration = event.configuration;
  if (event.activityType === 'bmx-race') {
    const track = typeof configuration.trackName === 'string' ? configuration.trackName : 'Selected BMX track';
    const laps = Math.max(1, Math.round(Number(configuration.lapCount ?? configuration.laps) || 1));
    const view = raceViewLabel(configuration.raceView);
    return `${track} · ${laps} lap${laps === 1 ? '' : 's'}${view ? ` · ${view}` : ''}`;
  }
  if (event.activityType === 'straight-sprint') {
    const distance = Math.max(30, Math.round(Number(configuration.distanceFeet) || 100));
    const air = Math.max(1, Math.min(10, Math.round(Number(configuration.airSetting) || 1)));
    const route = typeof configuration.trackName === 'string' ? ` · ${configuration.trackName}` : '';
    const view = raceViewLabel(configuration.raceView);
    return `${distance} ft · Wattbike Air ${air}${route}${view ? ` · ${view}` : ''}`;
  }
  const origin = typeof configuration.origin === 'string' ? configuration.origin : '';
  const destination = typeof configuration.destination === 'string' ? configuration.destination : '';
  return origin && destination ? `${origin} → ${destination}` : 'Shared Explore ride';
}

export function ClubEventConsole({
  raceTracks,
  sprintRoutes,
  raceViewsReady = true,
}: ClubEventConsoleProps) {
  const requestGenerationRef = useRef(0);
  const [mode, setMode] = useState<'independent' | 'coach'>('independent');
  const [event, setEvent] = useState<ClubEventSnapshot | null>(null);
  const [activityType, setActivityType] = useState<ClubEventActivityType>('bmx-race');
  const [raceTrackId, setRaceTrackId] = useState(raceTracks[0]?.id ?? '');
  const [lapCount, setLapCount] = useState(1);
  const [sprintRouteId, setSprintRouteId] = useState(sprintRoutes[0]?.id ?? '');
  const [sprintDistanceFeet, setSprintDistanceFeet] = useState(100);
  const [airSetting, setAirSetting] = useState(1);
  const [raceViewMode, setRaceViewMode] = useState<ClubEventRaceViewMode>('satellite');
  const [exploreOrigin, setExploreOrigin] = useState('Preski Ranch');
  const [exploreDestination, setExploreDestination] = useState('');
  const [exploreName, setExploreName] = useState('Club Explore ride');
  const [busy, setBusy] = useState<'idle' | 'creating' | 'starting' | 'cancelling'>('idle');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!raceTrackId && raceTracks[0]) setRaceTrackId(raceTracks[0].id);
  }, [raceTrackId, raceTracks]);

  useEffect(() => {
    if (!sprintRouteId && sprintRoutes[0]) setSprintRouteId(sprintRoutes[0].id);
  }, [sprintRouteId, sprintRoutes]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestGenerationRef.current;
    try {
      const envelope = await loadCurrentClubEventForOwner(signal);
      if (generation !== requestGenerationRef.current) return envelope.pollAfterMs;
      setEvent(envelope.event);
      if (envelope.event) setMode('coach');
      setMessage('');
      return envelope.pollAfterMs;
    } catch (error) {
      if (signal?.aborted || generation !== requestGenerationRef.current) return 2_000;
      setMessage(error instanceof Error ? error.message : 'The Club Event status could not be loaded.');
      return 2_000;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;
    let disposed = false;
    const poll = async () => {
      const delay = await refresh(controller.signal);
      if (!disposed) timer = window.setTimeout(poll, delay);
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      requestGenerationRef.current += 1;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const readyCount = event?.slots.filter((slot) => slot.ready && slot.athlete).length ?? 0;
  const synchronizedDeviceIds = useMemo(() => new Set(
    event?.slots
      .filter((slot) => clubEventLaunchAcknowledged(event, slot))
      .flatMap((slot) => slot.deviceId ? [slot.deviceId] : []) ?? [],
  ), [event]);
  const countdownSeconds = event?.status === 'active' && event.startAt
    ? Math.max(0, Math.ceil((event.startAt - now) / 1_000))
    : null;
  const selectedRaceTrack = useMemo(
    () => raceTracks.find((track) => track.id === raceTrackId) ?? null,
    [raceTrackId, raceTracks],
  );
  const selectedSprintRoute = useMemo(
    () => sprintRoutes.find((route) => route.id === sprintRouteId) ?? null,
    [sprintRouteId, sprintRoutes],
  );
  const selectedCourse = activityType === 'bmx-race' ? selectedRaceTrack : selectedSprintRoute;
  const gameArenaAvailable = activityType === 'straight-sprint'
    && Boolean(selectedSprintRoute && supportsDragStripGameArena(selectedSprintRoute.track));

  useEffect(() => {
    if (activityType === 'explore') return;
    const savedMode = selectedCourse?.raceView?.mode;
    setRaceViewMode(savedMode === '3d'
      ? '3d'
      : savedMode === 'game' && gameArenaAvailable ? 'game' : 'satellite');
  }, [
    activityType,
    gameArenaAvailable,
    raceTrackId,
    selectedCourse?.raceView?.mode,
    sprintRouteId,
  ]);

  const create = async () => {
    let configuration: Record<string, unknown> | null = null;
    if (clubEventLobbyNeedsRaceViews(activityType, raceViewsReady)) {
      setMessage('Loading saved track views. Wait a moment, then open the lobby.');
      return;
    }
    if (activityType === 'bmx-race') {
      if (!selectedRaceTrack) {
        setMessage('Choose a mapped BMX track before opening the lobby.');
        return;
      }
      configuration = {
        trackId: selectedRaceTrack.id,
        trackName: selectedRaceTrack.name,
        trackRecord: selectedRaceTrack.track,
        lapCount,
        raceView: clubEventRaceViewForCourse(selectedRaceTrack, raceViewMode),
      };
    } else if (activityType === 'straight-sprint') {
      if (!selectedSprintRoute) {
        setMessage('Create or select a saved Straight Sprint route before opening the lobby.');
        return;
      }
      configuration = {
        trackId: selectedSprintRoute.id,
        trackName: selectedSprintRoute.name,
        trackRecord: selectedSprintRoute.track,
        distanceFeet: sprintDistanceFeet,
        airSetting,
        raceView: clubEventRaceViewForCourse(selectedSprintRoute, raceViewMode, sprintDistanceFeet),
      };
    } else {
      if (!exploreOrigin.trim() || !exploreDestination.trim()) {
        setMessage('Enter the shared start and destination before opening the Explore lobby.');
        return;
      }
    }

    setBusy('creating');
    setMessage(activityType === 'explore'
      ? 'Resolving both locations and building the shared bicycle route…'
      : 'Opening the four-tablet lobby…');
    try {
      if (activityType === 'explore') {
        configuration = await prepareClubEventExploreConfiguration({
          origin: exploreOrigin,
          destination: exploreDestination,
          routeName: exploreName,
        }, resolveLocationText, fetchExploreRoute);
        setMessage('Route ready. Opening the four-tablet lobby…');
      }
      if (!configuration) throw new Error('The coach event configuration could not be prepared.');
      const envelope = await createClubEvent(activityType, configuration);
      setEvent(envelope.event);
      setMode('coach');
      setMessage('Lobby open. Riders can choose their name on any available tablet and tap Ready.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The coach event could not be created.');
    } finally {
      setBusy('idle');
    }
  };

  const start = async () => {
    if (!event || readyCount === 0) return;
    setBusy('starting');
    setMessage('Starting every ready tablet from the same server clock…');
    try {
      const envelope = await startCurrentClubEvent(event.id);
      setEvent(envelope.event);
      setMessage('Start sent. Waiting for each ready tablet to confirm its program and private room.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The coach event could not start.');
    } finally {
      setBusy('idle');
    }
  };

  const cancel = async () => {
    if (!event) return;
    setBusy('cancelling');
    try {
      const envelope = await cancelCurrentClubEvent(event.id);
      setEvent(envelope.event);
      setMode('independent');
      setMessage('Coach event ended. Tablets will release each athlete after the results review and return to Independent Training shortly.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The coach event could not be ended.');
    } finally {
      setBusy('idle');
    }
  };

  return (
    <section className="club-event-console" aria-label="Club Event control">
      <div className="club-event-console-header">
        <div>
          <span className="eyebrow"><RadioTower size={15} /> Studio control</span>
          <h3>How should the four tablets run?</h3>
        </div>
        <div className="club-event-mode-switch" role="group" aria-label="Club Tablet operating mode">
          <button
            className={mode === 'independent' && !event ? 'selected' : ''}
            type="button"
            disabled={Boolean(event) || busy !== 'idle'}
            onClick={() => setMode('independent')}
          >
            <Tablet size={17} /> Independent Training
          </button>
          <button
            className={mode === 'coach' || Boolean(event) ? 'selected' : ''}
            type="button"
            disabled={busy !== 'idle'}
            onClick={() => setMode('coach')}
          >
            <Users size={17} /> Coach-led Event
          </button>
        </div>
      </div>

      {!event && mode === 'independent' && (
        <div className="club-event-independent">
          <CheckCircle2 size={24} />
          <div>
            <strong>Riders control their own tablet</strong>
            <p>Each athlete may choose BMX Race Intervals, Straight Sprint, Get Pulled, or Explore the World independently. This owner screen remains read-only and can watch all four live.</p>
          </div>
        </div>
      )}

      {!event && mode === 'coach' && (
        <div className="club-event-builder">
          <label>
            <span>Event</span>
            <select value={activityType} onChange={(event) => setActivityType(event.target.value as ClubEventActivityType)}>
              <option value="bmx-race">BMX Race Intervals</option>
              <option value="straight-sprint">Straight Sprint</option>
              <option value="explore">Explore the World</option>
            </select>
          </label>

          {activityType === 'bmx-race' && <>
            <label className="club-event-builder-wide">
              <span>Mapped track</span>
              <select value={raceTrackId} onChange={(event) => setRaceTrackId(event.target.value)}>
                {raceTracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}
              </select>
            </label>
            <label>
              <span>Laps</span>
              <input type="number" min={1} max={20} value={lapCount} onChange={(event) => setLapCount(Math.max(1, Math.min(20, Math.round(Number(event.target.value) || 1))))} />
            </label>
          </>}

          {activityType === 'straight-sprint' && <>
            <label className="club-event-builder-wide">
              <span>Saved sprint route</span>
              <select value={sprintRouteId} onChange={(event) => setSprintRouteId(event.target.value)}>
                {sprintRoutes.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}
              </select>
            </label>
            <label>
              <span>Distance</span>
              <select value={sprintDistanceFeet} onChange={(event) => setSprintDistanceFeet(Number(event.target.value))}>
                {straightSprintDistanceOptions.map((distance) => <option value={distance} key={distance}>{distance} ft</option>)}
              </select>
            </label>
            <label>
              <span>Wattbike Air</span>
              <select value={airSetting} onChange={(event) => setAirSetting(Number(event.target.value))}>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((setting) => <option value={setting} key={setting}>Air {setting}</option>)}
              </select>
            </label>
          </>}

          {(activityType === 'bmx-race' || activityType === 'straight-sprint') && selectedCourse && (
            <div className="club-event-race-view club-event-builder-wide">
              <span>Tablet race view</span>
              <div role="group" aria-label="Club Event race view">
                <button
                  className={raceViewMode === 'satellite' ? 'selected' : ''}
                  type="button"
                  aria-pressed={raceViewMode === 'satellite'}
                  onClick={() => setRaceViewMode('satellite')}
                >
                  <Satellite size={15} /> Satellite
                </button>
                <button
                  className={raceViewMode === '3d' ? 'selected' : ''}
                  type="button"
                  aria-pressed={raceViewMode === '3d'}
                  onClick={() => setRaceViewMode('3d')}
                >
                  <Box size={15} /> 3D Terrain
                </button>
                {gameArenaAvailable && (
                  <button
                    className={raceViewMode === 'game' ? 'selected' : ''}
                    type="button"
                    aria-pressed={raceViewMode === 'game'}
                    onClick={() => setRaceViewMode('game')}
                  >
                    <Gamepad2 size={15} /> Game Arena
                  </button>
                )}
              </div>
              <small>The selected view and saved camera will open identically on every ready tablet.</small>
            </div>
          )}

          {activityType === 'explore' && <>
            <label><span>Start</span><input value={exploreOrigin} onChange={(event) => setExploreOrigin(event.target.value)} placeholder="Preski Ranch" /></label>
            <label><span>Destination</span><input value={exploreDestination} onChange={(event) => setExploreDestination(event.target.value)} placeholder="Choose a shared destination" /></label>
            <label className="club-event-builder-wide"><span>Ride name</span><input value={exploreName} onChange={(event) => setExploreName(event.target.value)} /></label>
          </>}

          <button
            className="club-event-primary"
            type="button"
            disabled={busy !== 'idle' || clubEventLobbyNeedsRaceViews(activityType, raceViewsReady)}
            onClick={() => void create()}
          >
            {busy === 'creating' ? <LoaderCircle className="spin" size={18} /> : <Users size={18} />}
            {clubEventLobbyNeedsRaceViews(activityType, raceViewsReady)
              ? 'Loading saved track views…'
              : 'Open four-tablet lobby'}
          </button>
        </div>
      )}

      {event && (
        <div className={`club-event-lobby ${event.status}`}>
          <div className="club-event-lobby-title">
            <span className="club-event-icon">{event.activityType === 'bmx-race' ? <Bike /> : event.activityType === 'straight-sprint' ? <Route /> : <Compass />}</span>
            <div>
              <span>{event.status === 'lobby' ? 'Lobby open' : countdownSeconds && countdownSeconds > 0 ? `Starting in ${countdownSeconds}` : 'Event active'}</span>
              <h4>{clubEventActivityTitle(event.activityType)}</h4>
              <p>{eventConfigurationSummary(event)}</p>
            </div>
            <strong>{event.status === 'lobby'
              ? `${readyCount} of 4 ready`
              : `${synchronizedDeviceIds.size} of ${readyCount} tablets synced`}</strong>
          </div>

          <div className="club-event-seats" aria-label="Club Event tablet readiness">
            {Array.from({ length: 4 }, (_, index) => {
              const seatNumber = index + 1;
              const slot = event.slots.find((candidate) => candidate.seatNumber === seatNumber) ?? null;
              const athlete = slot ? displayAthlete(event, slot.deviceId) : null;
              const synchronized = Boolean(slot?.deviceId && synchronizedDeviceIds.has(slot.deviceId));
              return (
                <article className={`club-event-seat ${slot?.status ?? 'available'}`} key={seatNumber}>
                  <b>{seatNumber}</b>
                  <div><strong>{slot?.deviceName ?? `Tablet ${seatNumber}`}</strong><small>{athlete ?? (slot?.deviceId ? 'Waiting for athlete' : 'Tablet not enrolled')}</small></div>
                  <span>{event.status === 'active' && slot?.athlete
                    ? synchronized ? <><CheckCircle2 size={15} /> Program online</> : 'Opening / reconnecting'
                    : slot?.ready ? <><CheckCircle2 size={15} /> Ready</> : slot?.status === 'stale' ? 'Reconnect' : 'Waiting'}</span>
                </article>
              );
            })}
          </div>

          <div className="club-event-lobby-actions">
            {event.status === 'lobby' && (
              <button className="club-event-primary" type="button" disabled={readyCount === 0 || busy !== 'idle'} onClick={() => void start()}>
                {busy === 'starting' ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
                Start all ready riders
              </button>
            )}
            <button type="button" disabled={busy !== 'idle'} onClick={() => void cancel()}>
              <X size={18} /> {event.status === 'active' ? 'End event' : 'Cancel lobby'}
            </button>
          </div>
        </div>
      )}

      {message && <p className="club-event-message" role="status">{message}</p>}
    </section>
  );
}
