import { useEffect, useState, type FormEvent } from 'react';
import { Copy, FlaskConical, Mail, RefreshCcw } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import type { AuthUser } from '../lib/auth';
import {
  betaFeedbackHref, createBetaInvitation, readBetaAccess, readBetaAdmin, revokeBetaAccess,
  type BetaAdminState, type BetaGrant,
} from '../lib/betaAccess';
import './BetaTesting.css';

function dateLabel(value: number) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function BetaTestingPanel({ user, focusRequested = false, onFocusHandled }: {
  user: AuthUser; focusRequested?: boolean; onFocusHandled?: () => void;
}) {
  const [beta, setBeta] = useState<BetaGrant | null>(null);
  const [admin, setAdmin] = useState<BetaAdminState | null>(null);
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(4);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createdLink, setCreatedLink] = useState<{ email: string; url: string } | null>(null);
  const [version, setVersion] = useState('Web');

  useEffect(() => {
    if (!focusRequested) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById('beta-testing')?.scrollIntoView({ block: 'start', behavior: 'instant' });
      onFocusHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequested, onFocusHandled]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readBetaAccess(), user.admin ? readBetaAdmin() : Promise.resolve(null)])
      .then(([own, management]) => {
        if (!cancelled) { setBeta(own.beta); setAdmin(management); }
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App }) => App.getInfo()).then((info) => {
        if (!cancelled) setVersion(`${info.version} (${info.build})`);
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [user.id, user.admin]);

  async function refresh() {
    const [own, management] = await Promise.all([readBetaAccess(), user.admin ? readBetaAdmin() : Promise.resolve(null)]);
    setBeta(own.beta); setAdmin(management);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await createBetaInvitation(email.trim(), seats, days);
      setCreatedLink({ email: result.invite.email, url: result.claimUrl });
      setEmail('');
      setNotice('Invitation created. Copy the link and share it with this tester.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the invitation.');
    } finally { setBusy(false); }
  }

  async function revoke(target: { inviteId: string } | { grantId: string }) {
    setBusy(true); setError(''); setNotice('');
    try {
      await revokeBetaAccess(target);
      setNotice('Beta access revoked.'); setCreatedLink(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke access.');
    } finally { setBusy(false); }
  }

  return (
    <section className="beta-testing app-settings-card" id="beta-testing" aria-labelledby="beta-testing-heading">
      <header><div><span className="eyebrow">Early access</span><h2 id="beta-testing-heading">Beta Testing</h2></div><FlaskConical size={22} /></header>
      <p>Train with your Wattbike, upload your records, and race other riders’ ghosts. Live multiplayer is coming soon.</p>
      {loading ? <p role="status">Loading beta access…</p> : beta?.active ? (
        <div className="beta-access-summary"><strong>{beta.bikeSeats} Wattbike connection{beta.bikeSeats === 1 ? '' : 's'} included</strong><span>Beta access through {dateLabel(beta.expiresAt)}. No purchase required.</span></div>
      ) : !user.admin && <p>Beta Wattbike access is available by invitation. Open your personal invitation link to activate it.</p>}
      <a className="beta-action" href={betaFeedbackHref(typeof navigator === 'undefined' ? '' : navigator.userAgent, version)}><Mail size={17} /> Send beta feedback</a>
      <small>Your email app opens with a feedback template. You can review it and attach screenshots before sending.</small>
      {error && <p className="beta-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {user.admin && <>
        <div className="beta-section-heading"><h3>Invite a tester</h3><button className="beta-action" type="button" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void refresh().catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false));
        }}><RefreshCcw size={15} /> Refresh</button></div>
        <p>Each link is for one email address and expires in 7 days. The beta period starts when the tester accepts.</p>
        <form onSubmit={(event) => { void create(event); }} className="beta-invite-form">
          <label>Tester email<input type="email" autoComplete="off" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Wattbikes<select value={seats} onChange={(event) => setSeats(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Days of access<select value={days} onChange={(event) => setDays(Number(event.target.value))}>{[30, 60, 90].map((value) => <option key={value} value={value}>{value} days</option>)}</select></label>
          <button className="beta-action beta-primary" type="submit" disabled={busy || !email.trim()}>{busy ? 'Working…' : 'Create invitation'}</button>
        </form>
        {createdLink && <div className="beta-created-link">
          <strong>Invitation for {createdLink.email}</strong>
          <label>Personal invitation link<input readOnly value={createdLink.url} onFocus={(event) => event.target.select()} /></label>
          <button className="beta-action" type="button" onClick={() => {
            if (!navigator.clipboard) { setNotice('Select and copy the invitation link above.'); return; }
            void navigator.clipboard.writeText(createdLink.url).then(() => setNotice('Invitation link copied.')).catch(() => setNotice('Select and copy the invitation link above.'));
          }}><Copy size={16} /> Copy link</button>
          <small>Copy this link now. It is shown only when created.</small>
        </div>}
        {admin && <>
          <h3>Testers</h3>
          <small>Revoking beta access keeps the tester’s saved records and any active paid subscription.</small>
          {admin.grants.length === 0 ? <p>No testers have activated access yet.</p> : <ul className="beta-access-list">{admin.grants.map((grant) => {
            const active = !grant.revokedAt && grant.expiresAt > Date.now();
            return <li key={grant.id}><div><strong>{grant.email}</strong><small>{grant.bikeSeats} bike{grant.bikeSeats === 1 ? '' : 's'} · {grant.revokedAt ? 'Revoked' : `${active ? 'Until' : 'Expired'} ${dateLabel(grant.expiresAt)}`}</small></div>{active && <button className="beta-action" disabled={busy} type="button" onClick={() => { void revoke({ grantId: grant.id }); }} aria-label={`Revoke beta access for ${grant.email}`}>Revoke access</button>}</li>;
          })}</ul>}
          <h3>Invitations</h3>
          {admin.invites.length === 0 ? <p>No invitations yet.</p> : <ul className="beta-access-list">{admin.invites.map((invite) => {
            const pending = !invite.claimedAt && !invite.revokedAt && invite.expiresAt > Date.now();
            return <li key={invite.id}><div><strong>{invite.email}</strong><small>{invite.claimedAt ? 'Accepted' : invite.revokedAt ? 'Revoked' : pending ? `Accept by ${dateLabel(invite.expiresAt)}` : 'Expired'} · {invite.bikeSeats} bikes / {invite.durationDays} days</small></div>{pending && <button className="beta-action" disabled={busy} type="button" onClick={() => { void revoke({ inviteId: invite.id }); }} aria-label={`Revoke invitation for ${invite.email}`}>Revoke invite</button>}</li>;
          })}</ul>}
        </>}
      </>}
    </section>
  );
}
