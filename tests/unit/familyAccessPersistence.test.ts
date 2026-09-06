import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Server module under test.
import * as store from '../../cloud/persistence.mjs';
// @ts-expect-error Server module under test.
import { familyChildName, familyInvitationDurationMs } from '../../cloud/familyAccess.mjs';

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
async function user(name = 'Family parent') {
  const id = randomUUID();
  return store.createAuthUser({ id, email: `${id}@tracklab.test`, displayName: name,
    passwordHash: 'scrypt:test:test', membershipTier: 'spectator', bikeSeats: 1 });
}
async function invite(parent: any, now = Date.now()) {
  const tokenHash = hash();
  const invitation = await store.createFamilyLinkInvitation(parent.id, tokenHash, now);
  return { tokenHash, invitation };
}
async function clubInvitation(owner: any, riderId = randomUUID()) {
  const club = await store.ensureClub(`user:${owner.id}`, 'Family test club', randomUUID());
  const tokenHash = hash();
  await store.saveClubInvite({ club, studioRiderId: riderId, riderName: 'Club child', inviteId: randomUUID(),
    tokenHash, expiresAt: Date.now() + 60000 });
  return { club, tokenHash, riderId };
}

describe('family identities and permission persistence', () => {
  it('creates distinct email-free siblings even with identical names and rejects foreign lookups', async () => {
    const [parent, outsider] = await Promise.all([user(), user()]);
    const a = await store.createFamilyChild(parent.id, '  Same   name  ');
    const b = await store.createFamilyChild(parent.id, 'Same name');
    expect(a.name).toBe('Same name');
    expect(a.profileKey).not.toBe(b.profileKey);
    expect(a.profileKey).toMatch(/^family-child:/);
    expect(a.linkedUserId).toBeNull();
    expect((await store.loadFamilyAccess(parent.id)).children.map((c: any) => c.id)).toEqual([a.id, b.id]);
    await expect(store.loadFamilyChild(outsider.id, a.id)).resolves.toBeNull();
    await expect(store.findAuthUserById(a.id)).resolves.toBeNull();
    expect(familyChildName('')).toBeNull();
    expect(familyChildName('a'.repeat(81))).toBeNull();
  });

  it('requires subject approval, rejects self-link and allows exactly one concurrent claimant', async () => {
    const [parent, a, b] = await Promise.all([user(), user('Child A'), user('Child B')]);
    const { tokenHash, invitation } = await invite(parent);
    expect(invitation.expiresAt - invitation.createdAt).toBe(familyInvitationDurationMs);
    await expect(store.acceptFamilyLinkInvitation(tokenHash, a.id, false)).resolves.toBeNull();
    await expect(store.acceptFamilyLinkInvitation(tokenHash, parent.id, true)).resolves.toBeNull();
    const claims = await Promise.all([
      store.acceptFamilyLinkInvitation(tokenHash, a.id, true), store.acceptFamilyLinkInvitation(tokenHash, b.id, true),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await store.loadFamilyAccess(parent.id)).children).toHaveLength(1);
    await expect(store.acceptFamilyLinkInvitation(tokenHash, a.id, true)).resolves.toBeNull();
    const serialized = JSON.stringify(await store.loadFamilyAccess(parent.id));
    expect(serialized).not.toContain(tokenHash);
    expect(serialized).not.toMatch(/tokenHash|token_hash/);
  });

  it('rejects expired/revoked invitations and lets the linked child revoke while preserving independent data', async () => {
    const [parent, child, outsider] = await Promise.all([user(), user(), user()]);
    const expired = await invite(parent, Date.now() - familyInvitationDurationMs);
    await expect(store.acceptFamilyLinkInvitation(expired.tokenHash, child.id, true)).resolves.toBeNull();
    const revoked = await invite(parent);
    expect(await store.revokeFamilyInvitation(outsider.id, revoked.invitation.id)).toBe(false);
    expect(await store.revokeFamilyInvitation(parent.id, revoked.invitation.id)).toBe(true);
    await expect(store.previewFamilyLinkInvitation(revoked.tokenHash)).resolves.toBeNull();
    const active = await invite(parent);
    const linked = await store.acceptFamilyLinkInvitation(active.tokenHash, child.id, true);
    await store.saveUserData(`user:${child.id}`, { accountProfile: { personalRecords: { getPulledMaxWatts: 900 }, updatedAt: 1 } });
    expect(await store.revokeFamilyAccess(outsider.id, linked.id, true)).toBe(false);
    expect(await store.revokeFamilyAccess(child.id, linked.id, true)).toBe(true);
    await expect(store.loadFamilyChild(parent.id, linked.id)).resolves.toBeNull();
    expect((await store.loadUserData(`user:${child.id}`)).accountProfile.personalRecords.getPulledMaxWatts).toBe(900);
    expect((await store.findAuthUserById(child.id)).id).toBe(child.id);
  });

  it('atomically claims only the chosen managed child without changing the parent account', async () => {
    const [parent, clubOwner, outsider] = await Promise.all([user('Parent unchanged'), user(), user()]);
    const [a, b] = await Promise.all([store.createFamilyChild(parent.id, 'A'), store.createFamilyChild(parent.id, 'B')]);
    const issued = await clubInvitation(clubOwner);
    await expect(store.claimFamilyClubInvitation(outsider.id, a.id, issued.tokenHash)).resolves.toBeNull();
    const claims = await Promise.all([
      store.claimFamilyClubInvitation(parent.id, a.id, issued.tokenHash),
      store.claimFamilyClubInvitation(parent.id, b.id, issued.tokenHash),
      store.claimClubInvite(issued.tokenHash, `user:${outsider.id}`, 'Outsider'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const state = await store.loadClubConnectState(`user:${clubOwner.id}`);
    const winnerProfileKey = claims[0] ? a.profileKey : claims[1] ? b.profileKey : `user:${outsider.id}`;
    expect(state.ownedClub.members[0].athleteProfileKey).toBe(winnerProfileKey);
    const losingChild = winnerProfileKey === a.profileKey ? b : a;
    expect((await store.loadClubConnectState(losingChild.profileKey)).memberships).toHaveLength(0);
    expect((await store.findAuthUserById(parent.id)).displayName).toBe('Parent unchanged');
    const replacement = await clubInvitation(clubOwner, issued.riderId);
    await expect(store.claimFamilyClubInvitation(parent.id, losingChild.id, replacement.tokenHash)).resolves.toBeNull();
  });

  it('deletes managed keys on parent deletion, preserves linked records, and defeats concurrent new children', async () => {
    const [parent, child] = await Promise.all([user(), user()]);
    const managed = await store.createFamilyChild(parent.id, 'Managed');
    const now = Date.now();
    const saved = await store.saveTrainingSession(managed.profileKey, { id: `managed-session-${randomUUID()}`, activityType: 'bmx-race',
      title: 'Managed child activity', source: 'live', createdAt: now, startedAt: now - 1000, endedAt: now,
      durationMs: 1000, distanceMeters: 20, details: {} });
    expect(saved).not.toBeNull();
    expect(await store.loadTrainingSessions(managed.profileKey, { from: 0, to: now + 1000, limit: 10 })).toHaveLength(1);
    await store.saveUserData(managed.profileKey, { accountProfile: { photoUrl: 'managed-private', updatedAt: 1 } });
    await store.saveUserData(`user:${child.id}`, { accountProfile: { photoUrl: 'independent-private', updatedAt: 1 } });
    const trackId = `family-delete-track-${randomUUID()}`;
    const ghostIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, ownerKey] of [managed.profileKey, `user:${child.id}`, `user:${parent.id}`].entries()) {
      expect(await store.saveGhostLap({ id: ghostIds[index], ownerKey, ownerName: 'Family deletion fixture',
        riderName: `Family rider ${index}`, trackId, trackName: 'Family deletion track', finishTimeMs: 1000 + index,
        colorName: 'Blue', accent: '#00f', raceSource: 'live', lapCount: 1, savedAt: now,
        summary: {}, zoneResults: [], points: [] })).not.toBeNull();
    }
    expect((await store.loadGhostLaps(trackId, managed.profileKey)).map((ghost: any) => ghost.id))
      .toEqual(expect.arrayContaining(ghostIds));
    const racingWrites = () => [
      store.saveUserData(managed.profileKey, { accountProfile: { photoUrl: 'in-flight', updatedAt: now } }),
      store.saveTrainingSession(managed.profileKey, { ...saved, id: 'in-flight-session' }),
      store.saveGhostLap({ id: randomUUID(), ownerKey: managed.profileKey, ownerName: 'In-flight child',
        riderName: 'In-flight child', trackId, trackName: 'Family deletion track', finishTimeMs: 999,
        colorName: 'Blue', accent: '#00f', raceSource: 'live', lapCount: 1, savedAt: now, summary: {}, points: [] }),
      store.saveLocalRaceResults({ sessionId: 'in-flight-race', profileKey: managed.profileKey, trackId,
        trackName: 'Family deletion track', summaries: [{ playerId: 1, riderName: 'In-flight child',
          rank: 1, finishTimeMs: 999, distanceMeters: 20, topSpeedKph: 30, averageSpeedKph: 20,
          topCadence: 100, averageCadence: 80, topWatts: 700, averageWatts: 300 }] }),
    ];
    const link = await invite(parent);
    await store.acceptFamilyLinkInvitation(link.tokenHash, child.id, true);
    await Promise.all([...racingWrites(), store.createFamilyChild(parent.id, 'Concurrent'), store.deleteAuthUserAccount(parent.id)]);
    // Requests authorized before deletion must not recreate an erased identity
    // even if they reach their storage write after the deletion commits.
    expect(await Promise.all(racingWrites())).toEqual([null, null, null, null]);
    expect((await store.loadFamilyAccess(parent.id)).children).toHaveLength(0);
    expect((await store.loadFamilyAccess(child.id)).sharedWith).toHaveLength(0);
    expect((await store.loadUserData(managed.profileKey)).accountProfile).toEqual({});
    expect(await store.loadTrainingSessions(managed.profileKey, { from: 0, to: now + 1000, limit: 10 })).toEqual([]);
    expect((await store.loadUserData(`user:${child.id}`)).accountProfile.photoUrl).toBe('independent-private');
    expect((await store.loadGhostLaps(trackId, `user:${child.id}`)).map((ghost: any) => ghost.id)).toEqual([ghostIds[1]]);
    expect(await store.loadLeaderboards(trackId)).toEqual({ rpm: [], speed: [] });
    await expect(store.createFamilyChild(parent.id, 'After deletion')).resolves.toBeNull();
  });

  it('archives and restores only managed profiles, keeping the same isolated record key', async () => {
    const [parent, outsider] = await Promise.all([user(), user()]);
    const child = await store.createFamilyChild(parent.id, 'Restore child');
    await store.revokeFamilyAccess(parent.id, child.id);
    expect(await store.saveUserData(child.profileKey, { accountProfile: { updatedAt: 1 } })).not.toBeNull();
    expect((await store.loadFamilyAccess(parent.id)).archivedChildren[0].id).toBe(child.id);
    await expect(store.restoreManagedFamilyChild(outsider.id, child.id)).resolves.toBeNull();
    expect((await store.restoreManagedFamilyChild(parent.id, child.id)).profileKey).toBe(child.profileKey);
    expect((await store.loadFamilyAccess(parent.id)).archivedChildren).toHaveLength(0);
  });

  it.skipIf(!String(process.env.DATABASE_URL).includes('family48_tests'))('rolls back a grant if PostgreSQL fails while consuming its invitation', async () => {
    const [parent, child] = await Promise.all([user(), user()]);
    const issued = await invite(parent);
    await store.query(`CREATE FUNCTION tracklab.family_test_claim_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'family test rollback'; END $$;
      CREATE TRIGGER family_test_claim_failure BEFORE UPDATE OF claimed_at ON tracklab.family_link_invites
      FOR EACH ROW EXECUTE FUNCTION tracklab.family_test_claim_failure()`);
    try {
      await expect(store.acceptFamilyLinkInvitation(issued.tokenHash, child.id, true)).rejects.toMatchObject({ code: 'TRACKLAB_FAMILY_STORAGE_UNAVAILABLE' });
      expect((await store.loadFamilyAccess(parent.id)).children).toHaveLength(0);
      expect(await store.previewFamilyLinkInvitation(issued.tokenHash)).toMatchObject({ id: issued.invitation.id, claimedAt: null });
    } finally {
      await store.query('DROP TRIGGER family_test_claim_failure ON tracklab.family_link_invites; DROP FUNCTION tracklab.family_test_claim_failure()');
    }
    expect(await store.acceptFamilyLinkInvitation(issued.tokenHash, child.id, true)).toMatchObject({ linkedUserId: child.id });
  });
});
