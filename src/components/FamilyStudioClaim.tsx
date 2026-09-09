import { useRef, useState, useEffect, type FormEvent } from 'react';
import { familyClubInviteToken, type FamilyChild } from '../lib/familyAccounts';
import { childDeviceRequest } from '../lib/childDevices';
import { ParentAthleteClaim } from './ParentAthleteClaim';

export function FamilyStudioClaim({ onClaimed }: { onClaimed: (child: FamilyChild) => void }) {
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<{ token: string; riderName: string; clubName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function review(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const token = familyClubInviteToken(link);
    if (!token) { setError('Paste the athlete invitation link your studio sent you.'); return; }
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError('');
    try {
      const result = await childDeviceRequest('/api/family/club-claim/preview', { token }, 'POST', request.signal);
      if (!request.signal.aborted) setPreview({ token, riderName: result.riderName, clubName: result.clubName });
    } catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <section className="family-card" aria-label="Claim existing studio athlete">
    <h2>Claim existing studio athlete</h2>
    <p>Already training at a studio? Paste your child’s athlete invite link to connect their existing records. No separate child email is needed.</p>
    {!preview ? <form onSubmit={(event) => void review(event)}>
      <label>Studio athlete invite link<input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste the link from your studio" autoComplete="off" maxLength={2048} disabled={busy} required /></label>
      <button className="family-primary" type="submit" disabled={busy || !link.trim()}>{busy ? 'Checking invitation…' : 'Review athlete invitation'}</button>
    </form> : <>
      <p><strong>{preview.riderName}</strong> · {preview.clubName}</p>
      <ParentAthleteClaim key={preview.token} token={preview.token} initialName={preview.riderName} onClaimed={onClaimed} />
      <button type="button" onClick={() => { setPreview(null); setLink(''); }}>Use another invitation</button>
    </>}
    {error && <p className="family-error" role="alert">{error}</p>}
  </section>;
}
