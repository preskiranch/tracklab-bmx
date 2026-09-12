import type { AuthUser } from './auth';
import { isAdminAccountEmail } from './membership';

// This experiment belongs to the owner account, not every club administrator.
export function canUsePrivateStadium(user: Pick<AuthUser, 'admin' | 'email' | 'managedChild'> | null, kiosk: boolean, regularPreview: boolean) {
  return !!user && user.admin && !user.managedChild && !kiosk && !regularPreview && isAdminAccountEmail(user.email);
}
