import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Server module.
import * as store from '../../cloud/persistence.mjs';
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
async function parent() {
  const id = randomUUID();
  return store.createAuthUser({ id, email: `${id}@tracklab.test`, displayName: 'Parent', passwordHash: 'disabled', membershipTier: 'spectator', bikeSeats: 1 });
}
const session = () => ({ id: randomUUID(), tokenHash: hash(), expiresAt: new Date(Date.now() + 60000).toISOString() });

describe('managed device transactions', () => {
  it('expires links and permits only one competing device to redeem a token', async () => {
    const owner = await parent(); const child = await store.createFamilyChild(owner.id, 'Child');
    const expired = hash(); await store.createFamilyDeviceInvitation(owner.id, child.id, expired, Date.now() - 900001);
    expect(await store.acceptFamilyDeviceInvitation(expired, session())).toBeNull();
    const token = hash(); await store.createFamilyDeviceInvitation(owner.id, child.id, token);
    const a = session(); const b = session();
    const attempts = await Promise.all([store.acceptFamilyDeviceInvitation(token, a), store.acceptFamilyDeviceInvitation(token, b)]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect((await Promise.all([store.findAuthSession(a.tokenHash), store.findAuthSession(b.tokenHash)])).filter(Boolean)).toHaveLength(1);
    expect(await store.loadManagedDeviceChild(`child-${child.id}`)).toMatchObject({ profileKey: child.profileKey, parentUserId: owner.id });
  });
  it('fully deletes child credentials with the parent while preserving unrelated users', async () => {
    const owner = await parent(); const unrelated = await parent(); const child = await store.createFamilyChild(owner.id, 'Erase child');
    const token = hash(); await store.createFamilyDeviceInvitation(owner.id, child.id, token);
    const active = session(); const deviceUser = await store.acceptFamilyDeviceInvitation(token, active);
    await store.saveUserData(child.profileKey, { accountProfile: { updatedAt: Date.now(), personalRecords: { reactionTestBestMs: 125 } } });
    expect((await store.deleteAuthUserAccount(owner.id)).deleted).toBe(true);
    expect(await store.findAuthUserById(deviceUser.id)).toBeNull();
    expect(await store.findAuthSession(active.tokenHash)).toBeNull();
    expect(await store.loadManagedDeviceChild(deviceUser.id)).toBeNull();
    expect(await store.findAuthUserById(unrelated.id)).toBeTruthy();
    expect(await store.acceptFamilyDeviceInvitation(token, session())).toBeNull();
  });
  it.skipIf(!String(process.env.DATABASE_URL).includes('family48_tests_child49'))('rolls back child user and session creation if invitation consumption fails', async () => {
    const owner = await parent(); const child = await store.createFamilyChild(owner.id, 'Rollback child');
    const token = hash(); await store.createFamilyDeviceInvitation(owner.id, child.id, token);
    const active = session();
    await store.query(`CREATE FUNCTION tracklab.child49_claim_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'child49 rollback test'; END $$;
      CREATE TRIGGER child49_claim_failure BEFORE UPDATE OF claimed_at ON tracklab.family_device_invites FOR EACH ROW EXECUTE FUNCTION tracklab.child49_claim_failure()`);
    try {
      await expect(store.acceptFamilyDeviceInvitation(token, active)).rejects.toBeTruthy();
      expect(await store.findAuthUserById(`child-${child.id}`)).toBeNull();
      expect(await store.findAuthSession(active.tokenHash)).toBeNull();
      expect(await store.previewFamilyDeviceInvitation(token)).toMatchObject({ name: 'Rollback child' });
    } finally {
      await store.query('DROP TRIGGER child49_claim_failure ON tracklab.family_device_invites; DROP FUNCTION tracklab.child49_claim_failure()');
    }
    expect(await store.acceptFamilyDeviceInvitation(token, active)).toMatchObject({ id: `child-${child.id}` });
  });
});
