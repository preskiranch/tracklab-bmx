import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, Copy, Link2, RefreshCw, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import type { DistanceUnit, SpeedUnit } from '../types';
import {
  FamilyRequestError, acceptFamilyInvitation, createFamilyChild, createFamilyInvitation,
  loadFamily, previewFamilyInvitation, removeFamilyChild, restoreFamilyChild, revokeFamilyInvitation, revokeFamilyShare,
  type FamilyInvitationPreview, type FamilyState,
} from '../lib/familyAccounts';
import { FamilyAthleteHistory } from './FamilyAthleteHistory';
import { RiderAvatar } from './RiderAvatar';
import './FamilyAccounts.css';
import { ChildPhoneSetup } from './ChildPhoneSetup';

type FamilyAccountsProps = {
  accountId: string;
  accountName: string;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
};

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'This family action could not be completed. Try again.';
}

function displayDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function FamilyAccounts(props: FamilyAccountsProps) {
  // An account switch discards all private view state and aborts its outstanding requests.
  return <FamilyAccountsContent key={props.accountId} {...props} />;
}

function FamilyAccountsContent({ accountId, accountName, speedUnit, distanceUnit }: FamilyAccountsProps) {
  const [family, setFamily] = useState<FamilyState | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [guardian, setGuardian] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimLink, setClaimLink] = useState<{ id: string; url: string; expiresAt: number } | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: 'child' | 'share'; id: string } | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const loadVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const actionControllers = useRef(new Set<AbortController>());
  const linkInput = useRef<HTMLInputElement>(null);
  const formId = useId();

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const next = await loadFamily(controller.signal);
      if (!alive.current || controller.signal.aborted || version !== loadVersion.current) return;
      setFamily(next);
      setSelectedId((current) => next.children.some((child) => child.id === current) ? current : '');
      setClaimLink((current) => current && next.invitations.some((invite) => invite.id === current.id && invite.revokedAt == null && invite.claimedAt == null && invite.expiresAt > Date.now()) ? current : null);
      setError('');
    } catch (reason) {
      if (!alive.current || controller.signal.aborted || version !== loadVersion.current) return;
      // Clear private records whenever the current permission cannot be revalidated.
      setFamily(null); setSelectedId(''); setClaimLink(null); setConfirmation(null);
      setError(errorMessage(reason));
    } finally {
      if (alive.current && !controller.signal.aborted && version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const whenVisible = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refresh(); };
    const timer = window.setInterval(whenVisible, 15_000);
    window.addEventListener('focus', whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    return () => {
      alive.current = false;
      loadController.current?.abort();
      actionControllers.current.forEach((controller) => controller.abort());
      actionControllers.current.clear();
      window.clearInterval(timer);
      window.removeEventListener('focus', whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [refresh]);

  async function perform(action: string, execute: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    actionControllers.current.add(controller);
    setBusy(action); setError(''); setNotice('');
    try {
      await execute(controller.signal);
    } catch (reason) {
      if (!alive.current || controller.signal.aborted) return;
      if (reason instanceof FamilyRequestError && [401, 403].includes(reason.status)) {
        setFamily(null); setSelectedId(''); setClaimLink(null); setConfirmation(null);
      }
      setError(errorMessage(reason));
    } finally {
      actionControllers.current.delete(controller);
      busyRef.current = false;
      if (alive.current) setBusy('');
    }
  }

  function createChild(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !guardian) return;
    void perform('create-child', async (signal) => {
      const child = await createFamilyChild(name, signal);
      if (!alive.current || signal.aborted) return;
      setName(''); setGuardian(false);
      await refresh();
      if (!alive.current || signal.aborted) return;
      setSelectedId(child.id);
      setNotice(`${child.name}’s family profile is ready. Connect the child’s studio invitation to view their saved records.`);
    });
  }

  function createLink() {
    void perform('create-link', async (signal) => {
      const result = await createFamilyInvitation(signal);
      if (!alive.current || signal.aborted) return;
      await refresh();
      if (!alive.current || signal.aborted) return;
      setClaimLink({ id: result.invite.id, url: result.claimUrl, expiresAt: result.invite.expiresAt });
      setNotice('Permission link ready. The athlete must open it in their own account and approve sharing.');
    });
  }

  async function copyLink() {
    if (!claimLink) return;
    try {
      await navigator.clipboard.writeText(claimLink.url);
      if (alive.current) setNotice('Permission link copied. Share it privately with the athlete you want to link.');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setNotice('Select and copy the permission link, then share it privately with the athlete.');
    }
  }

  const selectedChild = family?.children.find((child) => child.id === selectedId) ?? null;
  const pendingInvitations = family?.invitations.filter((invite) => invite.revokedAt == null && invite.claimedAt == null && invite.expiresAt > Date.now()) ?? [];
  const confirmedChild = confirmation?.kind === 'child' ? family?.children.find((child) => child.id === confirmation.id) : undefined;
  const confirmedShare = confirmation?.kind === 'share' ? family?.sharedWith.find((share) => share.id === confirmation.id) : undefined;

  function removeSelectedChild() {
    if (!confirmedChild) return;
    const child = confirmedChild;
    void perform(`remove-${child.id}`, async (signal) => {
      await removeFamilyChild(child.id, signal);
      if (!alive.current || signal.aborted) return;
      setSelectedId(''); setConfirmation(null);
      setFamily((current) => current ? { ...current, children: current.children.filter((item) => item.id !== child.id) } : null);
      setNotice(child.kind === 'managed' ? `${child.name}’s profile was archived. Their stored records are preserved and you can restore the profile below.` : `${child.name} was removed from Family. Their stored records have been preserved.`);
      await refresh();
    });
  }

  function stopSharing() {
    if (!confirmedShare) return;
    const share = confirmedShare;
    void perform(`revoke-${share.id}`, async (signal) => {
      await revokeFamilyShare(share.id, signal);
      if (!alive.current || signal.aborted) return;
      setConfirmation(null);
      setFamily((current) => current ? { ...current, sharedWith: current.sharedWith.filter((item) => item.id !== share.id) } : null);
      setNotice(`${share.parentName} can no longer access your records through Family. Your records remain in your account.`);
      await refresh();
    });
  }

  return <section className="family-accounts" aria-labelledby={`${formId}-title`}>
    <header className="family-intro">
      <div><span className="family-kicker"><Users size={18} /> Family accounts</span><h1 id={`${formId}-title`}>Their progress. One place.</h1><p>Create a profile for a child without an email, or ask an athlete with an existing account to share their records with {accountName}.</p></div>
      <button type="button" className="family-icon-button" aria-label="Refresh family access" disabled={Boolean(busy)} onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={19} /></button>
    </header>
    <p className="family-privacy"><ShieldCheck size={19} /><span>Family shares activity results and cycling power. Apple Watch and other health data remain private. Selecting a child only changes the records you view.</span></p>
    {error && <p className="family-error" role="alert">{error}</p>}
    {notice && <p className="family-notice" role="status">{notice}</p>}
    {loading && <p role="status">Loading family access…</p>}
    {family && <>
      <details className="family-setup" open={family.children.length === 0}><summary>Add or link a child</summary><div className="family-setup-grid">
        <section className="family-card" aria-labelledby={`${formId}-create`}>
          <UserPlus size={23} /><h2 id={`${formId}-create`}>Create a child profile</h2><p>For a child you manage who does not have an account. No email or password is needed for the child.</p>
          <form onSubmit={createChild}><label htmlFor={`${formId}-name`}>Child’s name</label><input id={`${formId}-name`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name shown on their records" autoComplete="off" maxLength={80} required disabled={Boolean(busy)} /><label className="family-consent"><input type="checkbox" checked={guardian} onChange={(event) => setGuardian(event.target.checked)} required disabled={Boolean(busy)} /><span>I am this child’s parent or guardian and am authorized to manage this profile.</span></label><button className="family-primary" type="submit" disabled={Boolean(busy) || !name.trim() || !guardian}>{busy === 'create-child' ? 'Creating profile…' : 'Create child profile'}</button></form>
        </section>
        <section className="family-card" aria-labelledby={`${formId}-link`}>
          <Link2 size={23} /><h2 id={`${formId}-link`}>Link an existing athlete</h2><p>Create a private permission link. The athlete opens it, signs in to their own account, and chooses whether to share activity and power with you.</p>
          <button type="button" className="family-primary" onClick={createLink} disabled={Boolean(busy)}>{busy === 'create-link' ? 'Creating link…' : 'Create permission link'}</button>
          {claimLink && <div className="family-created-link"><label htmlFor={`${formId}-link-url`}>Private permission link</label><input ref={linkInput} id={`${formId}-link-url`} value={claimLink.url} readOnly onFocus={(event) => event.target.select()} /><button type="button" onClick={() => { void copyLink(); }}><Copy size={16} /> Copy link</button><small>One use. Expires {displayDate(claimLink.expiresAt)}.</small></div>}
        </section>
      </div></details>
      <section className="family-children" aria-labelledby={`${formId}-profiles`}>
        <h2 id={`${formId}-profiles`}>Choose a family profile</h2><p>Each child keeps separate personal records, monthly statistics, and activity history.</p>
        {family.children.length === 0 ? <div className="family-empty"><Users size={26} /><p>Your family profiles will appear here after you create a child profile or an athlete approves your permission link.</p></div> : <div className="family-profile-list" role="group" aria-label="Family profiles">{family.children.map((child) => <button key={child.id} type="button" className={selectedId === child.id ? 'family-profile selected' : 'family-profile'} aria-pressed={selectedId === child.id} onClick={() => { setSelectedId(child.id); setConfirmation(null); setNotice(''); }}><RiderAvatar name={child.name} photoUrl={child.photoUrl} accent="#1d1d1f" /><span><strong>{child.name}</strong><small>{child.kind === 'managed' ? 'Parent-managed' : 'Linked account'}</small></span>{selectedId === child.id && <Check size={19} aria-hidden="true" />}</button>)}</div>}
      </section>
      {selectedChild ? <>
        {selectedChild.kind === 'managed' && <ChildPhoneSetup key={selectedChild.id} childId={selectedChild.id} name={selectedChild.name} />}
        <FamilyAthleteHistory key={`${accountId}:${selectedChild.id}`} accountId={accountId} child={selectedChild} speedUnit={speedUnit} distanceUnit={distanceUnit} onAccessLost={() => { setSelectedId(''); setNotice('Family access changed. These records have been cleared.'); void refresh(); }} onFamilyChanged={() => { void refresh(); }} />
        <div className="family-remove"><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ kind: 'child', id: selectedChild.id })}>{selectedChild.kind === 'managed' ? `Archive ${selectedChild.name}’s profile` : `Remove ${selectedChild.name} from family`}</button><p>{selectedChild.kind === 'managed' ? 'Stored activity records are preserved. You can restore this profile from Archived child profiles.' : 'Ends your access to this athlete. Their account and records are preserved.'}</p></div>
      </> : family.children.length > 0 && <p className="family-notice">Choose a child above to view their own profile and activity calendar.</p>}
      {confirmedChild && <div className="family-confirm" role="region" aria-label="Confirm removal from family"><h3>{confirmedChild.kind === 'managed' ? `Archive ${confirmedChild.name}’s profile?` : `Remove ${confirmedChild.name} from Family?`}</h3><p>{confirmedChild.kind === 'managed' ? 'This managed profile will be archived in your family. Its stored records will not be erased, and you can restore it later.' : 'You will lose access to this athlete’s records. Their independent account and saved records will stay intact.'}</p><div className="family-actions"><button type="button" className="family-primary" disabled={Boolean(busy)} onClick={removeSelectedChild}>{confirmedChild.kind === 'managed' ? 'Confirm archive' : 'Confirm removal'}</button><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>Keep in family</button></div></div>}
      {family.archivedChildren.length > 0 && <details className="family-archived"><summary>Archived child profiles ({family.archivedChildren.length})</summary><p>These managed profiles and their stored records were kept. Restore a child to view their history again.</p><div className="family-sharing"><ul>{family.archivedChildren.map((child) => <li key={child.id}><div><strong>{child.name}</strong><span>Parent-managed · Records preserved</span></div><button type="button" disabled={Boolean(busy)} onClick={() => { void perform(`restore-${child.id}`, async (signal) => { await restoreFamilyChild(child.id, signal); if (!alive.current || signal.aborted) return; await refresh(); if (!alive.current || signal.aborted) return; setSelectedId(child.id); setNotice(`${child.name}’s profile was restored.`); }); }}>Restore {child.name}</button></li>)}</ul></div></details>}
      {pendingInvitations.length > 0 && <section className="family-sharing" aria-labelledby={`${formId}-pending`}><h2 id={`${formId}-pending`}>Pending permission links</h2><p>An invitation does not grant access until the athlete signs in and approves it.</p><ul>{pendingInvitations.map((invite, index) => <li key={invite.id}><div><strong>Permission link {index + 1}</strong><span>Expires {displayDate(invite.expiresAt)}</span></div><button type="button" disabled={Boolean(busy)} aria-label={`Cancel permission link ${index + 1}`} onClick={() => { void perform(`cancel-${invite.id}`, async (signal) => { await revokeFamilyInvitation(invite.id, signal); if (!alive.current || signal.aborted) return; setClaimLink((current) => current?.id === invite.id ? null : current); setNotice('Permission link canceled. It can no longer be approved.'); await refresh(); }); }}>Cancel link</button></li>)}</ul></section>}
      {family.sharedWith.length > 0 && <section className="family-sharing" aria-labelledby={`${formId}-shared`}><h2 id={`${formId}-shared`}>Who can view my records</h2><p>You approved these people to view your activity and cycling power. You can end that access here at any time.</p><ul>{family.sharedWith.map((share) => <li key={share.id}><div><strong>{share.parentName}</strong><span>Activity and power · Health excluded</span></div><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ kind: 'share', id: share.id })}>Stop sharing with {share.parentName}</button></li>)}</ul></section>}
      {confirmedShare && <div className="family-confirm" role="region" aria-label="Confirm stop sharing"><h3>Stop sharing with {confirmedShare.parentName}?</h3><p>Their access will end. Your account and activity records will stay intact.</p><div className="family-actions"><button type="button" className="family-primary" disabled={Boolean(busy)} onClick={stopSharing}>Confirm stop sharing</button><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>Keep sharing</button></div></div>}
    </>}
  </section>;
}

type FamilyInvitationProps = {
  token: string;
  accountId: string | null;
  accountName?: string;
  onSignIn: () => void;
  onClose: () => void;
  onAccepted?: () => void;
};

export function FamilyInvitation(props: FamilyInvitationProps) {
  return <FamilyInvitationContent key={`${props.accountId ?? 'guest'}:${props.token}`} {...props} />;
}

function FamilyInvitationContent({ token, accountId, accountName, onSignIn, onClose, onAccepted }: FamilyInvitationProps) {
  const [preview, setPreview] = useState<FamilyInvitationPreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const id = useId();

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => { alive.current = false; requestController.current?.abort(); previous?.focus(); };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void previewFamilyInvitation(token, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPreview(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    });
    return () => controller.abort();
  }, [accountId, token]);

  const canAccept = Boolean(preview?.canAccept && preview.invite.claimedAt == null && preview.invite.revokedAt == null && preview.invite.expiresAt > Date.now());

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!accountId || !canAccept || !consent || busyRef.current) return;
    const controller = new AbortController();
    requestController.current = controller;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await acceptFamilyInvitation(token, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      setAccepted(result.parentName); setConsent(false);
      onAccepted?.();
    } catch (reason) {
      if (!alive.current || controller.signal.aborted) return;
      setError(errorMessage(reason));
      if (reason instanceof FamilyRequestError && [401, 403, 409].includes(reason.status)) setPreview(null);
    } finally {
      busyRef.current = false;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]');
    if (!elements?.length) { event.preventDefault(); return; }
    const first = elements[0]; const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="family-invitation-overlay"><div ref={dialog} className="family-invitation" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onKeyDown={trapFocus}>
    <button type="button" className="family-icon-button family-close" aria-label="Close family invitation" onClick={onClose}><X size={22} /></button>
    <ShieldCheck size={30} /><h2 id={`${id}-title`}>Family permission</h2>
    {accepted ? <><p role="status">{accepted} can now view your activity records and cycling power.</p><p>You keep your own account. Apple Watch and other health data remain private. You can stop sharing in My profile → Family.</p><button type="button" className="family-primary" onClick={onClose}>Done</button></> : !accountId ? <><p>Sign in to the athlete account whose activity you want to share. You will see who requested access and approve it before anything is shared.</p><p>Use the athlete’s account, not the parent’s account.</p><button type="button" className="family-primary" onClick={onSignIn}>Sign in to review permission</button></> : <>
      <p className="family-signed-in">Signed in as <strong>{accountName || 'this athlete'}</strong></p>
      {!preview && !error && <p role="status">Loading permission request…</p>}
      {preview && <><p><strong>{preview.parentName}</strong> would like to view your athlete profile, personal records, activity history, and cycling power.</p><p>Health data, including Apple Watch heart rate, is excluded. This permission does not change who you train as or give the parent your login.</p>{canAccept ? <form onSubmit={(event) => { void accept(event); }}><label className="family-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} /><span>I allow {preview.parentName} to view my activity records and cycling power.</span></label><p className="family-fine-print">You can revoke this permission at any time in My profile → Family. This link expires {displayDate(preview.invite.expiresAt)}.</p><button type="submit" className="family-primary" disabled={!consent || busy}>{busy ? 'Approving permission…' : 'Approve activity sharing'}</button></form> : <p className="family-notice">This invitation cannot be accepted by this account. It may have expired, been used, or been canceled. Ask the parent for a new link if needed.</p>}</>}
    </>}
    {error && <p className="family-error" role="alert">{error}</p>}
  </div></div>;
}
