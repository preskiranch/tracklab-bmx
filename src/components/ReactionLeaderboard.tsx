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

export function ReactionLeaderboard({ disabled, onPersonalBest, recordOwner, refreshKey = 0 }: {
  disabled: boolean;
  onPersonalBest: (milliseconds: number) => void;
  recordOwner: ReactionRecordOwner | null;
  refreshKey?: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(5);
  const [entries, setEntries] = useState<ReactionLeader[]>([]);
  const [profile, setProfile] = useState<ReactionProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void loadReactionProfile(recordOwner).then((next) => {
      if (!active) return;
      setProfile(next);
      setProfileError('');
      if (next.personalBestMs != null) onPersonalBest(next.personalBestMs);
    }).catch(() => {
      if (active) setProfileError('Your leaderboard settings could not load. Please try again.');
    });
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
      setProfileError('');
      if (next.personalBestMs != null) onPersonalBest(next.personalBestMs);
    }).catch(() => {
      if (active) setProfileError('Your leaderboard settings could not load. Please try again.');
    });
    return () => { active = false; };
  }, [open, limit, revision, refreshKey, onPersonalBest, recordOwner]);

  const updateParticipation = async (joined: boolean) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const next = await setReactionLeaderboardParticipation(joined, profile?.leaderboard.displayName ?? '', recordOwner);
      setProfile(next);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update your leaderboard entry.');
    } finally {
      setSaving(false);
    }
  };

  return <>
    <button type="button" className="reaction-leaderboard-trigger reaction-control-action" aria-label="Leaderboard" title="Leaderboard" disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()} onClick={() => setOpen(true)}>
      <Trophy size={15} aria-hidden="true" /> <span>Leaderboard</span>
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
          {!entries.length && !error && <p className="reaction-leaderboard-empty">Set a valid time to appear on the leaderboard.</p>}
        </>}
        <section className="reaction-leaderboard-participation" aria-label="Your leaderboard entry">
          {profileError && <p className="reaction-leaderboard-error" role="alert">{profileError} <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></p>}
          {profile?.canJoinLeaderboard ? <>
            <h3>Your leaderboard time</h3>
            <p>Signed in as <strong>{profile.leaderboard.displayName}</strong>.</p>
            <p>{profile.leaderboard.hidden
              ? 'Your time is hidden. Your personal PR still updates while you play.'
              : 'Your best valid time posts automatically under your account name when you play. A faster time replaces it automatically.'}</p>
            <div className="reaction-leaderboard-form-actions">
              <button type="button" disabled={saving || loading} onClick={() => void updateParticipation(Boolean(profile.leaderboard.hidden))}>
                {saving ? 'Saving…' : profile.leaderboard.hidden ? 'Show my time' : 'Hide my time'}
              </button>
            </div>
            <small>One best time per account. False starts do not count. Free and paid accounts are both eligible.</small>
          </> : recordOwner?.kind === 'account'
            ? !profileError && <p>Loading your account’s leaderboard settings…</p>
            : <p>Sign in to your own account to post your best time automatically. Your personal PR is still available while playing on a studio tablet.</p>}
        </section>
      </div>
    </dialog>
  </>;
}
