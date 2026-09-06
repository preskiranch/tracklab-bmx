import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Server module under test.
import * as persistence from '../../cloud/persistence.mjs';
// @ts-expect-error Server module under test.
import { betaInvitationDurationMs, betaInvitationPolicy, publicBetaAccessStatus } from '../../cloud/betaAccess.mjs';
// @ts-expect-error Server module under test.
import { wattbikeMembershipForAccount } from '../../cloud/appleMembership.mjs';

async function user() {
  const id = randomUUID();
  return persistence.createAuthUser({ id, email: `${id}@tracklab.test`, displayName: 'Beta rider',
    passwordHash: 'scrypt:test:test', membershipTier: 'spectator', bikeSeats: 1 });
}
async function invitation(owner: any, rider: any, options: Record<string, unknown> = {}, now = Date.now()) {
  const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
  const invite = await persistence.createBetaAccessInvite({ email: rider.email.toUpperCase(),
    issuerUserId: owner.id, tokenHash, ...options }, now);
  return { tokenHash, invite };
}

describe('independent beta access persistence and projection', () => {
  it('bounds policy without rounding or silently accepting malformed grants', () => {
    expect(betaInvitationPolicy({})).toEqual({ bikeSeats: 4, durationDays: 90 });
    for (const bikeSeats of [0, 5, 1.5, '4']) expect(betaInvitationPolicy({ bikeSeats })).toBeNull();
    for (const durationDays of [0, -1, 366, 1.5, '90']) expect(betaInvitationPolicy({ durationDays })).toBeNull();
    expect(betaInvitationPolicy({ bikeSeats: 1, durationDays: 1 })).toEqual({ bikeSeats: 1, durationDays: 1 });
  });

  it('binds one use to the invited email, rejects replay, and does not reveal hashes in lists', async () => {
    const [owner, rider, other] = await Promise.all([user(), user(), user()]);
    const { invite, tokenHash } = await invitation(owner, rider);
    expect(invite.expiresAt - invite.createdAt).toBe(betaInvitationDurationMs);
    await expect(persistence.acceptBetaAccessInvite(tokenHash, other.id)).resolves.toBeNull();
    const claims = await Promise.all([
      persistence.acceptBetaAccessInvite(tokenHash, rider.id),
      persistence.acceptBetaAccessInvite(tokenHash, rider.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const grant = claims.find(Boolean);
    expect(grant.expiresAt - grant.startsAt).toBe(90 * 86400000);
    expect(publicBetaAccessStatus(grant)).toMatchObject({ active: true, bikeSeats: 4 });
    expect(wattbikeMembershipForAccount(await persistence.findAuthUserById(rider.id), { appleOnlyCutover: true }))
      .toEqual({ tier: 'racer', bikeSeats: 4 });
    expect(wattbikeMembershipForAccount(await persistence.findAuthUserByEmail(rider.email), { appleOnlyCutover: true }))
      .toEqual({ tier: 'racer', bikeSeats: 4 });
    const sessionHash = createHash('sha256').update(randomUUID()).digest('hex');
    await persistence.createAuthSession({ id: randomUUID(), userId: rider.id, tokenHash: sessionHash,
      expiresAt: new Date(Date.now() + 60000).toISOString() });
    const session = await persistence.findAuthSession(sessionHash);
    expect(wattbikeMembershipForAccount(session.user, { appleOnlyCutover: true }))
      .toEqual({ tier: 'racer', bikeSeats: 4 });
    const listing = JSON.stringify(await persistence.listBetaAccess());
    expect(listing).not.toContain(tokenHash);
    expect(listing).not.toContain('tokenHash');
    expect(listing).not.toContain('token_hash');
    await expect(persistence.revokeBetaAccess({ inviteId: invite.id, actorUserId: owner.id })).resolves.toBeNull();
    await persistence.revokeBetaAccess({ grantId: grant.id, actorUserId: owner.id });
    expect(wattbikeMembershipForAccount(await persistence.findEffectiveWattbikeBillingOwnerById(rider.id)))
      .toEqual({ tier: 'spectator', bikeSeats: 1 });
  });

  it('rejects expired/revoked/replaced invitations and expires cached grants at their exact boundary', async () => {
    const [owner, rider] = await Promise.all([user(), user()]);
    const now = Date.now();
    const expired = await invitation(owner, rider, {}, now - betaInvitationDurationMs);
    await expect(persistence.acceptBetaAccessInvite(expired.tokenHash, rider.id, now)).resolves.toBeNull();
    const replaced = await invitation(owner, rider);
    const replacement = await invitation(owner, rider);
    await expect(persistence.acceptBetaAccessInvite(replaced.tokenHash, rider.id)).resolves.toBeNull();
    await persistence.revokeBetaAccess({ inviteId: replacement.invite.id, actorUserId: owner.id });
    await expect(persistence.acceptBetaAccessInvite(replacement.tokenHash, rider.id)).resolves.toBeNull();
    const valid = await invitation(owner, rider, { bikeSeats: 1, durationDays: 1 });
    const grant = await persistence.acceptBetaAccessInvite(valid.tokenHash, rider.id);
    const cachedUser = await persistence.findAuthUserById(rider.id);
    expect(wattbikeMembershipForAccount(cachedUser, { now: grant.expiresAt - 1 })).toEqual({ tier: 'racer', bikeSeats: 1 });
    expect(wattbikeMembershipForAccount(cachedUser, { now: grant.expiresAt })).toEqual({ tier: 'spectator', bikeSeats: 1 });
    expect(publicBetaAccessStatus({ ...grant, startsAt: now + 86400000 }, now).active).toBe(false);
    expect(publicBetaAccessStatus({ ...grant, bikeSeats: 999 }, now).active).toBe(false);
  });

  it('replaces previous beta capacity and preserves verified paid access after beta revocation', async () => {
    const [owner, rider] = await Promise.all([user(), user()]);
    const original = await invitation(owner, rider);
    const first = await persistence.acceptBetaAccessInvite(original.tokenHash, rider.id);
    const changed = await invitation(owner, rider, { bikeSeats: 1 });
    const current = await persistence.acceptBetaAccessInvite(changed.tokenHash, rider.id);
    expect((await persistence.listBetaAccess()).grants.find((grant: any) => grant.id === first.id).revokedAt).not.toBeNull();
    const now = Date.now();
    const transaction = { transactionId: `100${now}`, originalTransactionId: `200${now}`,
      productId: 'com.preskilranch.tracklabbmx.wattbike.2.monthly', bikeSeats: 2,
      appAccountToken: rider.id, environment: 'sandbox', purchaseDate: now-1000,
      expiresDate: now+600000, entitlementExpiresDate: now+600000, signedDate: now,
      lifecycleSignedDate: now, revocationDate: null, revocationReason: null,
      isUpgraded: false, status: 'active', appleStatus: 1, active: true };
    const saved = await persistence.saveAppleSubscriptionReconciliation(rider.id, {
      originalTransactionId: transaction.originalTransactionId, appAccountToken: rider.id,
      environment: 'sandbox', entitlement: transaction, transactions: [transaction], reconciledAt: now,
    });
    expect(saved.status).toBe('saved');
    expect(wattbikeMembershipForAccount(saved.user, { appleOnlyCutover: true })).toEqual({ tier: 'racer', bikeSeats: 2 });
    await persistence.revokeBetaAccess({ grantId: current.id, actorUserId: owner.id });
    const after = await persistence.findAuthUserById(rider.id);
    expect(after.appleEntitlementActive).toBe(true);
    expect(wattbikeMembershipForAccount(after, { appleOnlyCutover: true })).toEqual({ tier: 'racer', bikeSeats: 2 });
    expect(wattbikeMembershipForAccount({ ...after, appleEntitlementActive: false }, { appleOnlyCutover: true }))
      .toEqual({ tier: 'spectator', bikeSeats: 1 });
  });

  it('removes invitation email and grant identity when an account is deleted', async () => {
    const [owner, rider] = await Promise.all([user(), user()]);
    const created = await invitation(owner, rider);
    await persistence.acceptBetaAccessInvite(created.tokenHash, rider.id);
    await invitation(owner, rider);
    await persistence.deleteAuthUserAccount(rider.id);
    const list = await persistence.listBetaAccess();
    expect(list.invites.some((invite: any) => invite.email === rider.email)).toBe(false);
    expect(list.grants.some((grant: any) => grant.userId === rider.id)).toBe(false);
    await expect(persistence.acceptBetaAccessInvite(created.tokenHash, rider.id)).resolves.toBeNull();
  });

  it('does not leave a grant behind when account deletion races a replacement claim', async () => {
    const [owner, rider] = await Promise.all([user(), user()]);
    const first = await invitation(owner, rider);
    await persistence.acceptBetaAccessInvite(first.tokenHash, rider.id);
    const replacement = await invitation(owner, rider);
    const [, deletion] = await Promise.all([
      persistence.acceptBetaAccessInvite(replacement.tokenHash, rider.id),
      persistence.deleteAuthUserAccount(rider.id),
    ]);
    expect(deletion.deleted).toBe(true);
    const list = await persistence.listBetaAccess();
    expect(list.invites.some((invite: any) => invite.email === rider.email)).toBe(false);
    expect(list.grants.some((grant: any) => grant.userId === rider.id)).toBe(false);
    await expect(persistence.findAuthUserById(rider.id)).resolves.toBeNull();
  });
});
