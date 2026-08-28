import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Server module under test.
import {
  AppleBillingError,
  appleAppAccountTokenLineageHash,
  appleBillingConfigStatus,
  createAppleBillingService,
} from '../../cloud/appleBilling.mjs';
// @ts-expect-error Server module under test.
import {
  appleServerNotificationExists,
  createAuthSession,
  createAuthUser,
  deleteAuthUserAccount,
  findAuthSession,
  findAuthUserById,
  loadAppleBillingStatus,
  loadAppleSubscriptionLineagesForReconciliation,
  persistenceTestHooks,
  restoreDeletedAppleSubscription,
  saveAppleServerNotification,
  saveAppleSubscriptionReconciliation,
  touchAppleSubscriptionReconciliationAttempt,
} from '../../cloud/persistence.mjs';

const bundleId = 'com.preskilranch.tracklabbmx';
const productId = 'com.preskilranch.tracklabbmx.wattbike.2.monthly';
const subscriptionGroupId = '9876543210';
const sandboxAccountToken = '00000000-0000-4000-8000-000000000001';
const now = 1_800_000_000_000;

function configuration() {
  return {
    enabled: true,
    configured: true,
    missing: [],
    bundleId,
    appId: 123456789,
    subscriptionGroupId,
    sandboxAccountTokens: new Set([sandboxAccountToken]),
    issuerId: 'issuer',
    keyId: 'key',
    privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
  };
}

function decodedTransaction(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: '1000000000000001',
    originalTransactionId: '1000000000000000',
    bundleId,
    productId,
    type: 'Auto-Renewable Subscription',
    appAccountToken: sandboxAccountToken,
    subscriptionGroupIdentifier: subscriptionGroupId,
    purchaseDate: now - 1_000,
    expiresDate: now + 60_000,
    signedDate: now,
    environment: 'Sandbox',
    ...overrides,
  };
}

function fakeService(overrides: {
  seed?: Record<string, unknown>;
  current?: Record<string, unknown>;
  renewal?: Record<string, unknown>;
  notification?: Record<string, unknown>;
  status?: number;
} = {}) {
  const seed = decodedTransaction(overrides.seed);
  const current = decodedTransaction(overrides.current);
  const sandboxVerifier = {
    verifyAndDecodeTransaction: async (signed: string) => {
      if (signed === 'seed') return seed;
      if (signed === 'current') return current;
      throw new Error('unknown signed transaction');
    },
    verifyAndDecodeRenewalInfo: async () => ({
      originalTransactionId: current.originalTransactionId,
      appAccountToken: current.appAccountToken,
      productId: current.productId,
      signedDate: Number(current.signedDate) + 1,
      environment: 'Sandbox',
      ...overrides.renewal,
    }),
    verifyAndDecodeNotification: async () => overrides.notification ?? {
      notificationType: 'DID_RENEW',
      notificationUUID: '00000000-0000-4000-8000-000000000099',
      version: '2.0',
      signedDate: now,
      data: {
        environment: 'Sandbox',
        appAppleId: 123456789,
        bundleId,
        signedTransactionInfo: 'current',
        status: 1,
      },
    },
  };
  return createAppleBillingService({
    config: configuration(),
    now: () => now,
    verifiers: {
      production: {
        verifyAndDecodeTransaction: async () => { throw new Error('not production'); },
        verifyAndDecodeRenewalInfo: async () => { throw new Error('not production'); },
        verifyAndDecodeNotification: async () => { throw new Error('not production'); },
      },
      sandbox: sandboxVerifier,
    },
    clients: {
      production: { getAllSubscriptionStatuses: async () => { throw new Error('not production'); } },
      sandbox: {
        getAllSubscriptionStatuses: async () => ({
          environment: 'Sandbox',
          bundleId,
          appAppleId: 123456789,
          data: [{
            subscriptionGroupIdentifier: subscriptionGroupId,
            lastTransactions: [{
              originalTransactionId: current.originalTransactionId,
              status: overrides.status ?? 1,
              signedTransactionInfo: 'current',
              signedRenewalInfo: 'renewal',
            }],
          }],
        }),
      },
    },
  });
}

function persistenceAccount(label: string) {
  const id = randomUUID();
  return {
    id,
    email: `${label}-${id}@example.com`,
    displayName: `${label} Rider`,
    username: `${label.toLowerCase()}-${id.slice(0, 8)}`,
    friendDiscoverable: false,
    passwordHash: 'test-only',
    membershipTier: 'spectator',
    bikeSeats: 1,
    admin: false,
  };
}

function reconciliation(options: {
  userId: string;
  originalId: string;
  transactionId: string;
  signedDate: number;
  reconciledAt: number;
  active: boolean;
  bikeSeats?: number;
  status?: string;
  expiresDate?: number;
  lifecycleSignedDate?: number;
}) {
  const expiresDate = options.expiresDate
    ?? (options.active ? Date.now() + 600_000 : Date.now() - 60_000);
  const transaction = {
    transactionId: options.transactionId,
    originalTransactionId: options.originalId,
    productId: `com.preskilranch.tracklabbmx.wattbike.${options.bikeSeats ?? 2}.monthly`,
    bikeSeats: options.bikeSeats ?? 2,
    appAccountToken: options.userId,
    environment: 'sandbox',
    purchaseDate: options.signedDate - 1_000,
    expiresDate,
    entitlementExpiresDate: expiresDate,
    signedDate: options.signedDate,
    lifecycleSignedDate: options.lifecycleSignedDate ?? options.signedDate,
    revocationDate: options.status === 'revoked' ? options.signedDate : null,
    revocationReason: options.status === 'revoked' ? 1 : null,
    isUpgraded: false,
    status: options.status ?? (options.active ? 'active' : 'expired'),
    appleStatus: options.active ? 1 : 2,
    active: options.active,
  };
  return {
    originalTransactionId: options.originalId,
    appAccountToken: options.userId,
    environment: 'sandbox',
    entitlement: transaction,
    transactions: [transaction],
    reconciledAt: options.reconciledAt,
  };
}

describe('Apple server billing verification', () => {
  it('fails closed when Apple billing is enabled without every server credential', () => {
    const config = appleBillingConfigStatus({ TRACKLAB_APPLE_IAP_ENABLED: '1' });
    expect(config.configured).toBe(false);
    expect(config.missing).toContain('TRACKLAB_APPLE_BUNDLE_ID');
    expect(() => createAppleBillingService({ config })).toThrow('enabled but incomplete');
  });

  it('verifies the device JWS, account token, catalog product, and current Apple status', async () => {
    const service = fakeService();
    const result = await service.claimTransaction(
      'seed',
      sandboxAccountToken,
    );
    expect(result).toMatchObject({
      originalTransactionId: '1000000000000000',
      appAccountToken: '00000000-0000-4000-8000-000000000001',
      environment: 'sandbox',
      entitlement: { productId, bikeSeats: 2, status: 'active', active: true },
    });
  });

  it('verifies an explicit restore transaction without assuming the new TrackLab UUID', async () => {
    const result = await fakeService().claimRestoredTransaction('seed');

    expect(result).toMatchObject({
      originalTransactionId: '1000000000000000',
      appAccountToken: sandboxAccountToken,
      entitlement: { active: true },
    });
  });

  it('reconciles a rebound lineage using only the retained token hash', async () => {
    const service = fakeService();
    const tokenHash = appleAppAccountTokenLineageHash(
      sandboxAccountToken,
      '1000000000000000',
      'sandbox',
    );

    await expect(service.reconcileVerifiedTransaction({
      originalTransactionId: '1000000000000000',
      appAccountToken: '00000000-0000-4000-8000-000000000002',
      appAccountTokenHashes: [tokenHash],
      environment: 'sandbox',
    })).resolves.toMatchObject({ entitlement: { active: true } });

    await expect(service.reconcileVerifiedTransaction({
      originalTransactionId: '1000000000000000',
      appAccountToken: '00000000-0000-4000-8000-000000000002',
      appAccountTokenHashes: ['0'.repeat(64)],
      environment: 'sandbox',
    })).rejects.toMatchObject<Partial<AppleBillingError>>({
      code: 'apple-account-mismatch',
    });
  });

  it('rejects an otherwise valid transaction linked to another TrackLab account', async () => {
    const service = fakeService();
    await expect(service.claimTransaction(
      'seed',
      '00000000-0000-4000-8000-000000000002',
    )).rejects.toMatchObject<Partial<AppleBillingError>>({
      code: 'apple-account-mismatch',
      statusCode: 409,
    });
  });

  it('rejects a catalog product whose transaction belongs to another subscription group', async () => {
    const service = fakeService({
      seed: { subscriptionGroupIdentifier: '9876543211' },
    });
    await expect(service.claimTransaction(
      'seed',
      sandboxAccountToken,
    )).rejects.toMatchObject<Partial<AppleBillingError>>({
      code: 'apple-subscription-group-mismatch',
      statusCode: 400,
    });
  });

  it('rejects a verified sandbox transaction whose account token is not allowlisted', async () => {
    const unapprovedToken = '00000000-0000-4000-8000-000000000002';
    const service = fakeService({
      seed: { appAccountToken: unapprovedToken },
    });
    await expect(service.claimTransaction(
      'seed',
      unapprovedToken,
    )).rejects.toMatchObject<Partial<AppleBillingError>>({
      code: 'apple-sandbox-account-not-allowed',
      statusCode: 403,
    });
  });

  it('fails closed when grace-period status omits its expiration timestamp', async () => {
    const service = fakeService({ status: 4 });
    await expect(service.claimTransaction(
      'seed',
      sandboxAccountToken,
    )).rejects.toMatchObject<Partial<AppleBillingError>>({
      code: 'apple-grace-period-incomplete',
      statusCode: 503,
    });
  });

  it('orders lifecycle updates by transaction, renewal, and notification timestamp floors', async () => {
    const transactionSignedDate = now - 1_000;
    const renewalSignedDate = now + 1_000;
    const notificationSignedDate = now + 2_000;
    const service = fakeService({
      current: { signedDate: transactionSignedDate },
      renewal: { signedDate: renewalSignedDate },
    });

    const claimed = await service.claimTransaction('seed', sandboxAccountToken);
    expect(claimed.entitlement.lifecycleSignedDate).toBe(renewalSignedDate);

    const reconciledFromNotification = await service.reconcileVerifiedTransaction({
      originalTransactionId: '1000000000000000',
      appAccountToken: sandboxAccountToken,
      environment: 'sandbox',
    }, notificationSignedDate);
    expect(reconciledFromNotification.entitlement.lifecycleSignedDate).toBe(notificationSignedDate);
    expect(reconciledFromNotification.transactions).toEqual([
      expect.objectContaining({ lifecycleSignedDate: notificationSignedDate }),
    ]);
  });

  it('verifies V2 notification metadata and its nested transaction', async () => {
    const notification = await fakeService().verifyNotification('signed-notification');
    expect(notification).toMatchObject({
      notificationType: 'DID_RENEW',
      notificationUUID: '00000000-0000-4000-8000-000000000099',
      environment: 'sandbox',
      transaction: {
        originalTransactionId: '1000000000000000',
        productId,
      },
    });
    expect(notification.signedPayloadHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

describe('Apple billing persistence authority', () => {
  it('expires effective user and session access at the Apple entitlement deadline without a notification', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const account = persistenceAccount('AppleClockExpiry');
      const sessionTokenHash = `apple-expiry-${randomUUID()}`;
      await createAuthUser(account);
      await createAuthSession({
        id: randomUUID(),
        userId: account.id,
        tokenHash: sessionTokenHash,
        expiresAt: new Date(now + 60_000).toISOString(),
      });

      await saveAppleSubscriptionReconciliation(account.id, reconciliation({
        userId: account.id,
        originalId: '1500000000000000',
        transactionId: '1500000000000001',
        signedDate: now,
        reconciledAt: now,
        expiresDate: now + 1_000,
        active: true,
        bikeSeats: 3,
      }));

      await expect(findAuthUserById(account.id)).resolves.toMatchObject({
        membershipTier: 'racer',
        bikeSeats: 3,
        appleEntitlementActive: true,
      });
      await expect(findAuthSession(sessionTokenHash)).resolves.toMatchObject({
        user: { membershipTier: 'racer', bikeSeats: 3, appleEntitlementActive: true },
      });

      vi.advanceTimersByTime(1_001);

      await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
        managed: true,
        membershipTier: 'spectator',
        bikeSeats: 1,
        entitlement: null,
      });
      await expect(findAuthUserById(account.id)).resolves.toMatchObject({
        membershipTier: 'spectator',
        bikeSeats: 1,
        appleEntitlementActive: false,
      });
      await expect(findAuthSession(sessionTokenHash)).resolves.toMatchObject({
        user: { membershipTier: 'spectator', bikeSeats: 1, appleEntitlementActive: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a later local completion overwrite a newer Apple lifecycle event', async () => {
    const account = persistenceAccount('AppleLifecycleOrder');
    await createAuthUser(account);
    const common = {
      userId: account.id,
      originalId: '1750000000000000',
      transactionId: '1750000000000001',
      signedDate: now,
      bikeSeats: 2,
    };

    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now,
      lifecycleSignedDate: now,
      active: true,
    }));
    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now + 10_000,
      lifecycleSignedDate: now + 10_000,
      active: false,
      status: 'revoked',
    }));

    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now + 30_000,
      lifecycleSignedDate: now,
      active: true,
    }));

    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      managed: true,
      membershipTier: 'spectator',
      bikeSeats: 1,
      entitlement: null,
    });
  });

  it('breaks equal lifecycle timestamp ties only toward reduced access', async () => {
    const account = persistenceAccount('AppleEqualLifecycle');
    await createAuthUser(account);
    const common = {
      userId: account.id,
      originalId: '1850000000000000',
      transactionId: '1850000000000001',
      signedDate: now,
      lifecycleSignedDate: now,
      bikeSeats: 4,
    };

    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now,
      active: true,
    }));
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      membershipTier: 'racer',
      bikeSeats: 4,
      entitlement: { active: true },
    });

    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now + 1_000,
      active: false,
      status: 'revoked',
    }));
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      managed: true,
      membershipTier: 'spectator',
      bikeSeats: 1,
      entitlement: null,
    });

    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      ...common,
      reconciledAt: now + 2_000,
      active: true,
    }));
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      managed: true,
      membershipTier: 'spectator',
      bikeSeats: 1,
      entitlement: null,
    });
  });

  it('rotates failed background reconciliation attempts behind the next-oldest lineage', async () => {
    const account = persistenceAccount('AppleReconciliationRotation');
    await createAuthUser(account);
    const oldestOriginalId = '1950000000000000';
    const nextOriginalId = '1950000000000010';
    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      userId: account.id,
      originalId: oldestOriginalId,
      transactionId: '1950000000000001',
      signedDate: now,
      reconciledAt: 1_000,
      active: true,
    }));
    await saveAppleSubscriptionReconciliation(account.id, reconciliation({
      userId: account.id,
      originalId: nextOriginalId,
      transactionId: '1950000000000011',
      signedDate: now + 1,
      reconciledAt: 2_000,
      active: true,
    }));

    await expect(loadAppleSubscriptionLineagesForReconciliation(1)).resolves.toEqual([expect.objectContaining({
      userId: account.id,
      originalTransactionId: oldestOriginalId,
      appAccountToken: account.id,
      environment: 'sandbox',
    })]);

    await expect(touchAppleSubscriptionReconciliationAttempt(oldestOriginalId, 3_000))
      .resolves.toBe(true);
    await expect(loadAppleSubscriptionLineagesForReconciliation(2)).resolves.toEqual([
      expect.objectContaining({
        userId: account.id,
        originalTransactionId: nextOriginalId,
        appAccountToken: account.id,
        environment: 'sandbox',
      }),
      expect.objectContaining({
        userId: account.id,
        originalTransactionId: oldestOriginalId,
        appAccountToken: account.id,
        environment: 'sandbox',
      }),
    ]);
  });

  it('keeps stale lineage updates from overwriting newer entitlement and projects the best active lineage', async () => {
    const account = persistenceAccount('AppleMonotonic');
    await createAuthUser(account);
    const first = reconciliation({
      userId: account.id,
      originalId: '2000000000000000',
      transactionId: '2000000000000001',
      signedDate: now,
      reconciledAt: now,
      active: true,
      bikeSeats: 2,
    });
    await expect(saveAppleSubscriptionReconciliation(account.id, first)).resolves.toMatchObject({
      status: 'saved',
      user: { membershipTier: 'racer', bikeSeats: 2 },
      subscription: { revocationDate: null },
    });

    const stale = reconciliation({
      userId: account.id,
      originalId: '2000000000000000',
      transactionId: '2000000000000001',
      signedDate: now - 5_000,
      reconciledAt: now - 5_000,
      active: false,
      bikeSeats: 2,
      status: 'revoked',
    });
    await saveAppleServerNotification({
      notificationUUID: randomUUID(),
      notificationType: 'REFUND',
      subtype: null,
      environment: 'sandbox',
      signedDate: now - 5_000,
      signedPayloadHash: 'b'.repeat(64),
      transaction: stale.entitlement,
      status: 'revoked',
      receivedAt: now,
    }, stale);
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      managed: true,
      membershipTier: 'racer',
      bikeSeats: 2,
      entitlement: { originalTransactionId: '2000000000000000', active: true },
    });

    const newerLineage = reconciliation({
      userId: account.id,
      originalId: '3000000000000000',
      transactionId: '3000000000000001',
      signedDate: now + 10_000,
      reconciledAt: now + 10_000,
      active: true,
      bikeSeats: 4,
    });
    await saveAppleSubscriptionReconciliation(account.id, newerLineage);
    const oldLineageExpired = reconciliation({
      userId: account.id,
      originalId: '2000000000000000',
      transactionId: '2000000000000002',
      signedDate: now + 20_000,
      reconciledAt: now + 20_000,
      active: false,
      bikeSeats: 2,
    });
    await saveAppleSubscriptionReconciliation(account.id, oldLineageExpired);
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      membershipTier: 'racer',
      bikeSeats: 4,
      entitlement: { originalTransactionId: '3000000000000000', active: true },
    });

    const newerLineageExpired = reconciliation({
      userId: account.id,
      originalId: '3000000000000000',
      transactionId: '3000000000000002',
      signedDate: now + 30_000,
      reconciledAt: now + 30_000,
      active: false,
      bikeSeats: 4,
    });
    await saveAppleSubscriptionReconciliation(account.id, newerLineageExpired);
    await expect(loadAppleBillingStatus(account.id)).resolves.toMatchObject({
      managed: true,
      membershipTier: 'spectator',
      bikeSeats: 1,
      entitlement: null,
    });
  });

  it('binds an original transaction to one account and idempotently records notification UUIDs', async () => {
    const owner = persistenceAccount('AppleOwner');
    const other = persistenceAccount('AppleOther');
    await createAuthUser(owner);
    await createAuthUser(other);
    const purchase = reconciliation({
      userId: owner.id,
      originalId: '4000000000000000',
      transactionId: '4000000000000001',
      signedDate: now,
      reconciledAt: now,
      active: true,
    });
    await saveAppleSubscriptionReconciliation(owner.id, purchase);
    await expect(saveAppleSubscriptionReconciliation(other.id, {
      ...purchase,
      appAccountToken: other.id,
      entitlement: { ...purchase.entitlement, appAccountToken: other.id },
      transactions: purchase.transactions.map((item) => ({ ...item, appAccountToken: other.id })),
    })).resolves.toMatchObject({ status: 'conflict' });

    const notification = {
      notificationUUID: randomUUID(),
      notificationType: 'TEST',
      subtype: null,
      environment: 'sandbox',
      signedDate: Date.now(),
      signedPayloadHash: 'a'.repeat(64),
      transaction: null,
      status: null,
      receivedAt: Date.now(),
    };
    await expect(saveAppleServerNotification(notification)).resolves.toMatchObject({
      duplicate: false,
      processingState: 'ignored',
    });
    await expect(appleServerNotificationExists(notification.notificationUUID)).resolves.toBe(true);
    await expect(saveAppleServerNotification(notification)).resolves.toMatchObject({ duplicate: true });
  });

  it('deletes personal identity but rebinds an active Apple lineage only through explicit restore', async () => {
    const owner = persistenceAccount('AppleDeletedOwner');
    const replacement = persistenceAccount('AppleReplacement');
    const originalTransactionId = '6500000000000000';
    const activePurchase = reconciliation({
      userId: owner.id,
      originalId: originalTransactionId,
      transactionId: '6500000000000001',
      signedDate: now,
      reconciledAt: now,
      active: true,
      bikeSeats: 3,
    });
    await createAuthUser(owner);
    await saveAppleSubscriptionReconciliation(owner.id, activePurchase);
    await expect(deleteAuthUserAccount(owner.id)).resolves.toMatchObject({ deleted: true });
    await expect(findAuthUserById(owner.id)).resolves.toBeNull();

    const tombstones = persistenceTestHooks.appleLineageBindings()
      .filter((binding) => binding.originalTransactionId === originalTransactionId);
    expect(tombstones).toEqual([expect.objectContaining({
      environment: 'sandbox',
      boundUserId: null,
      appAccountTokenHash: appleAppAccountTokenLineageHash(
        owner.id,
        originalTransactionId,
        'sandbox',
      ),
    })]);
    expect(JSON.stringify(tombstones)).not.toContain(owner.id);
    expect(JSON.stringify(tombstones)).not.toContain(owner.email);
    expect(JSON.stringify(tombstones)).not.toContain(owner.displayName);

    await createAuthUser(replacement);
    await expect(saveAppleSubscriptionReconciliation(replacement.id, activePurchase))
      .resolves.toMatchObject({ status: 'restore-required' });
    await expect(restoreDeletedAppleSubscription(replacement.id, reconciliation({
      userId: owner.id,
      originalId: originalTransactionId,
      transactionId: '6500000000000002',
      signedDate: now + 1,
      reconciledAt: now + 1,
      active: false,
      status: 'expired',
    }))).resolves.toMatchObject({ status: 'restore-required' });

    await expect(restoreDeletedAppleSubscription(replacement.id, activePurchase))
      .resolves.toMatchObject({
        status: 'saved',
        rebound: true,
        user: { membershipTier: 'racer', bikeSeats: 3 },
      });
    const restoredLineage = (await loadAppleSubscriptionLineagesForReconciliation(200))
      ?.find((lineage) => lineage.originalTransactionId === originalTransactionId);
    expect(restoredLineage).toMatchObject({
      userId: replacement.id,
      appAccountToken: replacement.id,
      appAccountTokenHashes: [tombstones[0]?.appAccountTokenHash],
    });
    expect(JSON.stringify(restoredLineage)).not.toContain(owner.id);

    // Once Restore has rebound the hash, ordinary lifecycle refreshes may use
    // Apple's original token without consuming any unbound tombstone.
    await expect(saveAppleSubscriptionReconciliation(replacement.id, activePurchase))
      .resolves.toMatchObject({ status: 'saved', rebound: false });

    await deleteAuthUserAccount(replacement.id);
  });

  it('preserves a missing Apple revocation timestamp as null', () => {
    expect(persistenceTestHooks.appleDate(null)).toBeNull();
    expect(persistenceTestHooks.appleDate(undefined)).toBeNull();
  });
});
