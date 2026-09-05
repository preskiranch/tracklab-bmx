import { Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatReactionTime } from '../lib/reactionTest';
import {
  loadReactionLeaderboard,
  loadReactionProfile,
  setReactionLeaderboardParticipation,
  type ReactionLeader,
  type ReactionProfile,
  type ReactionRecordOwner,
} from '../lib/reactionTestCloud';
import './ReactionLeaderboard.css';

export function ReactionLeaderboard({ disabled, onPersonalBest, recordOwner }: {
  disabled: boolean;
  onPersonalBest: (milliseconds: number) => void;
  recordOwner: ReactionRecordOwner | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(5);
  const [entries, setEntries] = useState<ReactionLeader[]>([]);
  const [profile, setProfile] = useState<ReactionProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void loadReactionProfile(recordOwner).then((next) => {
      if (!active) return;
      setProfile(next);
      setDisplayName(next.leaderboard.displayName);
      if (next.personalBestMs != null) onPersonalBest(next.personalBestMs);
    }).catch(() => { /* Playing remains available when the board is offline. */ });
    return () => { active = false; };
  }, [onPersonalBest, recordOwner]);

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!open && dialogRef.current?.open) dialogRef.current?.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void loadReactionLeaderboard(limit, recordOwner).then((board) => {
      if (!active) return;
      setEntries(board.entries);
    }).catch((cause: Error) => {
      if (active) setError(cause.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    void loadReactionProfile(recordOwner).then((next) => {
      if (!active) return;
      setProfile(next);
      setDisplayName(next.leaderboard.displayName);
      if (next.personalBestMs != null) onPersonalBest(next.personalBestMs);
    }).catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, [open, limit, revision, onPersonalBest, recordOwner]);

  const updateParticipation = async (joined: boolean) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await setReactionLeaderboardParticipation(joined, displayName.trim(), recordOwner);
      setProfile(next);
      setDisplayName(next.leaderboard.displayName);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your leaderboard entry.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <button type="button" className="reaction-leaderboard-trigger reaction-control-action" disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => setOpen(true)}>
      <Trophy size={15} aria-hidden="true" /> Leaderboard
    </button>
    <dialog ref={dialogRef} className="reaction-leaderboard-dialog reaction-control-action" aria-labelledby="reaction-leaderboard-title"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header>
        <div><span className="reaction-leaderboard-eyebrow">REACTION TEST</span><h2 id="reaction-leaderboard-title">Reaction time leaderboard</h2></div>
        <button type="button" className="reaction-leaderboard-close" aria-label="Close leaderboard" onClick={() => setOpen(false)}><X size={22} /></button>
      </header>
      <div className="reaction-leaderboard-scroll">
        <div className="reaction-leaderboard-toolbar">
          <p>Best valid time per rider, measured from the first red tone.</p>
          <label>Show<select aria-label="Leaderboard size" value={limit} disabled={saving}
            onChange={(event) => setLimit(Number(event.target.value))}>
            {[5, 10, 25, 50].map((count) => <option key={count} value={count}>Top {count}</option>)}
          </select></label>
        </div>
        {error && <p className="reaction-leaderboard-error" role="alert">{error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></p>}
        {loading ? <p role="status">Loading leaderboard…</p> : <>
          <table className="reaction-leaderboard-table">
            <thead><tr><th scope="col">Rank</th><th scope="col">Rider</th><th scope="col">Time</th></tr></thead>
            <tbody>{entries.map((entry) => <tr key={entry.rank} className={entry.isYou ? 'is-you' : undefined}>
              <td>{entry.rank}</td><th scope="row">{entry.displayName}{entry.isYou && <small> You</small>}</th>
              <td>{formatReactionTime(entry.reactionTimeMs)} sec</td>
            </tr>)}</tbody>
          </table>
          {!entries.length && !error && <p className="reaction-leaderboard-empty">Be the first to set a time and join the leaderboard.</p>}
        </>}
        <section className="reaction-leaderboard-participation" aria-label="Your leaderboard entry">
          {profile?.canJoinLeaderboard ? <>
            <h3>{profile.leaderboard.joined ? 'Your public entry' : 'Join with your free account'}</h3>
            <p>Your chosen name and best time will be public. False starts do not count. You can leave at any time.</p>
            <form onSubmit={(event) => { event.preventDefault(); void updateParticipation(true); }}>
              <label>Leaderboard display name<input aria-label="Leaderboard display name" value={displayName} minLength={2} maxLength={32}
                autoComplete="nickname" required disabled={saving || loading} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <div className="reaction-leaderboard-form-actions">
                <button type="submit" disabled={saving || loading || displayName.trim().length < 2}>{saving ? 'Saving…' : profile.leaderboard.joined ? 'Save display name' : 'Join leaderboard'}</button>
                {profile.leaderboard.joined && <button type="button" disabled={saving || loading} onClick={() => void updateParticipation(false)}>Leave leaderboard</button>}
              </div>
            </form>
            <small>Only times recorded in Reaction Test qualify. Set a new time after this update to appear.</small>
          </> : <p>Sign in to your own free account to join the leaderboard. Your personal PR is still available while playing on a studio tablet.</p>}
        </section>
      </div>
    </dialog>
  </>;
}
