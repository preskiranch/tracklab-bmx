import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bike,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Download,
  Link2,
  RefreshCw,
  ShieldCheck,
  Timer,
  UserPlus,
  X,
} from 'lucide-react';
import type { AccountProfile, StudioRider, TrainingActivityType, TrainingSession } from '../types';
import {
  claimClubInvite,
  clearClubInviteFromUrl,
  clubInviteTokenFromUrl,
  clubInviteUrl,
  createClubInvite,
  loadClubConnect,
  revokeClubMember,
  type ClubConnectState,
} from '../lib/clubConnect';
import {
  downloadTrainingSession,
  loadTrainingHistory,
  type TrainingHistoryResponse,
} from '../lib/trainingHistory';
import type { AuthUser } from '../lib/auth';
import { RiderAvatar, RiderPhotoEditor } from './RiderAvatar';
import './AccountProfileView.css';

type AccountProfileViewProps = {
  name: string;
  email: string;
  membershipLabel: string;
  profile: AccountProfile;
  studioRiders: StudioRider[];
  historyRevision: number;
  onPhotoChange: (photoUrl: string | undefined) => void;
  onClubProfileComplete: (user: AuthUser, profile: AccountProfile) => void;
};

const emptyHistory: TrainingHistoryResponse = {
  sessions: [],
  totals: { sessions: 0, bmxRaces: 0, straightSprints: 0, exploreRides: 0, distanceMeters: 0, durationMs: 0 },
};
const emptyClubState: ClubConnectState = { ownedClub: null, memberships: [] };

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

function editableAccountName(value: string) {
  const match = value.trim().match(/^(.+?)\s*\(([^()]+)\)$/u);
  return {
    fullName: (match?.[1] ?? value).trim(),
    nickname: (match?.[2] ?? '').trim(),
  };
}

function completedAccountName(fullName: string, nickname: string) {
  const cleanName = fullName.trim().replace(/\s+/g, ' ');
  const cleanNickname = nickname.trim().replace(/[()"“”]/g, '').replace(/\s+/g, ' ');
  return cleanNickname ? `${cleanName} (${cleanNickname})` : cleanName;
}

export function AccountProfileView({
  name,
  email,
  membershipLabel,
  profile,
  studioRiders,
  historyRevision,
  onPhotoChange,
  onClubProfileComplete,
}: AccountProfileViewProps) {
  const initialAccountName = useMemo(() => editableAccountName(name), [name]);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(Date.now()));
  const [history, setHistory] = useState<TrainingHistoryResponse>(emptyHistory);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('Loading your training history…');
  const [clubState, setClubState] = useState<ClubConnectState>(emptyClubState);
  const [clubStatus, setClubStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [clubMessage, setClubMessage] = useState('Loading Club Connect…');
  const [clubInviteToken, setClubInviteToken] = useState(clubInviteTokenFromUrl);
  const [clubFullNameDraft, setClubFullNameDraft] = useState(initialAccountName.fullName);
  const [clubNicknameDraft, setClubNicknameDraft] = useState(initialAccountName.nickname);
  const [clubPhotoDraft, setClubPhotoDraft] = useState(profile.photoUrl);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [clubBusyId, setClubBusyId] = useState<string | null>(null);

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

  const refreshClub = useCallback(() => {
    setClubStatus('loading');
    void loadClubConnect()
      .then((state) => {
        setClubState(state);
        setClubStatus('ready');
        setClubMessage('');
      })
      .catch((error: Error) => {
        setClubStatus('error');
        setClubMessage(`Club Connect is temporarily unavailable. ${error.message}`);
      });
  }, []);

  useEffect(() => refreshClub(), [refreshClub]);

  const memberByRiderId = useMemo(() => new Map(
    (clubState.ownedClub?.members ?? []).map((member) => [member.studioRiderId, member]),
  ), [clubState.ownedClub?.members]);
  const visibleStudioRiders = useMemo(
    () => studioRiders.filter((rider) => !rider.deletedAt).sort((left, right) => left.name.localeCompare(right.name)),
    [studioRiders],
  );
  const effectiveMembershipLabel = clubState.memberships.length > 0
    ? 'Club Athlete / free studio data access'
    : membershipLabel;

  const copyInvitation = useCallback((link: string) => {
    void navigator.clipboard?.writeText(link).then(() => {
      setClubMessage('Private invitation copied. Send it only to this athlete or their parent/guardian.');
    }).catch(() => {
      window.prompt('Copy this private Club Connect invitation:', link);
    });
  }, []);

  const inviteRider = useCallback((rider: StudioRider) => {
    setClubBusyId(rider.id);
    setClubMessage(`Creating a private invitation for ${rider.name}…`);
    void createClubInvite(rider.id)
      .then((invite) => {
        const link = clubInviteUrl(invite.token);
        setInviteLinks((current) => ({ ...current, [rider.id]: link }));
        copyInvitation(link);
        refreshClub();
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, [copyInvitation, refreshClub]);

  const acceptInvitation = useCallback(() => {
    if (!clubInviteToken) return;
    const fullName = clubFullNameDraft.trim().replace(/\s+/g, ' ');
    if (!fullName) {
      setClubMessage('Enter the athlete’s full name before connecting the studio record.');
      return;
    }
    setClubBusyId('claim');
    setClubMessage('Saving your Club Athlete profile and connecting your studio history…');
    void claimClubInvite(clubInviteToken, {
      fullName,
      nickname: clubNicknameDraft,
      photoUrl: clubPhotoDraft,
    })
      .then((result) => {
        setClubState(result);
        onClubProfileComplete(result.user, result.accountProfile);
        setClubInviteToken('');
        clearClubInviteFromUrl();
        setClubMessage('Profile complete. Your studio training history is now available in this calendar.');
        refresh();
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, [clubFullNameDraft, clubInviteToken, clubNicknameDraft, clubPhotoDraft, onClubProfileComplete, refresh]);

  const disconnectRider = useCallback((rider: StudioRider) => {
    if (!window.confirm(`Remove ${rider.name}'s access to this studio record? Their TrackLab account will remain active.`)) return;
    setClubBusyId(rider.id);
    void revokeClubMember(rider.id)
      .then((state) => {
        setClubState(state);
        setInviteLinks((current) => {
          const next = { ...current };
          delete next[rider.id];
          return next;
        });
        setClubMessage(`${rider.name}'s club access was removed. Studio records were not deleted.`);
      })
      .catch((error: Error) => setClubMessage(error.message))
      .finally(() => setClubBusyId(null));
  }, []);

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
            <b>{effectiveMembershipLabel}</b>
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

      {(clubInviteToken || clubState.memberships.length > 0 || visibleStudioRiders.length > 0) && (
        <section className="club-connect-panel" aria-label="Club Connect">
          <header>
            <div className="club-connect-title">
              <span className="club-connect-icon"><Link2 size={21} /></span>
              <div><span className="eyebrow">Club Connect</span><h2>Studio data, one athlete at a time</h2></div>
            </div>
            <span className="club-connect-security"><ShieldCheck size={16} /> Private claims</span>
          </header>

          {clubInviteToken && (
            <div className="club-profile-setup">
              <div className="club-profile-setup-copy">
                <strong>Complete your Club Athlete profile</strong>
                <p>Add the name and photo you want displayed throughout TrackLab. This will not change or disconnect your studio records.</p>
              </div>
              <div className="club-profile-setup-form">
                <RiderPhotoEditor
                  name={completedAccountName(clubFullNameDraft, clubNicknameDraft) || 'Club athlete'}
                  photoUrl={clubPhotoDraft}
                  disabled={clubBusyId === 'claim'}
                  onPhotoChange={setClubPhotoDraft}
                />
                <div className="club-profile-fields">
                  <label>
                    <span>Full name</span>
                    <input
                      autoComplete="name"
                      disabled={clubBusyId === 'claim'}
                      maxLength={64}
                      onChange={(event) => setClubFullNameDraft(event.target.value)}
                      placeholder="First and last name"
                      value={clubFullNameDraft}
                    />
                  </label>
                  <label>
                    <span>Nickname <small>optional</small></span>
                    <input
                      disabled={clubBusyId === 'claim'}
                      maxLength={28}
                      onChange={(event) => setClubNicknameDraft(event.target.value)}
                      placeholder="The Machine"
                      value={clubNicknameDraft}
                    />
                  </label>
                  <p>Race display: <strong>{completedAccountName(clubFullNameDraft, clubNicknameDraft) || 'Enter your name'}</strong></p>
                </div>
              </div>
              <button className="club-profile-complete" type="button" disabled={clubBusyId === 'claim' || !clubFullNameDraft.trim()} onClick={acceptInvitation}>
                <UserPlus size={17} /> {clubBusyId === 'claim' ? 'Connecting…' : 'Complete profile and connect'}
              </button>
            </div>
          )}

          {clubState.memberships.map((membership) => (
            <div className="club-athlete-access" key={`${membership.clubId}:${membership.studioRiderId}`}>
              <ShieldCheck size={21} />
              <div><strong>Connected to {membership.clubName}</strong><p>Studio rider: {membership.riderName}. Viewing and downloading your studio data is free. Choose “Training at {membership.clubName}” before a workout to share that session with the club.</p></div>
              <span>Club Athlete</span>
            </div>
          ))}

          {visibleStudioRiders.length > 0 && (
            <div className="club-owner-roster">
              <div className="club-owner-intro">
                <div><strong>{clubState.ownedClub?.name ?? name}</strong><p>Invite each athlete privately. A claim grants only that rider's records—not the rest of your studio roster.</p></div>
                <small>Personal Wattbike pairing at home still requires Racer membership.</small>
              </div>
              <div className="club-roster-list">
                {visibleStudioRiders.map((rider) => {
                  const member = memberByRiderId.get(rider.id);
                  const inviteLink = inviteLinks[rider.id];
                  const claimed = member?.status === 'claimed';
                  return (
                    <article key={rider.id}>
                      <RiderAvatar name={rider.name} photoUrl={rider.photoUrl} />
                      <div className="club-roster-name"><strong>{rider.name}</strong><small>{claimed ? `Connected${member.athleteName ? ` to ${member.athleteName}` : ''}` : inviteLink ? 'Invitation ready' : 'Not claimed'}</small></div>
                      <div className="club-roster-actions">
                        {inviteLink && !claimed && <button type="button" onClick={() => copyInvitation(inviteLink)}><Copy size={15} /> Copy link</button>}
                        {!claimed && <button className="primary" type="button" disabled={clubBusyId === rider.id} onClick={() => inviteRider(rider)}><UserPlus size={15} /> {inviteLink ? 'New link' : 'Invite'}</button>}
                        {claimed && <button className="danger" type="button" disabled={clubBusyId === rider.id} onClick={() => disconnectRider(rider)}><X size={15} /> Remove access</button>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
          {(clubMessage || clubStatus === 'loading') && <p className={`club-connect-message ${clubStatus}`}>{clubMessage || 'Loading Club Connect…'}</p>}
        </section>
      )}

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
                {session.club && (
                  <small>
                    {session.club.role === 'owner'
                      ? `${session.club.riderName} · Training at ${session.club.name}`
                      : `Training at ${session.club.name}`}
                  </small>
                )}
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
