import { useEffect, useState } from 'react';
import { loadFamily, type FamilyChild } from '../lib/familyAccounts';
import { childDeviceRequest } from '../lib/childDevices';
import { ChildPhoneSetup } from './ChildPhoneSetup';

export function ParentAthleteClaim({ token, onClaimed, initialName = '' }: { token: string; onClaimed: (child: FamilyChild) => void; initialName?: string }) {
  const [children, setChildren] = useState<FamilyChild[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState(initialName);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState<FamilyChild | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadFamily(controller.signal).then((state) => {
      if (!controller.signal.aborted) { setChildren(state.children.filter((child) => child.kind === 'managed')); setLoading(false); }
    }).catch((reason: Error) => { if (!controller.signal.aborted) { setError(reason.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  async function claim() {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await childDeviceRequest('/api/family/club-claim', { token, name, childId: selectedId || undefined, guardianConsent: consent });
      setClaimed(result.child); onClaimed(result.child);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  if (claimed) return <><p role="status">{claimed.name}’s studio profile is connected. Find it any time in My Profile → Family.</p><ChildPhoneSetup key={claimed.id} childId={claimed.id} name={claimed.name} /></>;
  return <section className="family-card" aria-label="Parent athlete claim">
    <h3>Claim your child’s studio profile</h3><p>You stay signed in as the parent. This invitation connects one child’s existing studio history. For a sibling’s invitation, create a new child profile or choose that sibling’s existing profile—not another child.</p>
    {children.length > 0 && <label>Child profile<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Create a new child profile</option>{children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>}
    {!selectedId && <label>Child’s name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="off" /></label>}
    <label className="family-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I am this athlete’s parent or guardian and am authorized to manage their profile.</label>
    <button className="family-primary" type="button" disabled={busy || loading || !consent || (!selectedId && !name.trim())} onClick={() => void claim()}>{busy ? 'Connecting…' : 'Claim child’s profile'}</button>
    {error && <p role="alert" className="family-error">{error}</p>}
  </section>;
}
