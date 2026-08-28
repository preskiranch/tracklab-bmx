import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  LogOut,
  Radio,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import {
  ClubEventRequestError,
  clubEventActivityTitle,
  clubEventLaunchForDevice,
  clubEventLaunchKey,
  clubEventSlotForDevice,
  clubEventTabletState,
  loadCurrentClubEvent,
  type ClubEventEnvelope,
  type ClubEventLaunchPayload,
  type ClubEventSelection,
  type ClubEventSnapshot,
} from '../lib/clubEvent';
import type {
  ClubTabletDeviceCredential,
  ClubTabletSessionCredential,
} from '../lib/clubTabletStorage';
import './ClubTabletEventCard.css';

export type ClubTabletEventReadyRequest = Readonly<{
  event: ClubEventSnapshot;
  selection: ClubEventSelection;
}>;

type ClubTabletEventCardProps = Readonly<{
  device: ClubTabletDeviceCredential;
  session: ClubTabletSessionCredential | null;
  selectedRiderId: string;
  selectedBikeId: number | null;
  selectedAthleteName?: string | null;
  selectedBikeName?: string | null;
  onReady: (request: ClubTabletEventReadyRequest) => Promise<ClubEventEnvelope | void>;
  onLeave: (event: ClubEventSnapshot) => Promise<ClubEventEnvelope | void>;
  onLobbyEnded?: (event: ClubEventSnapshot) => void;
  onLaunch: (payload: ClubEventLaunchPayload) => void;
  onSnapshotChange?: (event: ClubEventSnapshot | null) => void;
  /** Unlocks iPad media/Web Audio while the rider's Ready tap is active. */
  onPrimeAudio?: () => Promise<void> | void;
}>;

function configurationSummary(event: ClubEventSnapshot) {
  const configuration = event.configuration;
  const values: string[] = [];
  const location = typeof configuration.trackName === 'string'
    ? configuration.trackName
    : typeof configuration.routeName === 'string'
      ? configuration.routeName
      : typeof configuration.destinationLabel === 'string'
        ? configuration.destinationLabel
        : '';
  if (location.trim()) values.push(location.trim().slice(0, 80));
  const distanceFeet = Number(configuration.distanceFeet);
  if (Number.isFinite(distanceFeet) && distanceFeet > 0) values.push(`${Math.round(distanceFeet)} ft`);
  const airSetting = Number(configuration.airSetting);
  if (Number.isFinite(airSetting) && airSetting > 0) values.push(`Air ${Math.round(airSetting)}`);
  const lapCount = Number(configuration.lapCount);
  if (Number.isFinite(lapCount) && lapCount > 0) {
    const laps = Math.round(lapCount);
    values.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`);
  }
  return values.join(' · ');
}

function athleteDisplayName(event: ClubEventSnapshot, studioRiderId: string) {
  const athlete = event.slots.find((slot) => slot.athlete?.studioRiderId === studioRiderId)?.athlete;
  return athlete?.athleteName || athlete?.riderName || '';
}

function countdownLabel(startAt: number, now: number) {
  const remainingMs = Math.max(0, startAt - now);
  if (remainingMs <= 0) return 'Opening now…';
  if (remainingMs < 10_000) return `Starts in ${(remainingMs / 1_000).toFixed(1)}s`;
  return `Starts in ${Math.ceil(remainingMs / 1_000)}s`;
}

export function clubTabletEventPollingMessage(
  lastLoadedEvent: ClubEventSnapshot | null | undefined,
  deviceId: string,
) {
  // Polling is passive discovery until this tablet actually occupies a lane.
  // An ordinary tablet restore must stay silent when there is no coach event,
  // or when the current event belongs only to other tablets. Once a server
  // snapshot confirms this device joined, a later refresh failure is useful
  // because the rider may otherwise miss a synchronized start or cancellation.
  return lastLoadedEvent && clubEventSlotForDevice(lastLoadedEvent, deviceId)
    ? 'Could not refresh the coach event. TrackLab will keep trying.'
    : null;
}

function isClubTabletEventPollingMessage(message: string | null) {
  return message?.startsWith('Could not load the coach event')
    || message?.startsWith('Could not refresh the coach event');
}

export default function ClubTabletEventCard({
  device,
  session,
  selectedRiderId,
  selectedBikeId,
  selectedAthleteName,
  selectedBikeName,
  onReady,
  onLeave,
  onLobbyEnded,
  onLaunch,
  onSnapshotChange,
  onPrimeAudio,
}: ClubTabletEventCardProps) {
  const [envelope, setEnvelope] = useState<ClubEventEnvelope | null>(null);
  const [busy, setBusy] = useState<'idle' | 'ready' | 'leaving'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const envelopeRef = useRef<ClubEventEnvelope | null>(null);
  const previousEventRef = useRef<ClubEventSnapshot | null>(null);
  const launchedKeyRef = useRef('');
  const event = envelope?.event?.clubId === device.device.clubId ? envelope.event : null;
  const localSlot = clubEventSlotForDevice(event, device.device.id);
  const effectiveRiderId = session?.session.studioRiderId || selectedRiderId;
  const effectiveBikeId = session?.session.bikeDeviceId ?? selectedBikeId;
  const selection = event && effectiveRiderId && effectiveBikeId != null
    ? {
      deviceId: device.device.id,
      studioRiderId: effectiveRiderId,
      bikeDeviceId: effectiveBikeId,
    } satisfies ClubEventSelection
    : null;
  const tabletState = event
    ? clubEventTabletState(event, device.device.id, selection)
    : null;

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      let nextPollAfterMs = envelopeRef.current?.pollAfterMs ?? 2_000;
      try {
        const next = await loadCurrentClubEvent({ device, session }, controller.signal);
        if (disposed) return;
        nextPollAfterMs = next.pollAfterMs;
        envelopeRef.current = next;
        setEnvelope(next);
        setMessage((current) => isClubTabletEventPollingMessage(current) ? null : current);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if (error instanceof ClubEventRequestError && error.status === 404) {
          const empty = { event: null, pollAfterMs: 5_000 } satisfies ClubEventEnvelope;
          envelopeRef.current = empty;
          setEnvelope(empty);
          setMessage((current) => isClubTabletEventPollingMessage(current) ? null : current);
          nextPollAfterMs = 5_000;
        } else {
          const pollingMessage = clubTabletEventPollingMessage(
            envelopeRef.current?.event,
            device.device.id,
          );
          setMessage((current) => pollingMessage
            ?? (isClubTabletEventPollingMessage(current) ? null : current));
        }
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), nextPollAfterMs);
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
    // Poll authentication must change immediately when Ready creates the
    // short-lived athlete session.
  }, [device.device.id, device.deviceToken, session?.sessionToken]);

  useEffect(() => {
    onSnapshotChange?.(event);
  }, [event, onSnapshotChange]);

  useEffect(() => {
    const previous = previousEventRef.current;
    if (
      previous
      && previous.status === 'lobby'
      && clubEventSlotForDevice(previous, device.device.id)
      && (!event || event.id !== previous.id)
    ) {
      onLobbyEnded?.(previous);
    }
    previousEventRef.current = event;
  }, [device.device.id, event, onLobbyEnded]);

  const launch = useMemo(
    () => clubEventLaunchForDevice(event, device.device.id),
    [device.device.id, event],
  );

  useEffect(() => {
    if (!launch) return undefined;
    const key = clubEventLaunchKey(launch);
    if (launchedKeyRef.current === key) return undefined;
    // Open and configure the program as soon as the coach starts the event.
    // The program owns the shared startAt countdown so every tablet begins the
    // actual exercise together after its screen is ready.
    launchedKeyRef.current = key;
    onLaunch(launch);
    return undefined;
  }, [launch, onLaunch]);

  useEffect(() => {
    if (!launch) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [launch]);

  if (!event) {
    return message ? (
      <section className="club-tablet-event-card unavailable" aria-label="Coach event connection" role="alert">
        <div className="club-tablet-event-unavailable">
          <CircleAlert />
          <span><strong>Coach event connection interrupted</strong><small>{message}</small></span>
          <RefreshCw className="club-tablet-event-spin" />
        </div>
      </section>
    ) : null;
  }

  const ready = async () => {
    if (!selection || event.status !== 'lobby' || tabletState?.conflict) return;
    // Safari only authorizes later gate/commentary playback when media is
    // primed synchronously inside this rider gesture. Do this before the first
    // network await; the coach's eventual launch is intentionally automatic.
    void onPrimeAudio?.();
    setBusy('ready');
    setMessage(null);
    try {
      const next = await onReady({ event, selection });
      if (next) {
        envelopeRef.current = next;
        setEnvelope(next);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This tablet could not join the coach event.');
    } finally {
      setBusy('idle');
    }
  };

  const leave = async () => {
    setBusy('leaving');
    setMessage(null);
    try {
      const next = await onLeave(event);
      if (next) {
        envelopeRef.current = next;
        setEnvelope(next);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This tablet could not leave the coach event.');
    } finally {
      setBusy('idle');
    }
  };

  const eventDetail = configurationSummary(event);
  const effectiveAthleteName = session?.session.athleteName
    || session?.session.riderName
    || selectedAthleteName
    || athleteDisplayName(event, effectiveRiderId)
    || 'Choose your athlete below';
  const effectiveBikeName = selectedBikeName
    || (effectiveBikeId != null ? `Wattbike PM ${String(effectiveBikeId).slice(-3)}` : 'Connect this tablet’s Wattbike');
  const eventUnderwayWithoutTablet = event.status === 'active' && !localSlot;

  return (
    <section className={`club-tablet-event-card ${event.status} ${tabletState?.phase ?? 'selecting'}`} aria-label="Coach event">
      <header>
        <span className="club-tablet-event-icon"><Radio /></span>
        <div>
          <span className="eyebrow">Coach event · {event.status === 'lobby' ? 'Lobby open' : 'Starting together'}</span>
          <h3>{clubEventActivityTitle(event.activityType)}</h3>
          <p>{eventDetail || `${event.clubName} synchronized workout`}</p>
        </div>
        <span className="club-tablet-event-seat-count"><UsersRound size={17} /> {event.slots.filter((slot) => slot.athlete).length}/4 ready</span>
      </header>

      <div className="club-tablet-event-slots" aria-label="Coach event lanes">
        {event.slots.map((slot) => (
          <span className={`${slot.status}${slot.deviceId === device.device.id ? ' this-tablet' : ''}`} key={slot.seatNumber}>
            <b>{slot.seatNumber}</b>
            <small>{slot.athlete
              ? slot.athlete.athleteName || slot.athlete.riderName
              : 'Open lane'}</small>
            {slot.ready && <CheckCircle2 size={15} />}
          </span>
        ))}
      </div>

      {tabletState?.phase === 'active' && launch ? (
        <div className="club-tablet-event-countdown" role="status" aria-live="polite">
          <CalendarClock />
          <span><strong>{countdownLabel(launch.startAt, now)}</strong><small>Stay on this screen. TrackLab will open the coach’s activity automatically.</small></span>
        </div>
      ) : tabletState?.phase === 'ready' ? (
        <div className="club-tablet-event-ready" role="status">
          <CheckCircle2 />
          <span><strong>{localSlot?.athlete?.athleteName || localSlot?.athlete?.riderName} is ready</strong><small>Waiting for the coach. This tablet will start with the other bikes.</small></span>
          <button type="button" disabled={busy !== 'idle'} onClick={() => void leave()}>
            <LogOut size={16} /> {busy === 'leaving' ? 'Leaving…' : 'Leave event'}
          </button>
        </div>
      ) : tabletState?.phase === 'stale' ? (
        <div className="club-tablet-event-warning" role="alert">
          <CircleAlert />
          <span><strong>This event seat needs attention</strong><small>Check the tablet connection, then leave and press Ready again.</small></span>
          <button type="button" disabled={busy !== 'idle'} onClick={() => void leave()}>Leave event</button>
        </div>
      ) : eventUnderwayWithoutTablet ? (
        <div className="club-tablet-event-note">
          <CalendarClock />
          <span><strong>This coach event is already underway.</strong><small>Independent Training remains available below.</small></span>
        </div>
      ) : (
        <div className="club-tablet-event-join">
          <div><span>Athlete</span><strong>{effectiveAthleteName}</strong></div>
          <div><span>This tablet’s bike</span><strong>{effectiveBikeName}</strong></div>
          <button
            type="button"
            disabled={!selection || Boolean(tabletState?.conflict) || busy !== 'idle'}
            onClick={() => void ready()}
          >
            {busy === 'ready' ? <LoaderCircle className="club-tablet-event-spin" /> : <CheckCircle2 />}
            {busy === 'ready' ? 'Joining…' : 'Ready for coach event'}
          </button>
        </div>
      )}

      {tabletState?.conflict && <p className="club-tablet-event-error" role="alert">{tabletState.conflict}</p>}
      {message && <p className="club-tablet-event-message" role="alert">{message}</p>}
      <footer>
        <RefreshCw size={14} /> Coach events are optional. Independent Training and all four activities stay available below.
      </footer>
    </section>
  );
}
