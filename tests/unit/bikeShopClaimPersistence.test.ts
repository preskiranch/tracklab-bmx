import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as persistence from '../../cloud/persistence.mjs';

function testUser(id: string, email: string, displayName: string) {
  return {
    id,
    email,
    displayName,
    passwordHash: 'scrypt:test:test',
    membershipTier: 'spectator',
    bikeSeats: 1,
    admin: false,
  };
}

function claimCandidate(claimantUserId: string, suffix: string) {
  return {
    claimantUserId,
    source: 'openstreetmap',
    osmElementType: 'node',
    osmElementId: String(BigInt(`1${suffix.replace(/\D/g, '').slice(0, 16) || '1'}`)),
    shopName: `Persistence Bikes ${suffix}`,
    latitude: 38.356,
    longitude: -121.987,
    shopSnapshot: { id: `osm:node:${suffix}`, name: `Persistence Bikes ${suffix}` },
    claimantRole: 'owner',
    verificationMethod: 'business-email',
    businessEmail: `owner-${suffix}@tracklab.test`,
    businessPhone: '+1 555 555 0199',
    verificationNote: 'This unrelated free-form note must not be retained.',
  };
}

describe('bike shop claim persistence', () => {
  it('minimizes evidence, permits corrected retries, and rejects duplicate active claims', async () => {
    const suffix = Date.now().toString();
    const claimantUserId = randomUUID();
    const reviewerUserId = randomUUID();
    await persistence.createAuthUser(testUser(
      claimantUserId,
      `shop-claimant-${suffix}@tracklab.test`,
      'Shop Claimant',
    ));
    await persistence.createAuthUser(testUser(
      reviewerUserId,
      `shop-reviewer-${suffix}@tracklab.test`,
      'Shop Reviewer',
    ));
    const candidate = claimCandidate(claimantUserId, suffix);

    const first = await persistence.createBikeShopClaimRequest(candidate);
    expect(first).toMatchObject({
      status: 'pending',
      businessEmail: candidate.businessEmail,
      businessPhone: '',
      verificationNote: '',
    });
    await expect(persistence.createBikeShopClaimRequest(candidate)).resolves.toBeNull();
    await expect(
      persistence.withdrawPendingBikeShopClaimRequest(claimantUserId, first?.id),
    ).resolves.toBe(true);

    const phoneRetry = await persistence.createBikeShopClaimRequest({
      ...candidate,
      verificationMethod: 'business-phone',
      businessEmail: 'must-not-be-stored@tracklab.test',
      businessPhone: '+1 555 555 0101',
      verificationNote: 'This unrelated note must not be retained either.',
    });
    expect(phoneRetry).toMatchObject({
      status: 'pending',
      businessEmail: '',
      businessPhone: '+1 555 555 0101',
      verificationNote: '',
    });
    await expect(persistence.reviewBikeShopClaimRequest({
      claimId: phoneRetry?.id,
      reviewerUserId,
      status: 'rejected',
      reviewNote: 'Use a document instead.',
    })).resolves.toMatchObject({ status: 'rejected' });

    const documentRetry = await persistence.createBikeShopClaimRequest({
      ...candidate,
      verificationMethod: 'documentation',
      businessEmail: 'must-not-be-stored@tracklab.test',
      businessPhone: '+1 555 555 0102',
      verificationNote: 'State registration matches the directory listing.',
    });
    expect(documentRetry).toMatchObject({
      status: 'pending',
      businessEmail: '',
      businessPhone: '',
      verificationNote: 'State registration matches the directory listing.',
    });
    await expect(persistence.reviewBikeShopClaimRequest({
      claimId: documentRetry?.id,
      reviewerUserId,
      status: 'approved',
      reviewNote: 'Registration verified.',
    })).resolves.toMatchObject({ status: 'approved' });
    await expect(persistence.createBikeShopClaimRequest(candidate)).resolves.toBeNull();

    const pendingAtDeletion = await persistence.createBikeShopClaimRequest({
      ...candidate,
      osmElementId: `${candidate.osmElementId}7`,
      shopName: `Unfinished Claim ${suffix}`,
    });
    expect(pendingAtDeletion).toMatchObject({ status: 'pending' });

    await persistence.deleteAuthUserAccount(claimantUserId);
    await expect(persistence.listBikeShopClaimRequestsForUser(claimantUserId)).resolves.toEqual([]);
    await expect(persistence.loadApprovedBikeShopClaimIdentities([candidate])).resolves.toEqual([
      expect.objectContaining({
        source: candidate.source,
        osmElementType: candidate.osmElementType,
        osmElementId: candidate.osmElementId,
        claimed: true,
      }),
    ]);
    const retained = await persistence.listBikeShopClaimRequestsForReview({ status: 'all', limit: 100 });
    expect(retained.items.some((claim) => claim.id === pendingAtDeletion?.id)).toBe(false);
    const retainedIds = new Set([first?.id, phoneRetry?.id, documentRetry?.id]);
    const retainedHistory = retained.items.filter((claim) => retainedIds.has(claim.id));
    expect(retainedHistory).toHaveLength(3);
    expect(retainedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'withdrawn' }),
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'approved' }),
    ]));
    retainedHistory.forEach((claim) => {
      expect(claim).toMatchObject({
        businessEmail: '',
        businessPhone: '',
        verificationNote: '',
        reviewNote: '',
        claimant: { displayName: '', email: '' },
      });
    });

    await persistence.deleteAuthUserAccount(reviewerUserId);
  });

  it('uses failure-propagating wrappers for every PostgreSQL claim operation', async () => {
    const source = await readFile(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const claimPersistence = source.slice(
      source.indexOf('export async function createBikeShopClaimRequest'),
      source.indexOf('export async function listAccountTrackFavorites'),
    );
    expect(source).toContain('export class BikeShopClaimPersistenceUnavailableError');
    expect(claimPersistence).toContain('withBikeShopClaimPersistenceLock(');
    expect(claimPersistence).toContain('bikeShopClaimQuery(');
    expect(claimPersistence).not.toContain('const result = await query(');
    expect(claimPersistence).not.toContain('const result = await withPersistenceLock(');
    expect(source).toContain("WHERE claimant_user_id = $1 AND status = 'pending'");
    expect(source).toContain('SET claimant_user_id = NULL');
  });
});
