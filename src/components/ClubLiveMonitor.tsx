import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bike,
  Clock3,
  Compass,
  Gauge,
  RadioTower,
  RefreshCw,
  Route,
  Signal,
  Users,
  Zap,
} from 'lucide-react';
import {
  activeClubLiveSessions,
  ClubLiveRequestError,
  loadClubLiveSessions,
  type ClubLiveSession,
} from '../lib/clubLive';
import { RiderAvatar } from './RiderAvatar';
import { formatSpeedFromKph, speedUnitLabel } from '../units';
import type { SpeedUnit, StudioRider } from '../types';
import './ClubLiveMonitor.css';

type ClubLiveMonitorProps = {
  studioRiders: StudioRider[];
  speedUnit: SpeedUnit;
};

function activityLabel(activityType: ClubLiveSession['activityType']) {
  if (activityType === 'straight-sprint') return 'Straight Sprint';
  if (activityType === 'explore') return 'Explore the World';
  return 'BMX Race';
}

function ActivityIcon({ activityType }: { activityType: ClubLiveSession['activityType'] }) {
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

function formatDistance(distanceMeters: number) {
  const feet = distanceMeters * 3.28084;
  return feet >= 5_280 ? `${(feet / 5_280).toFixed(2)} mi` : `${Math.round(feet).toLocaleString()} ft`;
}

export function ClubLiveMonitor({ studioRiders, speedUnit }: ClubLiveMonitorProps) {
  const requestGenerationRef = useRef(0);
  const [sessions, setSessions] = useState<ClubLiveSession[]>([]);
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

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      const next = await loadClubLiveSessions();
      if (generation !== requestGenerationRef.current) return;
      setSessions(next);
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
          <p>Read-only live training from athletes who selected your club for this session.</p>
        </div>
        <div className={`club-live-connection ${status}`}>
          <Signal size={17} />
          <span>{status === 'error' ? 'Feed interrupted' : `${liveSessions.length} of 4 live`}</span>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh Club Live Monitor">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

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

                <div className="club-live-progress-copy">
                  <strong>{session.progress.label ?? `${percent}% complete`}</strong>
                  <span>{formatDistance(session.metrics.distanceMeters)}</span>
                </div>
                <div className="club-live-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <span style={{ width: `${percent}%` }} />
                </div>

                <div className="club-live-metrics">
                  <div><Zap size={18} /><strong>{session.metrics.watts}</strong><small>watts</small></div>
                  <div><Activity size={18} /><strong>{session.metrics.cadence}</strong><small>rpm</small></div>
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
