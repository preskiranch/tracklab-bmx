import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Link2, RefreshCw, ShieldCheck, Trophy } from 'lucide-react';
import type { DistanceUnit, SpeedUnit, TrainingSession } from '../types';
import {
  FamilyRequestError, claimFamilyClubInvitation, familyClubInviteToken,
  loadFamilyHistory, loadFamilyProfile,
  type FamilyChild, type FamilyHistory, type FamilyProfile,
} from '../lib/familyAccounts';
import { downloadTrainingSession } from '../lib/trainingHistory';
import { formatExploreDistanceMeters } from '../units';
import { RiderAvatar } from './RiderAvatar';
import { TrainingResultsSpreadsheet } from './TrainingResultsSpreadsheet';
import { TrainingTrackZoneReview } from './TrainingTrackZoneReview';

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function durationLabel(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Family records could not be loaded.';
}

export function FamilyAthleteHistory({ accountId, child, speedUnit, distanceUnit, onAccessLost, onFamilyChanged }: {
  accountId: string;
  child: FamilyChild;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  onAccessLost: () => void;
  onFamilyChanged: () => void;
}) {
  const subject = `${accountId}:${child.id}`;
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [profileState, setProfileState] = useState<{ subject: string; profile: FamilyProfile } | null>(null);
  const [historyState, setHistoryState] = useState<{ scope: string; history: FamilyHistory } | null>(null);
  const [profileError, setProfileError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [clubLink, setClubLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const alive = useRef(true);
  const denied = useRef(false);
  const actions = useRef(new Set<AbortController>());
  const busyRef = useRef(false);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;
  const range = useMemo(() => ({
    from: new Date(month.getFullYear(), month.getMonth(), 1).getTime(),
    to: new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() - 1,
  }), [month]);
  const scope = `${subject}:${dateKey(month)}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      actions.current.forEach((controller) => controller.abort());
      actions.current.clear();
    };
  }, []);

  const checkAccessError = useCallback((reason: unknown) => {
    if (reason instanceof FamilyRequestError && [401, 403, 404].includes(reason.status)) {
      denied.current = true;
      setBlocked(true);
      setProfileState(null);
      setHistoryState(null);
      actions.current.forEach((controller) => controller.abort());
      onAccessLostRef.current();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setProfileState(null);
    setProfileError('');
    void loadFamilyProfile(child.id, controller.signal).then((profile) => {
      if (!controller.signal.aborted && subjectRef.current === subject && !denied.current) {
        setProfileState({ subject, profile });
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || subjectRef.current !== subject) return;
      if (!checkAccessError(reason)) setProfileError(errorMessage(reason));
    });
    return () => controller.abort();
  }, [child.id, subject, revision, checkAccessError]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setHistoryState(null);
    setLoading(true);
    setHistoryError('');
    const refresh = async () => {
      if (pending || controller.signal.aborted || denied.current) return;
      pending = true;
      try {
        const history = await loadFamilyHistory(child.id, range.from, range.to, controller.signal);
        if (!controller.signal.aborted && scopeRef.current === scope && !denied.current) {
          setHistoryState({ scope, history });
          setHistoryError('');
        }
      } catch (reason) {
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        setHistoryState(null);
        if (!checkAccessError(reason)) setHistoryError(errorMessage(reason));
      } finally {
        pending = false;
        if (!controller.signal.aborted && scopeRef.current === scope) setLoading(false);
      }
    };
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    const timer = window.setInterval(whenVisible, 10_000);
    window.addEventListener('focus', whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [child.id, scope, range.from, range.to, revision, checkAccessError]);

  const profile = profileState?.subject === subject && !blocked ? profileState.profile : null;
  const history = historyState?.scope === scope && !blocked ? historyState.history : null;
  const sessionsByDay = useMemo(() => {
    const result = new Map<string, TrainingSession[]>();
    for (const session of history?.sessions ?? []) {
      const key = dateKey(new Date(session.startedAt));
      result.set(key, [...(result.get(key) ?? []), session]);
    }
    return result;
  }, [history]);
  const sessions = sessionsByDay.get(selectedDate) ?? [];
  const selectedDateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: first.getDay() }, () => null),
      ...Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
    ];
  }, [month]);

  async function claimClub(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || blocked || child.kind !== 'managed') return;
    const token = familyClubInviteToken(clubLink);
    if (!token) { setActionError('Paste a valid Club Connect invitation link or code.'); return; }
    const controller = new AbortController();
    actions.current.add(controller);
    busyRef.current = true;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const next = await claimFamilyClubInvitation(child.id, token, controller.signal);
      if (!alive.current || controller.signal.aborted || subjectRef.current !== subject || denied.current) return;
      setProfileState({ subject, profile: next });
      setClubLink('');
      setNotice(`Studio records connected to ${child.name}. Your parent profile is unchanged.`);
      setRevision((value) => value + 1);
      onFamilyChanged();
    } catch (reason) {
      if (!alive.current || controller.signal.aborted || subjectRef.current !== subject) return;
      if (!checkAccessError(reason)) setActionError(errorMessage(reason));
    } finally {
      actions.current.delete(controller);
      busyRef.current = false;
      if (alive.current && subjectRef.current === subject) setBusy(false);
    }
  }

  async function exportRecords(format: 'workbook' | 'json' | 'csv', sessionId?: string) {
    if (busyRef.current || blocked || !history) return;
    const controller = new AbortController();
    actions.current.add(controller);
    const requestedScope = scope;
    const requestedDate = selectedDate;
    busyRef.current = true;
    setBusy(true); setActionError(''); setNotice('');
    try {
      // Recheck current authorization before an export; never export another child's stale view.
      const fresh = await loadFamilyHistory(child.id, range.from, range.to, controller.signal);
      if (!alive.current || controller.signal.aborted || scopeRef.current !== requestedScope || denied.current) return;
      const day = fresh.sessions.filter((session) => dateKey(new Date(session.startedAt)) === requestedDate);
      if (format === 'workbook') {
        if (day.length === 0) throw new Error('No activity records are available for this date.');
        const { downloadTrainingDaySpreadsheet } = await import('../lib/trainingSpreadsheetExport');
        if (!alive.current || controller.signal.aborted || scopeRef.current !== requestedScope || denied.current) return;
        await downloadTrainingDaySpreadsheet(day, requestedDate);
      } else {
        const session = day.find((candidate) => candidate.id === sessionId);
        if (!session) throw new Error('This activity record is no longer available. Refresh the calendar.');
        downloadTrainingSession(session, format);
      }
      if (alive.current && scopeRef.current === requestedScope) setNotice(`Activity file prepared for ${child.name}. Health data is excluded.`);
    } catch (reason) {
      if (!alive.current || controller.signal.aborted || scopeRef.current !== requestedScope) return;
      if (!checkAccessError(reason)) setActionError(errorMessage(reason));
    } finally {
      actions.current.delete(controller);
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const changeMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next); setSelectedDate(dateKey(next)); setNotice(''); setActionError('');
  };

  if (blocked) return <div className="family-notice" role="status">Access to this family profile is no longer available. Choose another profile or refresh Family.</div>;

  return (
    <section className="family-athlete" aria-label={`${child.name}'s activity history`}>
      <header className="family-athlete-header">
        <RiderAvatar name={child.name} photoUrl={profile?.accountProfile.photoUrl ?? child.photoUrl} accent="#1d1d1f" />
        <div><span className="eyebrow">{child.kind === 'managed' ? 'Parent-managed profile' : 'Linked athlete'}</span><h2>{child.name}</h2><p>Viewing this profile does not change who is training.</p></div>
        <button type="button" className="family-icon-button" aria-label={`Refresh ${child.name}'s records`} onClick={() => setRevision((value) => value + 1)} disabled={busy}><RefreshCw size={18} /></button>
      </header>
      {profileError && <p className="family-error" role="alert">{profileError}</p>}
      <section className="family-records" aria-label={`${child.name}'s personal records`}>
        <article><Trophy size={19} /><span>Reaction Test best</span><strong>{profile ? profile.accountProfile.personalRecords?.reactionTestBestMs != null ? `${(profile.accountProfile.personalRecords.reactionTestBestMs / 1_000).toFixed(3)} sec` : 'Not recorded' : '—'}</strong></article>
        <article><Trophy size={19} /><span>Get Pulled max watts</span><strong>{profile ? profile.accountProfile.personalRecords?.getPulledMaxWatts != null ? `${Math.round(profile.accountProfile.personalRecords.getPulledMaxWatts)} W` : 'Not recorded' : '—'}</strong></article>
      </section>
      {child.kind === 'managed' && (
        <section className="family-club-connect" aria-labelledby={`family-club-${child.id}`}>
          <h3 id={`family-club-${child.id}`}><Link2 size={18} /> Connect a studio record</h3>
          <p>Ask the studio owner for this child’s unclaimed Club Connect invitation. Connecting it brings that athlete’s studio history into this profile without giving your child an email or login.</p>
          <form onSubmit={(event) => { void claimClub(event); }}>
            <label><span>Child’s Club Connect invitation</span><input value={clubLink} onChange={(event) => setClubLink(event.target.value)} placeholder="Paste the private invitation link or code" autoComplete="off" maxLength={2048} disabled={busy} /></label>
            <button type="submit" className="family-primary" disabled={busy || !clubLink.trim()}>Connect studio record</button>
          </form>
          <p className="family-fine-print">In a studio session, choose this child’s athlete record on the authorized Club Tablet. Viewing Family alone does not save home workouts to a child.</p>
        </section>
      )}
      {profile && profile.memberships.length > 0 && <div className="family-club-list">{profile.memberships.map((club) => <span key={`${club.clubId}:${club.studioRiderId}`}><ShieldCheck size={15} /> {club.riderName} · {club.clubName}</span>)}</div>}
      <section className="family-month-summary" aria-label={`${child.name}'s monthly statistics`}>
        {[
          ['Sessions', history?.totals.sessions], ['BMX races', history?.totals.bmxRaces],
          ['Straight sprints', history?.totals.straightSprints], ['Explore rides', history?.totals.exploreRides],
          ['Get Pulled', history?.totals.getPulledTests], ['Monitor sprints', history?.totals.monitorSprints],
        ].map(([label, value]) => <article key={label}><strong>{value ?? '—'}</strong><span>{label}</span></article>)}
        <article><strong>{history ? formatExploreDistanceMeters(history.totals.distanceMeters, distanceUnit === 'm' ? 'km' : 'mi') : '—'}</strong><span>Total distance</span></article>
        <article><strong>{history ? durationLabel(history.totals.durationMs) : '—'}</strong><span>Training time</span></article>
      </section>
      <section className="family-calendar" aria-label={`${child.name}'s training calendar`}>
        <header><h3><CalendarDays size={20} /> {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><div><button type="button" className="family-icon-button" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button><button type="button" className="family-icon-button" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button></div></header>
        <div className="family-calendar-grid family-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="family-calendar-grid">{days.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const key = dateKey(day);
          const count = sessionsByDay.get(key)?.length ?? 0;
          return <button key={key} type="button" aria-pressed={key === selectedDate} className={key === selectedDate ? 'selected' : ''} aria-label={`${day.toLocaleDateString()}, ${count} training sessions for ${child.name}`} onClick={() => { setSelectedDate(key); setNotice(''); }}><b>{day.getDate()}</b>{count > 0 && <small>{count}</small>}</button>;
        })}</div>
        {loading && <p role="status">Loading {child.name}’s activity records…</p>}
        {historyError && <p className="family-error" role="alert">{historyError}</p>}
        {history && history.sessions.length === 0 && <p>No saved activity records for this child in this month.</p>}
      </section>
      {history && <TrainingResultsSpreadsheet
        key={`${subject}:${selectedDate}`}
        sessions={sessions} dateLabel={`${child.name} · ${selectedDateLabel}`} speedUnit={speedUnit} distanceUnit={distanceUnit}
        onExportWorkbook={busy ? undefined : () => { void exportRecords('workbook'); }}
        exportLabel="Numbers / Excel"
        renderSessionDetail={(session) => <div className="family-session-detail">
          <TrainingTrackZoneReview session={session} speedUnit={speedUnit} distanceUnit={distanceUnit} />
          <div className="family-actions"><button type="button" disabled={busy} onClick={() => { void exportRecords('json', session.id); }}><Download size={15} /> JSON</button><button type="button" disabled={busy} onClick={() => { void exportRecords('csv', session.id); }}><Download size={15} /> CSV</button></div>
        </div>}
      />}
      {actionError && <p className="family-error" role="alert">{actionError}</p>}
      {notice && <p className="family-notice" role="status">{notice}</p>}
      <p className="family-fine-print">Family activity includes this athlete’s cycling results and power. Apple Watch and other health data are not shared or included in these downloads. Reaction Test best is shown separately from the training calendar.</p>
    </section>
  );
}
