import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findBillingCheckout,
  pruneExpiredData,
  saveBillingCheckout,
} from '../../cloud/persistence.mjs';

describe('expired persistence pruning', () => {
  it('pins every PostgreSQL cutoff parameter to timestamptz before interval arithmetic', () => {
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const pruneSource = source.slice(
      source.indexOf('export async function pruneExpiredData'),
      source.indexOf('export async function closePersistence'),
    );

    expect(pruneSource.match(/\$1::timestamptz - interval/g)).toHaveLength(5);
    expect(pruneSource).not.toMatch(/\$1(?!::timestamptz)\s*-\s*interval/);
    expect(pruneSource.match(/\$1::timestamptz/g)).toHaveLength(8);
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
});
