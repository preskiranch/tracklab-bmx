import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  blockAccountProfile,
  claimFriendInvite,
  createAccountTrackShare,
  createAuthUser,
  createFriendInvite,
  deleteAccountTrackShare,
  listAccountTrackFavorites,
  listAccountTrackShares,
  openAccountTrackShare,
  persistenceTestHooks,
  removeAccountTrackFavorite,
  upsertAccountTrackFavorite,
} from '../../cloud/persistence.mjs';

function account(label: string) {
  const id = randomUUID();
  return {
    id,
    email: `${label}-${id}@example.com`,
    displayName: `${label} Rider`,
    username: `${label.toLowerCase()}-${id.slice(0, 8)}`,
    friendDiscoverable: true,
    passwordHash: 'test-only',
    membershipTier: 'spectator',
    bikeSeats: 1,
    admin: false,
  };
}

const track = Object.freeze({
  id: 'apple-valley-bmx-moto-park',
  name: 'Apple Valley BMX Moto Park',
  address: '24320 Highway 18, Apple Valley, CA, 92307',
  locationLabel: '24320 Highway 18, Apple Valley, CA, 92307',
  latitude: 34.5001,
  longitude: -117.185,
});

describe('track favorites and friend-share persistence', () => {
  it('isolates favorites by account and stores a server-provided snapshot', async () => {
    const alice = account('FavoriteAlice');
    const bob = account('FavoriteBob');
    await createAuthUser(alice);
    await createAuthUser(bob);

    const saved = await upsertAccountTrackFavorite({
      userId: alice.id,
      trackId: track.id,
      trackSnapshot: track,
    });

    expect(saved).toMatchObject({ trackId: track.id, trackSnapshot: track });
    await expect(listAccountTrackFavorites(alice.id)).resolves.toMatchObject([
      { trackId: track.id, trackSnapshot: track },
    ]);
    await expect(listAccountTrackFavorites(bob.id)).resolves.toEqual([]);
    await expect(removeAccountTrackFavorite(bob.id, track.id)).resolves.toBe(false);
    await expect(removeAccountTrackFavorite(alice.id, track.id)).resolves.toBe(true);
    await expect(listAccountTrackFavorites(alice.id)).resolves.toEqual([]);
  });

  it('requires an explicit unblocked friendship, authorizes only the recipient, and clears shares on block', async () => {
    const alice = account('ShareAlice');
    const bob = account('ShareBob');
    await createAuthUser(alice);
    await createAuthUser(bob);

    await expect(createAccountTrackShare({
      id: randomUUID(),
      senderUserId: alice.id,
      recipientUserId: bob.id,
      trackId: track.id,
      trackSnapshot: track,
    })).resolves.toBeNull();

    const inviteHash = `test-hash-${randomUUID()}`;
    await createFriendInvite({
      id: randomUUID(),
      inviterUserId: alice.id,
      tokenHash: inviteHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(claimFriendInvite(inviteHash, bob.id)).resolves.toBeTruthy();

    const created = await createAccountTrackShare({
      id: randomUUID(),
      senderUserId: alice.id,
      recipientUserId: bob.id,
      trackId: track.id,
      trackSnapshot: track,
    });
    expect(created).toMatchObject({
      senderUserId: alice.id,
      recipientUserId: bob.id,
      openedAt: null,
      profile: { profileId: bob.id },
    });
    if (!created) throw new Error('Expected a saved share.');

    await expect(listAccountTrackShares(alice.id)).resolves.toEqual([]);
    await expect(openAccountTrackShare(alice.id, created.id)).resolves.toBeNull();
    await expect(openAccountTrackShare(bob.id, created.id)).resolves.toMatchObject({
      id: created.id,
      profile: { profileId: alice.id },
    });

    const replay = await createAccountTrackShare({
      id: randomUUID(),
      senderUserId: alice.id,
      recipientUserId: bob.id,
      trackId: track.id,
      trackSnapshot: track,
    });
    expect(replay).toMatchObject({ id: created.id, openedAt: null });
    await expect(listAccountTrackShares(bob.id)).resolves.toHaveLength(1);
    await expect(deleteAccountTrackShare(alice.id, created.id)).resolves.toBe(false);

    await expect(blockAccountProfile(bob.id, alice.id)).resolves.toBeTruthy();
    await expect(listAccountTrackShares(bob.id)).resolves.toEqual([]);
    await expect(openAccountTrackShare(bob.id, created.id)).resolves.toBeNull();
  });

  it('locks pair mutations around SQL that excludes official-only and blocked relationships', () => {
    const createSql = persistenceTestHooks.accountTrackShareCreateStatement();
    const openSql = persistenceTestHooks.accountTrackShareOpenStatement();
    const listSql = persistenceTestHooks.accountTrackSharesListStatement();

    for (const sql of [createSql, openSql, listSql]) {
      expect(sql).toContain("friendship.source <> 'official'");
      expect(sql).toContain('friend_blocks');
    }
    expect(createSql).toContain('ON CONFLICT (sender_user_id, recipient_user_id, track_id) DO UPDATE');
    expect(openSql).toContain('share.recipient_user_id = $2');
    expect(listSql).toContain('share.recipient_user_id = $1');
    expect(listSql).not.toContain('email');
  });
});
