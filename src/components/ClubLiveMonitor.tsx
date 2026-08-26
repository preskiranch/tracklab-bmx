import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bike,
  Clock3,
  Compass,
  Gauge,
  Minimize2,
  RadioTower,
  RefreshCw,
  Route,
  Signal,
  Tablet,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  activeClubLiveSessions,
  ClubLiveRequestError,
  loadClubLiveSessions,
  type ClubLiveSession,
} from '../lib/clubLive';
import { loadClubTabletDevices, type ClubTabletDevice } from '../lib/clubTablet';
import { wattbikeMonitorLastThree } from '../lib/bikeProfileIdentity';
import { RiderAvatar } from './RiderAvatar';
import { PullSledScene } from './PullSledScene';
import { ClubEventConsole, type ClubEventCourseOption } from './ClubEventConsole';
import {
  formatDistanceMeters,
  formatExploreDistanceMeters,
  formatSpeedFromKph,
  speedUnitLabel,
} from '../units';
import type { DistanceUnit, SpeedUnit, StudioRider } from '../types';
import './ClubLiveMonitor.css';

type ClubLiveMonitorProps = {
  studioRiders: StudioRider[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  raceTracks?: readonly ClubEventCourseOption[];
  sprintRoutes?: readonly ClubEventCourseOption[];
  raceViewsReady?: boolean;
  fullscreen?: boolean;
  onFullscreenChange?: (enabled: boolean) => void;
};

function activityLabel(activityType: ClubLiveSession['activityType']) {
  if (activityType === 'get-pulled') return 'Get Pulled';
  if (activityType === 'straight-sprint') return 'Straight Sprint';
  if (activityType === 'explore') return 'Explore the World';
  return 'BMX Race';
}

function ActivityIcon({ activityType }: { activityType: ClubLiveSession['activityType'] }) {
  if (activityType === 'get-pulled') return <Zap size={18} />;
  if (activityType === 'straight-sprint') return <Route size={18} />;
  if (activityType === 'explore') return <Compass size={18} />;
  return <Bike size={18} />;
}

function statusLabel(status: ClubLiveSession['status']) {
  if (status === 'staging') return 'At the gate';
  if (status === 'active') return 'Training live';
  if (status === 'paused') return 'Paused';
  if (status === 'finished') return 'Finished';
  return 'Getting ready';
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function tabletSeenLabel(lastSeenAt: number | undefined, now: number) {
  if (!lastSeenAt) return 'Waiting for first check-in';
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSeenAt) / 1_000));
  if (elapsedSeconds < 10) return 'Online now';
  if (elapsedSeconds < 60) return `Seen ${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Seen ${elapsedMinutes}m ago`;
  return `Last seen ${new Date(lastSeenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function clubTabletMonitorOnline(
  tablet: ClubTabletDevice | null | undefined,
  session: ClubLiveSession | null | undefined,
  now: number,
) {
  return Boolean(
    tablet?.lastSeenAt && now - tablet.lastSeenAt < 30_000
    || session && session.expiresAt > now && now - session.updatedAt < 30_000,
  );
}

export function clubTabletMonitorConnectedBike(
  tablet: ClubTabletDevice | null | undefined,
  deviceFeedAvailable = true,
) {
  if (!deviceFeedAvailable) return null;
  // The owner endpoint has already checked expiry against the server clock.
  // Rechecking with this PC's clock can hide a valid tablet when clocks differ.
  return tablet?.connectedBike ?? null;
}

export function clubTabletDeviceFeedErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail
    ? `Connected-bike status is unavailable: ${detail}`
    : 'Connected-bike status is unavailable. Refresh the monitor to try again.';
}

export function selectClubTabletOverviewDevices(
  tablets: readonly ClubTabletDevice[],
  sessions: readonly ClubLiveSession[],
  now: number,
) {
  if (tablets.length <= 4) return [...tablets];
  const sessionByDeviceId = new Map(sessions.flatMap((session) => (
    session.deviceId ? [[session.deviceId, session] as const] : []
  )));
  return [...tablets]
    .sort((left, right) => {
      const leftSession = sessionByDeviceId.get(left.id);
      const rightSession = sessionByDeviceId.get(right.id);
      const onlineDifference = Number(clubTabletMonitorOnline(right, rightSession, now))
        - Number(clubTabletMonitorOnline(left, leftSession, now));
      if (onlineDifference) return onlineDifference;
      const leftSeenAt = Math.max(left.lastSeenAt ?? 0, leftSession?.updatedAt ?? 0);
      const rightSeenAt = Math.max(right.lastSeenAt ?? 0, rightSession?.updatedAt ?? 0);
      return rightSeenAt - leftSeenAt || (right.createdAt ?? 0) - (left.createdAt ?? 0);
    })
    .slice(0, 4);
}

export function formatClubLiveActivityDistance(
  distanceMeters: number,
  distanceUnit: DistanceUnit,
  activityType: ClubLiveSession['activityType'],
) {
  return activityType === 'explore'
    ? formatExploreDistanceMeters(distanceMeters, distanceUnit === 'm' ? 'km' : 'mi')
    : formatDistanceMeters(distanceMeters, distanceUnit);
}

export function ClubLiveMonitor({
  studioRiders,
  speedUnit,
  distanceUnit,
  raceTracks = [],
  sprintRoutes = [],
  raceViewsReady = true,
  fullscreen = false,
  onFullscreenChange,
}: ClubLiveMonitorProps) {
  const requestGenerationRef = useRef(0);
  const lastTabletRefreshAtRef = useRef(0);
  const [sessions, setSessions] = useState<ClubLiveSession[]>([]);
  const [tablets, setTablets] = useState<ClubTabletDevice[]>([]);
  const [tabletFeedError, setTabletFeedError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('Opening the private club feed…');
  const [now, setNow] = useState(Date.now());
  const photoByRiderId = useMemo(
    () => new Map(studioRiders.map((rider) => [rider.id, rider.photoUrl])),
    [studioRiders],
  );
  const liveSessions = useMemo(
    () => activeClubLiveSessions(sessions, now),
    [now, sessions],
  );
  const connectedBikeCount = useMemo(
    () => tablets.filter((tablet) => clubTabletMonitorConnectedBike(tablet, tabletFeedError == null)).length,
    [tabletFeedError, tablets],
  );
  const tabletSlots = useMemo(() => {
    const enrolled = selectClubTabletOverviewDevices(tablets, liveSessions, now).map((tablet, index) => ({
      seatNumber: index + 1,
      tablet,
      session: liveSessions.find((candidate) => candidate.deviceId === tablet.id) ?? null,
    }));
    return [
      ...enrolled,
      ...Array.from({ length: Math.max(0, 4 - enrolled.length) }, (_, index) => ({
        seatNumber: enrolled.length + index + 1,
        tablet: null,
        session: null,
      })),
    ];
  }, [liveSessions, now, tablets]);

  const refresh = useCallback(async (forceTabletFeed = false) => {
    const generation = ++requestGenerationRef.current;
    try {
      const refreshTablets = forceTabletFeed || Date.now() - lastTabletRefreshAtRef.current >= 5_000;
      if (refreshTablets) lastTabletRefreshAtRef.current = Date.now();
      let nextTabletFeedError: string | null = null;
      const [next, nextTablets] = await Promise.all([
        loadClubLiveSessions(),
        refreshTablets ? loadClubTabletDevices().catch((error: unknown) => {
          nextTabletFeedError = clubTabletDeviceFeedErrorMessage(error);
          return null;
        }) : Promise.resolve(null),
      ]);
      if (generation !== requestGenerationRef.current) return;
      setSessions(next);
      if (refreshTablets) {
        if (nextTablets) setTablets(nextTablets);
        setTabletFeedError(nextTabletFeedError);
      }
      setStatus('ready');
      setMessage(next.length > 0 ? '' : 'No club athletes are sharing a live training session right now.');
      setNow(Date.now());
    } catch (error) {
      if (generation !== requestGenerationRef.current) return;
      if (error instanceof ClubLiveRequestError && (error.status === 401 || error.status === 403)) {
        setSessions([]);
      }
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The club live feed is temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let requestActive = false;
    const poll = async () => {
      if (disposed || requestActive || document.visibilityState === 'hidden') return;
      requestActive = true;
      await refresh();
      requestActive = false;
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      requestGenerationRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="club-live-monitor" aria-label="Club Live Monitor">
      <header className="club-live-header">
        <div>
          <span className="eyebrow"><RadioTower size={15} /> Owner-only view</span>
          <h2>Club Live Monitor</h2>
          <p>Optional read-only display for athletes using your club. Opening this screen is not required for their bike access.</p>
        </div>
        <div className={`club-live-connection ${status}`}>
          <Signal size={17} />
          <span>{status === 'error' ? 'Feed interrupted' : `${liveSessions.length} live`}</span>
          <button type="button" onClick={() => void refresh(true)} aria-label="Refresh Club Live Monitor">
            <RefreshCw size={16} />
          </button>
          {fullscreen && (
            <button
              className="club-live-exit-fullscreen"
              type="button"
              onClick={() => onFullscreenChange?.(false)}
              aria-label="Exit full screen Club Live Monitor"
            >
              <Minimize2 size={16} />
            </button>
          )}
        </div>
      </header>

      <ClubEventConsole
        raceTracks={raceTracks}
        sprintRoutes={sprintRoutes}
        raceViewsReady={raceViewsReady}
      />

      <section className="club-live-tablet-overview" aria-label="Four Club Tablet status">
        <div className="club-live-tablet-overview-copy">
          <span><Tablet size={18} /> Four Club Tablets</span>
          <p>
            <strong className={`club-live-bike-count${tabletFeedError ? ' error' : ''}`}>
              {tabletFeedError
                ? <><WifiOff size={14} /> Bike status unavailable</>
                : <><Bike size={14} /> {connectedBikeCount} bike{connectedBikeCount === 1 ? '' : 's'} connected</>}
            </strong>
            Independent Training stays available on every tablet. Riders choose their own athlete and program while this owner screen only watches.
          </p>
        </div>
        {tabletFeedError && (
          <p className="club-live-tablet-overflow-warning" role="alert">{tabletFeedError}</p>
        )}
        {tablets.length > 4 && (
          <p className="club-live-tablet-overflow-warning" role="alert">
            {tablets.length} tablets are enrolled. The four online or most recently seen tablets are shown here; revoke retired authorizations before opening a four-tablet coach lobby.
          </p>
        )}
        <div className="club-live-tablet-slots">
          {tabletSlots.map(({ seatNumber, tablet, session }) => {
            const online = clubTabletMonitorOnline(tablet, session, now);
            const connectedBike = clubTabletMonitorConnectedBike(tablet, tabletFeedError == null);
            const lastSeenAt = Math.max(tablet?.lastSeenAt ?? 0, session?.updatedAt ?? 0) || undefined;
            const displayName = session?.athleteName || session?.riderName;
            return (
              <article
                className={`club-live-tablet-slot${session ? ' training' : ''}${online ? ' online' : ''}`}
                key={tablet?.id ?? `empty-${seatNumber}`}
              >
                <span className="club-live-tablet-number">{seatNumber}</span>
                <div>
                  <strong>{tablet?.name ?? `Tablet ${seatNumber}`}</strong>
                  <small>{session
                    ? `${displayName} · ${activityLabel(session.activityType)}`
                    : tablet
                      ? 'Ready for an athlete'
                      : 'Not enrolled yet'}</small>
                  {connectedBike && (
                    <small className="club-live-tablet-bike">
                      Bike connected · PM {wattbikeMonitorLastThree(
                        connectedBike.label,
                        connectedBike.deviceId,
                      )}
                    </small>
                  )}
                </div>
                <span className={`club-live-tablet-presence ${online ? 'online' : 'offline'}`}>
                  {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                  {tablet ? tabletSeenLabel(lastSeenAt, now) : 'Open slot'}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      {liveSessions.length > 0 ? (
        <div className={`club-live-grid count-${liveSessions.length}`}>
          {liveSessions.map((session) => {
            const stale = now > session.expiresAt || now - session.updatedAt > 4_000;
            const displayName = session.athleteName || session.riderName;
            const subtitle = session.athleteName && session.athleteName !== session.riderName
              ? `Studio rider: ${session.riderName}`
              : 'Club athlete';
            const percent = Math.round(session.progress.fraction * 100);
            const location = session.trackName ?? session.destinationLabel ?? 'Training session';
            const position = session.metrics.position && session.metrics.participantCount > 0
              ? `${session.metrics.position} of ${session.metrics.participantCount}`
              : '—';
            return (
              <section className={`club-live-tile ${session.status}${stale ? ' stale' : ''}`} key={session.id}>
                <div className="club-live-athlete">
                  <RiderAvatar
                    name={displayName}
                    photoUrl={photoByRiderId.get(session.studioRiderId)}
                    accent="#78df3b"
                    className="club-live-avatar"
                  />
                  <div>
                    <h3>{displayName}</h3>
                    <p>{subtitle}</p>
                  </div>
                  <span className={`club-live-status ${stale ? 'stale' : session.status}`}>
                    <i /> {stale ? 'Reconnecting' : statusLabel(session.status)}
                  </span>
                </div>

                <div className="club-live-activity">
                  <span><ActivityIcon activityType={session.activityType} /></span>
                  <div>
                    <strong>{activityLabel(session.activityType)}</strong>
                    <small>{location}</small>
                  </div>
                  {session.multiplayer && <b><Users size={14} /> Private room</b>}
                </div>

                {session.activityType === 'get-pulled' && (
                  <div className="club-live-pull-scene">
                    <PullSledScene
                      active={!stale && session.status === 'active'}
                      cadenceRpm={session.metrics.cadence}
                      compact
                      label={`${displayName} in a Get Pulled test`}
                      progress={session.progress.fraction}
                      speedKph={session.metrics.speedKph}
                    />
                  </div>
                )}

                <div className="club-live-progress-copy">
                  <strong>{session.progress.label ?? `${percent}% complete`}</strong>
                  <span>{formatClubLiveActivityDistance(
                    session.metrics.distanceMeters,
                    distanceUnit,
                    session.activityType,
                  )}</span>
                </div>
                <div className="club-live-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <span style={{ width: `${percent}%` }} />
                </div>

                <div className="club-live-metrics">
                  <div><Activity size={18} /><strong>{session.metrics.cadence}</strong><small>rpm</small></div>
                  <div><Zap size={18} /><strong>{session.metrics.watts}</strong><small>watts</small></div>
                  <div><Gauge size={18} /><strong>{formatSpeedFromKph(session.metrics.speedKph, speedUnit)}</strong><small>{speedUnitLabel(speedUnit)}</small></div>
                  <div><Clock3 size={18} /><strong>{formatElapsed(session.metrics.elapsedMs)}</strong><small>elapsed</small></div>
                </div>

                <div className="club-live-tile-footer">
                  <span>Position <strong>{position}</strong></span>
                  <span>{stale ? 'Waiting for the athlete device' : 'Read-only live feed'}</span>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className={`club-live-empty ${status}`}>
          <RadioTower size={38} />
          <strong>{status === 'loading' ? 'Connecting to your club…' : 'Waiting for athletes'}</strong>
          <p>{message || 'No club athletes are sharing a live training session right now.'}</p>
          {status === 'error' && <button type="button" onClick={() => void refresh()}>Try again</button>}
        </section>
      )}
    </main>
  );
}

export default ClubLiveMonitor;
