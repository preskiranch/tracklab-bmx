import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createAuthSession,
  createClubTabletResultAuthorization,
  enrollClubTabletDevice,
  ensureClub,
  ensureClubRosterMember,
  findBillingCheckout,
  loadClubTabletResultAuthorization,
  pruneExpiredData,
  revokeClubMember,
  saveBillingCheckout,
} from '../../cloud/persistence.mjs';

describe('expired persistence pruning', () => {
  it('pins every PostgreSQL cutoff parameter to timestamptz before interval arithmetic', () => {
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const pruneSource = source.slice(
      source.indexOf('export async function pruneExpiredData'),
      source.indexOf('export async function closePersistence'),
    );

    expect(pruneSource.match(/\$1::timestamptz - interval/g)).toHaveLength(7);
    expect(pruneSource).not.toMatch(/\$1(?!::timestamptz)\s*-\s*interval/);
    expect(pruneSource.match(/\$1::timestamptz/g)).toHaveLength(11);
    expect(pruneSource).toContain(`DELETE FROM \${schema}.club_tablet_result_authorizations`);
  });

  it('removes expired memory records without pruning a fresh checkout', async () => {
    const now = 2_000_000_000_000;
    const suffix = `${Date.now()}-${Math.random()}`;
    const expiredState = `prune-expired-${suffix}`;
    const freshState = `prune-fresh-${suffix}`;

    await saveBillingCheckout({
      stateHash: expiredState,
      userId: `user-${suffix}`,
      orderId: `expired-order-${suffix}`,
      paymentLinkId: `expired-link-${suffix}`,
      bikeSeats: 1,
      expectedAmountCents: 999,
      expiresAt: new Date(now - 1).toISOString(),
    });
    await saveBillingCheckout({
      stateHash: freshState,
      userId: `user-${suffix}`,
      orderId: `fresh-order-${suffix}`,
      paymentLinkId: `fresh-link-${suffix}`,
      bikeSeats: 1,
      expectedAmountCents: 999,
      expiresAt: new Date(now + 60_000).toISOString(),
    });

    expect(await pruneExpiredData(now)).toMatchObject({ removedBillingCheckouts: 1 });
    await expect(findBillingCheckout(expiredState, `user-${suffix}`)).resolves.toBeNull();
    await expect(findBillingCheckout(freshState, `user-${suffix}`)).resolves.toMatchObject({
      stateHash: freshState,
    });
  });

  it('removes expired tablet result credentials without pruning a fresh credential', async () => {
    const now = 2_000_000_000_000;
    const suffix = `${Date.now()}-${Math.random()}`;
    const ownerProfileKey = `prune-owner-${suffix}`;
    const ownerUserId = `prune-user-${suffix}`;
    const clubId = `prune-club-${suffix}`;
    const deviceId = `prune-device-${suffix}`;
    const authSessionTokenHash = `prune-auth-${suffix}`;
    await ensureClub(ownerProfileKey, 'Pruning Club', clubId);
    await createAuthSession({
      id: `prune-session-${suffix}`,
      userId: ownerUserId,
      tokenHash: authSessionTokenHash,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    await expect(enrollClubTabletDevice({
      id: deviceId,
      ownerProfileKey,
      ownerUserId,
      name: 'Pruning tablet',
      tokenHash: `prune-device-token-${suffix}`,
      authSessionTokenHash,
    })).resolves.toBeTruthy();
    await ensureClubRosterMember(ownerProfileKey, 'prune-rider', 'Prune Rider');

    const createAuthorization = (tokenHash: string, sessionTokenHash: string, expiresAt: number) => (
      createClubTabletResultAuthorization({
        tokenHash,
        deviceId,
        clubId,
        studioRiderId: 'prune-rider',
        riderName: 'Prune Rider',
        bikeDeviceId: 'prune-bike',
        sessionTokenHash,
        expiresAt,
        now: now - 1_000,
      })
    );
    await expect(createAuthorization(`expired-${suffix}`, `expired-session-${suffix}`, now - 1))
      .resolves.toMatchObject({ status: 'created' });
    const freshTokenHash = `fresh-${suffix}`;
    await expect(createAuthorization(freshTokenHash, `fresh-session-${suffix}`, now + 60_000))
      .resolves.toMatchObject({ status: 'created' });

    expect(await pruneExpiredData(now)).toMatchObject({ removedClubTabletResultAuthorizations: 1 });
    await expect(loadClubTabletResultAuthorization({
      tokenHash: freshTokenHash,
      deviceId,
      now,
    })).resolves.toMatchObject({ status: 'authorized' });
  });

  it('permanently revokes deferred result credentials when a roster member is removed', async () => {
    const now = Date.now();
    const suffix = `${now}-${Math.random()}`;
    const ownerProfileKey = `revocation-owner-${suffix}`;
    const ownerUserId = `revocation-user-${suffix}`;
    const clubId = `revocation-club-${suffix}`;
    const deviceId = `revocation-device-${suffix}`;
    const resultTokenHash = `revocation-result-${suffix}`;
    await ensureClub(ownerProfileKey, 'Revocation Club', clubId);
    await createAuthSession({
      id: `revocation-session-${suffix}`,
      userId: ownerUserId,
      tokenHash: `revocation-auth-${suffix}`,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    await expect(enrollClubTabletDevice({
      id: deviceId,
      ownerProfileKey,
      ownerUserId,
      name: 'Revocation tablet',
      tokenHash: `revocation-device-token-${suffix}`,
      authSessionTokenHash: `revocation-auth-${suffix}`,
    })).resolves.toBeTruthy();
    await ensureClubRosterMember(ownerProfileKey, 'revocation-rider', 'Revocation Rider');
    await expect(createClubTabletResultAuthorization({
      tokenHash: resultTokenHash,
      deviceId,
      clubId,
      studioRiderId: 'revocation-rider',
      riderName: 'Revocation Rider',
      bikeDeviceId: 'revocation-bike',
      sessionTokenHash: `revocation-athlete-session-${suffix}`,
      expiresAt: now + 60_000,
      now,
    })).resolves.toMatchObject({ status: 'created' });
    await expect(loadClubTabletResultAuthorization({
      tokenHash: resultTokenHash,
      deviceId,
      now,
    })).resolves.toMatchObject({ status: 'authorized' });

    await expect(revokeClubMember(ownerProfileKey, 'revocation-rider')).resolves.toBe(true);
    // Re-adding the same roster ID must not resurrect a credential minted for
    // the prior membership lifetime.
    await ensureClubRosterMember(ownerProfileKey, 'revocation-rider', 'Revocation Rider Re-added');
    await expect(loadClubTabletResultAuthorization({
      tokenHash: resultTokenHash,
      deviceId,
      now: now + 1,
    })).resolves.toMatchObject({ status: 'unauthorized' });

    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const revokeSource = source.slice(
      source.indexOf('export async function revokeClubMember'),
      source.indexOf('export async function loadClubConnectState'),
    );
    expect(revokeSource).toContain('revoked_result_authorizations AS');
    expect(revokeSource).toContain(`DELETE FROM \${schema}.club_tablet_result_authorizations`);
  });
});
