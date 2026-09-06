import { lazy, Suspense, type ComponentProps } from 'react';
import { AccountProfileView } from './AccountProfileView';
import './AccountProfileWorkspace.css';

const FamilyAccounts = lazy(() => import('./FamilyAccounts').then((module) => ({ default: module.FamilyAccounts })));

type Props = ComponentProps<typeof AccountProfileView> & {
  familyOpen: boolean;
  onFamilyOpenChange: (open: boolean) => void;
};

export function AccountProfileWorkspace({ familyOpen, onFamilyOpenChange, ...profile }: Props) {
  return <div className="account-profile-workspace">
    <div className="account-profile-tabs" role="group" aria-label="Choose profile workspace">
      <button type="button" aria-pressed={!familyOpen} onClick={() => onFamilyOpenChange(false)}>My profile</button>
      <button type="button" aria-pressed={familyOpen} onClick={() => onFamilyOpenChange(true)}>Family</button>
    </div>
    {familyOpen ? <Suspense fallback={<p role="status">Loading your family…</p>}>
      <FamilyAccounts key={profile.profileId} accountId={profile.profileId} accountName={profile.name} speedUnit={profile.speedUnit} distanceUnit={profile.distanceUnit} />
    </Suspense> : <AccountProfileView {...profile} />}
  </div>;
}
