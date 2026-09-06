import './FamilyAccounts.css';
export default function ClubClaimWelcome({ onChoose, onClose }: { onChoose: (role: 'athlete' | 'parent') => void; onClose: () => void }) {
  return <div className="child-setup-overlay"><section className="family-card child-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="club-claim-welcome">
    <h1 id="club-claim-welcome">Your studio profile is ready.</h1>
    <p>Who is setting up this athlete’s TrackLab account?</p>
    <div className="club-claim-choices"><button type="button" onClick={() => onChoose('athlete')}><strong>I’m the athlete</strong><br />Claim my own training records.</button><button type="button" onClick={() => onChoose('parent')}><strong>I’m the parent or guardian</strong><br />Use my email to set up my child.</button></div>
    <p>Adults claim their own profile. Parents create or sign into their own account first, claim the child’s studio record, then get a separate setup link for the child’s phone. Existing records stay connected.</p>
    <p>Already claimed this athlete’s profile? Sign into that account; an existing independent account can approve a Family permission link.</p>
    <button type="button" onClick={onClose}>Close</button>
  </section></div>;
}
