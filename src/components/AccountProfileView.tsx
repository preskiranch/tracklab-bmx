import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bike,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  RefreshCw,
  Timer,
} from 'lucide-react';
import type { AccountProfile, TrainingActivityType, TrainingSession } from '../types';
import {
  downloadTrainingSession,
  loadTrainingHistory,
  type TrainingHistoryResponse,
} from '../lib/trainingHistory';
import { RiderAvatar, RiderPhotoEditor } from './RiderAvatar';
import './AccountProfileView.css';

type AccountProfileViewProps = {
  name: string;
  email: string;
  membershipLabel: string;
  profile: AccountProfile;
  historyRevision: number;
  onPhotoChange: (photoUrl: string | undefined) => void;
};

const emptyHistory: TrainingHistoryResponse = {
  sessions: [],
  totals: { sessions: 0, bmxRaces: 0, straightSprints: 0, exploreRides: 0, distanceMeters: 0, durationMs: 0 },
};

const activityLabels: Record<TrainingActivityType, string> = {
  'bmx-race': 'BMX Race Interval',
  'straight-sprint': 'Straight Sprint',
  explore: 'Explore the World',
};

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(date: Date) {
  return {
    from: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
    to: new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1,
  };
}

function monthDays(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: count }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index + 1)),
  ];
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatDistance(meters: number) {
  const miles = meters / 1609.344;
  return miles >= 0.1 ? `${miles.toFixed(miles >= 10 ? 1 : 2)} mi` : `${Math.round(meters * 3.28084)} ft`;
}

function sessionIcon(type: TrainingActivityType) {
  if (type === 'explore') return <Compass size={19} />;
  if (type === 'straight-sprint') return <Timer size={19} />;
  return <Bike size={19} />;
}

function summarizeSession(session: TrainingSession) {
  const details = session.details as {
    summaries?: Array<{ riderName?: string; rank?: number; finishTimeMs?: number; topCadence?: number; topWatts?: number }>;
    riders?: Array<{ name?: string; distanceMeters?: number; averageSpeedMph?: number }>;
    sprintDistanceFeet?: number;
    sprintAirSetting?: number;
  };
  if (session.activityType === 'explore') {
    return (details.riders ?? []).map((rider) => `${rider.name ?? 'Rider'} · ${formatDistance(Number(rider.distanceMeters) || 0)}`).join(' · ');
  }
  const winner = (details.summaries ?? []).find((summary) => summary.rank === 1) ?? details.summaries?.[0];
  const sprint = details.sprintDistanceFeet
    ? `${details.sprintDistanceFeet} ft${details.sprintAirSetting ? ` · Air ${details.sprintAirSetting}` : ''}`
    : '';
  const result = winner?.riderName
    ? `${winner.riderName}${winner.finishTimeMs ? ` · ${(winner.finishTimeMs / 1_000).toFixed(2)}s` : ''}`
    : '';
  return [sprint, result].filter(Boolean).join(' · ');
}

export function AccountProfileView({
  name,
  email,
  membershipLabel,
  profile,
  historyRevision,
  onPhotoChange,
}: AccountProfileViewProps) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(Date.now()));
  const [history, setHistory] = useState<TrainingHistoryResponse>(emptyHistory);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('Loading your training history…');

  const refresh = useCallback(() => {
    const range = monthRange(month);
    setStatus('loading');
    setMessage('Loading your training history…');
    void loadTrainingHistory(range.from, range.to)
      .then((next) => {
        setHistory(next);
        setStatus('ready');
        setMessage(next.sessions.length > 0 ? '' : 'No saved training sessions in this month yet.');
      })
      .catch((error: Error) => {
        setStatus('error');
        setMessage(`Training history is temporarily unavailable. ${error.message}`);
      });
  }, [month]);

  useEffect(() => refresh(), [historyRevision, refresh]);

  const sessionsByDay = useMemo(() => {
    const grouped = new Map<string, TrainingSession[]>();
    history.sessions.forEach((session) => {
      const key = localDateKey(session.startedAt);
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    });
    return grouped;
  }, [history.sessions]);
  const selectedSessions = sessionsByDay.get(selectedDate) ?? [];
  const days = monthDays(month);

  const changeMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(localDateKey(next.getTime()));
  };

  return (
    <div className="account-profile-view">
      <section className="account-profile-hero">
        <div className="account-profile-identity">
          <RiderAvatar name={name} photoUrl={profile.photoUrl} accent="#7ade36" />
          <div>
            <span className="eyebrow">My TrackLab profile</span>
            <h1>{name}</h1>
            <p>{email}</p>
            <b>{membershipLabel}</b>
          </div>
        </div>
        <RiderPhotoEditor
          name={name}
          photoUrl={profile.photoUrl}
          onPhotoChange={onPhotoChange}
        />
        <p className="account-profile-photo-note">
          This is your account rider photo. It follows your profile across devices and is available in race entry, rider cards, results, and saved sessions.
        </p>
      </section>

      <section className="account-profile-summary" aria-label="Monthly training totals">
        <article><Activity size={20} /><span><b>{history.totals.sessions}</b><small>Sessions this month</small></span></article>
        <article><Bike size={20} /><span><b>{history.totals.bmxRaces}</b><small>BMX races</small></span></article>
        <article><Timer size={20} /><span><b>{history.totals.straightSprints}</b><small>Straight sprints</small></span></article>
        <article><Compass size={20} /><span><b>{formatDistance(history.totals.distanceMeters)}</b><small>Total distance</small></span></article>
      </section>

      <div className="account-training-layout">
        <section className="training-calendar" aria-label="Training calendar">
          <header>
            <div><CalendarDays size={20} /><span><strong>Training calendar</strong><small>Select a day to review every activity.</small></span></div>
            <div className="training-calendar-controls">
              <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
              <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
              <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
              <button type="button" aria-label="Refresh training history" onClick={refresh}><RefreshCw size={16} /></button>
            </div>
          </header>
          <div className="training-calendar-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="training-calendar-grid">
            {days.map((day, index) => {
              if (!day) return <span className="training-calendar-empty" key={`empty-${index}`} />;
              const key = localDateKey(day.getTime());
              const count = sessionsByDay.get(key)?.length ?? 0;
              return (
                <button
                  className={`${key === selectedDate ? 'selected' : ''}${count > 0 ? ' has-sessions' : ''}`}
                  type="button"
                  aria-label={`${day.toLocaleDateString()}, ${count} training sessions`}
                  onClick={() => setSelectedDate(key)}
                  key={key}
                >
                  <b>{day.getDate()}</b>
                  {count > 0 && <span>{count}</span>}
                </button>
              );
            })}
          </div>
          {status !== 'ready' || message ? <p className={`training-history-message ${status}`}>{message}</p> : null}
        </section>

        <section className="training-day-sessions" aria-label="Selected day training sessions">
          <header>
            <span className="eyebrow">Selected day</span>
            <h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            <p>{selectedSessions.length} saved {selectedSessions.length === 1 ? 'session' : 'sessions'}</p>
          </header>
          {selectedSessions.length > 0 ? selectedSessions.map((session) => (
            <article className={`training-session-card ${session.activityType}`} key={session.id}>
              <div className="training-session-icon">{sessionIcon(session.activityType)}</div>
              <div className="training-session-copy">
                <span>{activityLabels[session.activityType]}</span>
                <strong>{session.title}</strong>
                <small>
                  {new Date(session.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {' · '}{formatDuration(session.durationMs)}{' · '}{formatDistance(session.distanceMeters)}
                </small>
                {summarizeSession(session) && <p>{summarizeSession(session)}</p>}
              </div>
              <div className="training-session-downloads">
                <button type="button" onClick={() => downloadTrainingSession(session, 'json')}><Download size={15} /> JSON</button>
                <button type="button" onClick={() => downloadTrainingSession(session, 'csv')}><Download size={15} /> CSV</button>
              </div>
            </article>
          )) : (
            <div className="training-day-empty">
              <CalendarDays size={36} />
              <strong>No training saved on this day</strong>
              <p>Finished races, individual sprints, and Explore rides will appear here automatically.</p>
            </div>
          )}
        </section>
      </div>
      <small className="account-history-sync-note">Calendar month: {monthKey(month)} · Account history is stored by your signed-in profile and available across browsers.</small>
    </div>
  );
}
