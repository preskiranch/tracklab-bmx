import { useEffect, useState } from 'react';
import { acceptChildDevice, type AuthUser } from '../lib/auth';
import { childDeviceRequest } from '../lib/childDevices';
import './FamilyAccounts.css';

export function ChildPhoneSetup({ childId, name }: { childId: string; name: string }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  async function perform(revoke: boolean) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await childDeviceRequest(`/api/family/children/${encodeURIComponent(childId)}/${revoke ? 'devices' : 'device-invite'}`, revoke ? undefined : {}, revoke ? 'DELETE' : 'POST');
      setLink(revoke ? '' : result.url); setConfirmRevoke(false);
      setNotice(revoke ? 'Device sign-ins and pending setup links have been canceled. Saved records are kept.' : 'Open this private link on the child’s phone within 15 minutes. It works once. Creating another link replaces this pending link.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="family-card" aria-label={`${name} phone setup`}>
    <h2>Set up {name}’s phone</h2>
    <p>The child gets their own profile, training history, and recording identity. No child email or parent password is needed. Studio records stay connected.</p>
    <p>Install the TrackLab beta through TestFlight on each iPhone, then open the setup link on the child’s phone. TestFlight access is separate from this account link.</p>
    <button type="button" className="family-primary" disabled={busy} onClick={() => void perform(false)}>Create child-phone setup link</button>
    {link && <div className="family-created-link"><label>Private child-phone setup link<input readOnly value={link} onFocus={(event) => event.target.select()} /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setNotice('Setup link copied. Open it on the child’s phone.'), () => setNotice('Select and copy the link above.')); }}>Copy setup link</button></div>}
    <p>The child’s phone records as {name}. Your Family view shows their synced training. On the child’s iPhone, use Watch Connect for their paired Apple Watch, then approve studio sharing when training at the club.</p>
    <button type="button" disabled={busy} onClick={() => setConfirmRevoke(true)}>Sign out child’s devices</button>
    {confirmRevoke && <div className="family-confirm"><p>Sign out all of {name}’s devices and cancel pending setup links? Their saved training will remain.</p><button type="button" disabled={busy} onClick={() => void perform(true)}>Confirm device sign-out</button><button type="button" disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</button></div>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="family-error">{error}</p>}
  </section>;
}

export function ChildDeviceInvitation({ token, user, loading, onAccepted, onClose, onSignOut }: {
  token: string; user: AuthUser | null; loading: boolean; onAccepted: (user: AuthUser) => void | Promise<void>; onClose: () => void; onSignOut: () => void;
}) {
  const [preview, setPreview] = useState<{ name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void childDeviceRequest('/api/auth/child-device/preview', { token }, 'POST', controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPreview(result); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [token]);
  async function accept() {
    if (busy) return; setBusy(true); setError('');
    try {
      const next = await acceptChildDevice(token);
      if (!next?.managedChild) throw new Error('Child sign-in could not be confirmed.');
      await onAccepted(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="child-setup-overlay"><section className="family-card child-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="child-setup-title">
    <h1 id="child-setup-title">{preview ? `Set up ${preview.name}’s phone` : 'Child phone setup'}</h1>
    {preview && <p>This phone will show {preview.name}’s own profile and record their workouts. Their parent can monitor synced training from Family.</p>}
    {user ? <><p>You’re signed in as {user.name}. Open this link on the child’s phone, or sign out here before continuing. This does not claim records for the current account.</p><button type="button" onClick={onSignOut}>Sign out of {user.name}’s account</button></> : <button type="button" className="family-primary" disabled={!preview || busy || loading} onClick={() => void accept()}>{busy ? 'Setting up…' : `This is ${preview?.name ?? 'the athlete'}’s phone — continue`}</button>}
    {error && <p role="alert" className="family-error">{error}</p>}
    <button type="button" disabled={busy} onClick={onClose}>Close</button>
  </section></div>;
}
