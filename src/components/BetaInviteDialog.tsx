import { useEffect, useRef, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import type { AuthUser } from '../lib/auth';
import { acceptBetaInvitation } from '../lib/betaAccess';
import './BetaTesting.css';

export function BetaInviteDialog({ token, user, open, onClose, onSignIn, onAccepted }: {
  token: string; user: AuthUser | null; open: boolean;
  onClose: () => void; onSignIn: () => void; onAccepted: (user: AuthUser) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setBusy(false);
    setError('');
    if (open) dialog.current?.showModal(); else dialog.current?.close();
    return () => { generation.current += 1; };
  }, [open, token, user?.id]);
  async function accept() {
    if (!user || busy) return;
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await acceptBetaInvitation(token);
      if (request !== generation.current) return;
      if (result.user.id !== user.id) throw new Error('The account changed. Please sign in again.');
      onAccepted(result.user);
    } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : 'Could not activate beta access.');
    } finally { if (request === generation.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="beta-invite-dialog" aria-labelledby="beta-invite-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <button type="button" className="beta-dialog-close" aria-label="Close beta invitation" disabled={busy} onClick={onClose}><X size={22} /></button>
    <FlaskConical size={30} aria-hidden="true" /><span className="eyebrow">You’re invited</span>
    <h2 id="beta-invite-title">Test TrackLab BMX</h2>
    <p>Connect your Wattbike without a purchase, save your race records online, and race other riders’ ghosts.</p>
    {user ? <><p>Activate using <strong>{user.email}</strong>. This must match the email on your invitation.</p><button className="beta-action beta-primary" type="button" disabled={busy} onClick={() => { void accept(); }}>{busy ? 'Activating…' : 'Activate beta access'}</button></> : <><p>Create a free account or sign in with the email that received this invitation.</p><button type="button" className="beta-action beta-primary" onClick={onSignIn}>Create account or sign in</button></>}
    {error && <p className="beta-error" role="alert">{error}</p>}
    <small>Live multiplayer is coming soon. Feedback is available under More → Beta Testing.</small>
  </dialog>;
}
