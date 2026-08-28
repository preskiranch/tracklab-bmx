import { describe, expect, it } from 'vitest';
import {
  claimWattbikeConnectionLease,
  createAuthSession,
  createAuthUser,
  enrollClubTabletDevice,
  enforceWattbikeConnectionCapacity,
  ensureClub,
  findEffectiveWattbikeBillingOwnerById,
  loadWattbikeConnectionLeases,
  persistenceEnabled,
  recoverClubTabletDevice,
  releaseWattbikeConnectionLease,
  releaseWattbikeConnectionLeaseForHolder,
  saveAppleSubscriptionReconciliation,
  withClubTabletSessionStartLock,
} from '../../cloud/persistence.mjs';

function leaseInput(overrides: Record<string, unknown> = {}) {
  const now = Number(overrides.now ?? Date.now());
  return {
    billingOwnerUserId: '11111111-1111-4111-8111-111111111111',
    allocationKey: 'owner-websocket:session-a',
    allocationKind: 'owner-websocket',
    holderInstanceId: 'instance-aaaaaaaa',
    holderId: 'holder-aaaaaaaa',
    requestedSeats: 1,
    seatLimit: 4,
    now,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

describe('account-wide Wattbike connection capacity', () => {
  it('serializes concurrent allocations and never grants more than the account limit', async () => {
    expect(persistenceEnabled()).toBe(false);
    const owner = '21111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 5 }, (_value, index) => (
      claimWattbikeConnectionLease(leaseInput({
        billingOwnerUserId: owner,
        allocationKey: `owner-websocket:parallel-${index}`,
        holderId: `parallel-holder-${index}`,
        requestedSeats: 1,
        seatLimit: 2,
        now: now + index,
        expiresAt: now + 60_000,
      }))
    )));

    expect(results.filter((result) => result?.grantedSeats === 1)).toHaveLength(2);
    expect(results.filter((result) => result?.grantedSeats === 0)).toHaveLength(3);
    const leases = await loadWattbikeConnectionLeases(owner, now + 10);
    expect(leases).toHaveLength(2);
    expect(leases?.reduce((total, lease) => total + lease.seatCount, 0)).toBe(2);
  });

  it('uses one stable allocation across reconnects and protects the replacement from a stale close', async () => {
    const owner = '31111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const first = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      requestedSeats: 2,
      seatLimit: 2,
      now,
    }));
    expect(first).toMatchObject({ status: 'granted', grantedSeats: 2, seatsInUse: 2 });

    const replacement = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      holderId: 'holder-bbbbbbbb',
      requestedSeats: 2,
      seatLimit: 2,
      now: now + 1,
      expiresAt: now + 60_001,
    }));
    expect(replacement).toMatchObject({ status: 'granted', grantedSeats: 2, seatsInUse: 2 });
    expect(replacement?.leases).toHaveLength(1);
    expect(replacement?.revoked).toContainEqual(expect.objectContaining({
      holderId: 'holder-aaaaaaaa',
      reason: 'replaced',
    }));

    await expect(releaseWattbikeConnectionLease({
      billingOwnerUserId: owner,
      allocationKey: 'owner-websocket:session-a',
      holderInstanceId: 'instance-aaaaaaaa',
      holderId: 'holder-aaaaaaaa',
    })).resolves.toBe(false);
    await expect(loadWattbikeConnectionLeases(owner, now + 2)).resolves.toEqual([
      expect.objectContaining({ holderId: 'holder-bbbbbbbb', seatCount: 2 }),
    ]);
  });

  it('hands a tablet picker lease to exactly one athlete session across concurrent holders', async () => {
    const owner = '32111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const allocationKey = 'club-tablet:durable-device-one';
    const pickerHolder = 'device-token-hash-aaaaaaaa';
    const sessionHolder = 'athlete-session-hash-aaaaaaaa';
    const clubAssignment = {
      clubId: 'club-durable-capacity-one',
      studioRiderId: 'rider-durable-one',
      bikeDeviceId: 'bike-durable-one',
    };

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey,
      allocationKind: 'club-tablet',
      holderId: pickerHolder,
      protectExistingHolder: true,
      now,
    }))).resolves.toMatchObject({ status: 'granted', grantedSeats: 1 });

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey,
      allocationKind: 'club-tablet',
      holderInstanceId: 'instance-bbbbbbbb',
      holderId: sessionHolder,
      expectedPreviousHolderId: pickerHolder,
      protectExistingHolder: true,
      ...clubAssignment,
      now: now + 1,
      expiresAt: now + 60_001,
    }))).resolves.toMatchObject({ status: 'granted', grantedSeats: 1 });

    const [latePicker, losingStart] = await Promise.all([
      claimWattbikeConnectionLease(leaseInput({
        billingOwnerUserId: owner,
        allocationKey,
        allocationKind: 'club-tablet',
        holderId: pickerHolder,
        protectExistingHolder: true,
        now: now + 2,
        expiresAt: now + 60_002,
      })),
      claimWattbikeConnectionLease(leaseInput({
        billingOwnerUserId: owner,
        allocationKey,
        allocationKind: 'club-tablet',
        holderInstanceId: 'instance-cccccccc',
        holderId: 'athlete-session-hash-bbbbbbbb',
        expectedPreviousHolderId: pickerHolder,
        protectExistingHolder: true,
        ...clubAssignment,
        now: now + 3,
        expiresAt: now + 60_003,
      })),
    ]);
    expect(latePicker).toMatchObject({ status: 'holder-conflict', grantedSeats: 0 });
    expect(losingStart).toMatchObject({ status: 'holder-conflict', grantedSeats: 0 });
    await expect(loadWattbikeConnectionLeases(owner, now + 4)).resolves.toEqual([
      expect.objectContaining({
        holderId: sessionHolder,
        ...clubAssignment,
      }),
    ]);
  });

  it('clears a remote athlete lease during recovery but rebinds the exact picker lease', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const ownerUserId = `recovery-owner-${suffix}`;
    const ownerProfileKey = `user:${ownerUserId}`;
    const clubId = `recovery-club-${suffix}`;
    const deviceId = `recovery-device-${suffix}`;
    const allocationKey = `club-tablet:${deviceId}`;
    const originalDeviceHash = `original-device-hash-${suffix}`;
    const recoveredDeviceHash = `recovered-device-hash-${suffix}`;
    const finalDeviceHash = `final-device-hash-${suffix}`;
    const firstAuthHash = `first-auth-hash-${suffix}`;
    const recoveryAuthHash = `recovery-auth-hash-${suffix}`;
    const secondRecoveryAuthHash = `second-recovery-auth-hash-${suffix}`;
    const now = Date.now();

    await ensureClub(ownerProfileKey, 'Recovery Capacity Club', clubId);
    await createAuthSession({
      id: `first-auth-session-${suffix}`,
      userId: ownerUserId,
      tokenHash: firstAuthHash,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    await expect(enrollClubTabletDevice({
      id: deviceId,
      ownerProfileKey,
      ownerUserId,
      name: 'Recovery Capacity Tablet',
      tokenHash: originalDeviceHash,
      authSessionTokenHash: firstAuthHash,
    })).resolves.toBeTruthy();

    // This lease represents an athlete session owned by another server
    // instance, so the recovery-serving process has no local session to stop.
    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: ownerUserId,
      allocationKey,
      allocationKind: 'club-tablet',
      holderInstanceId: 'remote-instance-aaaaaaaa',
      holderId: `remote-athlete-session-${suffix}`,
      clubId,
      studioRiderId: `remote-rider-${suffix}`,
      bikeDeviceId: `remote-bike-${suffix}`,
      protectExistingHolder: true,
      now,
      expiresAt: now + 60_000,
    }))).resolves.toMatchObject({ status: 'granted', grantedSeats: 1 });

    await createAuthSession({
      id: `recovery-auth-session-${suffix}`,
      userId: ownerUserId,
      tokenHash: recoveryAuthHash,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    await expect(recoverClubTabletDevice({
      deviceId,
      ownerProfileKey,
      ownerUserId,
      tokenHash: recoveredDeviceHash,
      authSessionTokenHash: recoveryAuthHash,
    })).resolves.toMatchObject({ status: 'recovered', previousTokenHash: originalDeviceHash });
    await expect(loadWattbikeConnectionLeases(ownerUserId, now + 1)).resolves.toEqual([]);

    // A picker lease belongs to the device credential itself and therefore
    // survives a later rotation with only its holder hash replaced.
    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: ownerUserId,
      allocationKey,
      allocationKind: 'club-tablet',
      holderInstanceId: 'remote-picker-instance',
      holderId: recoveredDeviceHash,
      protectExistingHolder: true,
      now: now + 2,
      expiresAt: now + 60_002,
    }))).resolves.toMatchObject({ status: 'granted', grantedSeats: 1 });
    await createAuthSession({
      id: `second-recovery-auth-session-${suffix}`,
      userId: ownerUserId,
      tokenHash: secondRecoveryAuthHash,
      expiresAt: new Date(now + 60_000).toISOString(),
    });
    await expect(recoverClubTabletDevice({
      deviceId,
      ownerProfileKey,
      ownerUserId,
      tokenHash: finalDeviceHash,
      authSessionTokenHash: secondRecoveryAuthHash,
    })).resolves.toMatchObject({ status: 'recovered', previousTokenHash: recoveredDeviceHash });
    await expect(loadWattbikeConnectionLeases(ownerUserId, now + 3)).resolves.toEqual([
      expect.objectContaining({
        allocationKey,
        holderId: finalDeviceHash,
        holderInstanceId: 'remote-picker-instance',
        seatCount: 1,
      }),
    ]);
  });

  it('rejects duplicate persisted athlete and bike assignments across tablet devices', async () => {
    const owner = '33111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const clubId = 'club-durable-capacity-two';
    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:durable-device-two-a',
      allocationKind: 'club-tablet',
      holderId: 'athlete-session-hash-cccccccc',
      protectExistingHolder: true,
      clubId,
      studioRiderId: 'shared-rider',
      bikeDeviceId: 'bike-one',
      now,
    }))).resolves.toMatchObject({ status: 'granted', grantedSeats: 1 });

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:durable-device-two-b',
      allocationKind: 'club-tablet',
      holderId: 'athlete-session-hash-dddddddd',
      protectExistingHolder: true,
      clubId,
      studioRiderId: 'shared-rider',
      bikeDeviceId: 'bike-two',
      now: now + 1,
      expiresAt: now + 60_001,
    }))).resolves.toMatchObject({
      status: 'assignment-conflict',
      conflictReason: 'athlete-active',
      grantedSeats: 0,
    });

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:durable-device-two-c',
      allocationKind: 'club-tablet',
      holderId: 'athlete-session-hash-eeeeeeee',
      protectExistingHolder: true,
      clubId,
      studioRiderId: 'other-rider',
      bikeDeviceId: 'bike-one',
      now: now + 2,
      expiresAt: now + 60_002,
    }))).resolves.toMatchObject({
      status: 'assignment-conflict',
      conflictReason: 'bike-active',
      grantedSeats: 0,
    });
  });

  it('charges club-funded personal devices against the same durable account pool', async () => {
    const owner = '34111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const clubId = 'club-personal-capacity-one';
    const personal = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-personal:club-one:auth-session-one',
      allocationKind: 'club-personal',
      holderInstanceId: 'instance-personal-a',
      holderId: 'auth-session-hash-aaaaaaaa',
      clubId,
      studioRiderId: 'personal-rider-one',
      protectExistingHolder: true,
      requestedSeats: 1,
      seatLimit: 2,
      now,
    }));
    expect(personal).toMatchObject({ status: 'granted', grantedSeats: 1, seatsInUse: 1 });

    const tablet = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:personal-shared-tablet',
      allocationKind: 'club-tablet',
      holderId: 'tablet-session-hash-ffffffff',
      clubId,
      studioRiderId: 'tablet-rider-one',
      bikeDeviceId: 'tablet-bike-one',
      requestedSeats: 1,
      seatLimit: 2,
      now: now + 1,
      expiresAt: now + 60_001,
    }));
    expect(tablet).toMatchObject({ status: 'granted', grantedSeats: 1, seatsInUse: 2 });

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'owner-websocket:personal-shared-owner',
      holderId: 'owner-holder-personal-shared',
      requestedSeats: 1,
      seatLimit: 2,
      now: now + 2,
      expiresAt: now + 60_002,
    }))).resolves.toMatchObject({ status: 'denied', grantedSeats: 0, seatsInUse: 2 });
  });

  it('prevents the same club athlete from using personal and tablet allocations', async () => {
    const owner = '35111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const clubId = 'club-personal-capacity-two';
    await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-personal:club-two:auth-session-one',
      allocationKind: 'club-personal',
      holderId: 'auth-session-hash-bbbbbbbb',
      clubId,
      studioRiderId: 'shared-personal-rider',
      protectExistingHolder: true,
      now,
    }));

    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:personal-conflict-tablet',
      allocationKind: 'club-tablet',
      holderId: 'tablet-session-hash-gggggggg',
      clubId,
      studioRiderId: 'shared-personal-rider',
      bikeDeviceId: 'tablet-bike-two',
      now: now + 1,
      expiresAt: now + 60_001,
    }))).resolves.toMatchObject({
      status: 'assignment-conflict',
      conflictReason: 'athlete-active',
      grantedSeats: 0,
    });
  });

  it('releases the same personal holder after a rolling-instance handoff', async () => {
    const owner = '36111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const allocationKey = 'club-personal:club-three:auth-session-one';
    const holderId = 'auth-session-hash-cccccccc';
    await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey,
      allocationKind: 'club-personal',
      holderInstanceId: 'instance-personal-old',
      holderId,
      clubId: 'club-personal-capacity-three',
      studioRiderId: 'personal-rider-three',
      protectExistingHolder: true,
      now,
    }));

    await expect(releaseWattbikeConnectionLeaseForHolder({
      billingOwnerUserId: owner,
      allocationKey,
      holderId,
    })).resolves.toBe(true);
    await expect(loadWattbikeConnectionLeases(owner, now + 1)).resolves.toEqual([]);
  });

  it('serializes Club Tablet transitions through the persistence lock in memory mode', async () => {
    const clubId = 'club-persistence-lock-one';
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = withClubTabletSessionStartLock(clubId, async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const second = withClubTabletSessionStartLock(clubId, async () => {
      order.push('second');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('shares capacity between owner sockets and Club Tablet athlete sessions', async () => {
    const owner = '41111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const tablet = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:tablet-one',
      allocationKind: 'club-tablet',
      holderId: 'tablet-session-one',
      requestedSeats: 1,
      seatLimit: 2,
      now,
    }));
    expect(tablet?.grantedSeats).toBe(1);

    const ownerSocket = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'owner-websocket:owner-session',
      holderId: 'owner-socket-one',
      requestedSeats: 2,
      seatLimit: 2,
      now: now + 1,
      expiresAt: now + 60_001,
    }));
    expect(ownerSocket).toMatchObject({ grantedSeats: 1, seatsInUse: 2 });

    const secondTablet = await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'club-tablet:tablet-two',
      allocationKind: 'club-tablet',
      holderId: 'tablet-session-two',
      requestedSeats: 1,
      seatLimit: 2,
      now: now + 2,
      expiresAt: now + 60_002,
    }));
    expect(secondTablet).toMatchObject({ status: 'denied', grantedSeats: 0, seatsInUse: 2 });
  });

  it('keeps the oldest allocations deterministically and trims a multi-bike holder on downgrade', async () => {
    const owner = '51111111-1111-4111-8111-111111111111';
    const now = Date.now();
    await claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: owner,
      allocationKey: 'owner-websocket:oldest',
      holderId: 'holder-oldest-one',
      requestedSeats: 4,
      seatLimit: 4,
      now,
    }));

    const downgraded = await enforceWattbikeConnectionCapacity(owner, 2, now + 1);
    expect(downgraded).toMatchObject({ status: 'enforced', seatLimit: 2, seatsInUse: 2 });
    expect(downgraded?.leases).toEqual([
      expect.objectContaining({ allocationKey: 'owner-websocket:oldest', seatCount: 2 }),
    ]);
    expect(downgraded?.revoked).toContainEqual(expect.objectContaining({
      allocationKey: 'owner-websocket:oldest',
      seatCount: 4,
      grantedSeats: 2,
      reason: 'capacity-reduced',
    }));

    const expired = await enforceWattbikeConnectionCapacity(owner, 2, now + 60_001);
    expect(expired).toMatchObject({ seatsInUse: 0, leases: [] });
  });

  it('derives Apple-managed capacity from the live entitlement window instead of stale user columns', async () => {
    const userId = '61111111-1111-4111-8111-111111111111';
    await createAuthUser({
      id: userId,
      email: 'capacity-expiry@tracklab.test',
      displayName: 'Capacity Expiry',
      username: 'capacity-expiry',
      friendDiscoverable: false,
      passwordHash: 'test-password-hash',
      membershipTier: 'racer',
      bikeSeats: 4,
      admin: false,
    });
    const now = Date.now();
    const saved = await saveAppleSubscriptionReconciliation(userId, {
      originalTransactionId: '600000000000000001',
      appAccountToken: userId,
      environment: 'sandbox',
      reconciledAt: now,
      entitlement: {
        transactionId: '600000000000000002',
        productId: 'com.preskilranch.tracklabbmx.wattbike.4.monthly',
        status: 'active',
        bikeSeats: 4,
        active: true,
        purchaseDate: now - 60_000,
        expiresDate: now + 250,
        entitlementExpiresDate: now + 250,
        signedDate: now,
        revocationDate: null,
      },
      transactions: [],
    });
    expect(saved?.user).toMatchObject({ membershipTier: 'racer', bikeSeats: 4 });
    await expect(claimWattbikeConnectionLease(leaseInput({
      billingOwnerUserId: userId,
      allocationKey: 'owner-websocket:expiring-entitlement',
      holderId: 'holder-expiring-entitlement',
      requestedSeats: 4,
      seatLimit: 4,
      now,
      expiresAt: now + 60_000,
    }))).resolves.toMatchObject({ grantedSeats: 4, seatsInUse: 4 });

    await new Promise((resolve) => setTimeout(resolve, 275));
    const effectiveUser = await findEffectiveWattbikeBillingOwnerById(userId);
    expect(effectiveUser).toMatchObject({
      appleBillingManaged: true,
      membershipTier: 'spectator',
      bikeSeats: 1,
    });
    await expect(enforceWattbikeConnectionCapacity(
      userId,
      effectiveUser?.membershipTier === 'racer' ? effectiveUser.bikeSeats : 0,
    )).resolves.toMatchObject({ seatLimit: 0, seatsInUse: 0, leases: [] });
  });
});
