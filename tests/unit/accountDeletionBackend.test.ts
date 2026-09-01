import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as persistence from '../../cloud/persistence.mjs';

function testUser(id: string, email: string, name: string) {
  return {
    id,
    email,
    displayName: name,
    passwordHash: 'scrypt:test:test',
    membershipTier: 'spectator',
    bikeSeats: 1,
    admin: false,
  };
}

describe('account erasure persistence', () => {
  it('deletes private account data and owned clubs while unclaiming outside club memberships', async () => {
    const suffix = randomUUID();
    const ownerId = randomUUID();
    const athleteId = randomUUID();
    const ownerProfileKey = `user:${ownerId}`;
    const athleteProfileKey = `user:${athleteId}`;
    const owner = await persistence.createAuthUser(testUser(
      ownerId,
      `deletion-owner-${suffix}@tracklab.test`,
      'Deletion Club Owner',
    ));
    const athleteEmail = `deletion-athlete-${suffix}@tracklab.test`;
    await persistence.createAuthUser(testUser(athleteId, athleteEmail, 'Deletion Athlete'));
    expect(owner).not.toBeNull();

    const club = await persistence.ensureClub(ownerProfileKey, 'Deletion Club', `club-${suffix}`);
    await persistence.ensureClubRosterMember(ownerProfileKey, `rider-${suffix}`, 'Deletion Athlete');
    const inviteHash = `invite-hash-${suffix}`;
    await persistence.saveClubInvite({
      club,
      studioRiderId: `rider-${suffix}`,
      riderName: 'Deletion Athlete',
      inviteId: `invite-${suffix}`,
      tokenHash: inviteHash,
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      persistence.claimClubInvite(inviteHash, athleteProfileKey, 'Deletion Athlete'),
    ).resolves.toMatchObject({ clubId: club?.id, studioRiderId: `rider-${suffix}` });
    const athleteOwnedClub = await persistence.ensureClub(
      athleteProfileKey,
      'Athlete Owned Club',
      `athlete-club-${suffix}`,
    );

    const sessionHash = `session-hash-${suffix}`;
    await persistence.createAuthSession({
      id: `session-${suffix}`,
      userId: athleteId,
      tokenHash: sessionHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await persistence.saveUserData(athleteProfileKey, {
      accountProfile: { photoUrl: 'data:image/png;base64,REVNTw==', updatedAt: Date.now() },
      exploreRoutes: [{ id: `route-${suffix}`, name: 'Private route' }],
    });
    const startedAt = Date.now() - 10_000;
    await persistence.saveTrainingSession(athleteProfileKey, {
      id: `training-${suffix}`,
      activityType: 'straight-sprint',
      title: 'Private sprint',
      startedAt,
      endedAt: startedAt + 8_000,
      durationMs: 8_000,
      distanceMeters: 100,
      source: 'live',
      details: { riderName: 'Deletion Athlete', peakWatts: 900 },
    });
    await persistence.saveRecoveryAlertPreference(athleteProfileKey, {
      mode: 'timer',
      timerSeconds: 120,
      targetBpm: 120,
      minimumSeconds: 30,
      maximumSeconds: 600,
    });
    await persistence.upsertAccountTrackFavorite({
      userId: athleteId,
      trackId: `track-${suffix}`,
      trackSnapshot: { id: `track-${suffix}`, name: 'Private favorite' },
    });

    const erased = await persistence.deleteAuthUserAccount(athleteId);
    expect(erased).toMatchObject({
      deleted: true,
      profileKey: athleteProfileKey,
      clubIds: [athleteOwnedClub?.id],
      authSessionTokenHashes: [sessionHash],
    });
    await expect(persistence.findAuthUserById(athleteId)).resolves.toBeNull();
    await expect(persistence.findAuthUserByEmail(athleteEmail)).resolves.toBeNull();
    await expect(persistence.findAuthSession(sessionHash)).resolves.toBeNull();
    await expect(persistence.loadTrainingSessions(athleteProfileKey)).resolves.toEqual([]);
    await expect(persistence.loadRecoveryAlertPreference(athleteProfileKey)).resolves.toBeNull();
    await expect(persistence.listAccountTrackFavorites(athleteId)).resolves.toEqual([]);
    await expect(persistence.loadUserData(athleteProfileKey)).resolves.toMatchObject({
      accountProfile: {},
      exploreRoutes: [],
    });
    await expect(persistence.loadClubConnectState(athleteProfileKey)).resolves.toEqual({
      ownedClub: null,
      memberships: [],
    });
    await expect(persistence.loadClubConnectState(ownerProfileKey)).resolves.toMatchObject({
      ownedClub: {
        id: club?.id,
        members: [expect.objectContaining({
          studioRiderId: `rider-${suffix}`,
          athleteProfileKey: null,
          status: 'unclaimed',
        })],
      },
    });

    // Removing the email index is part of erasure; the former address can
    // immediately create an unrelated clean account.
    const replacement = await persistence.createAuthUser(testUser(
      randomUUID(),
      athleteEmail,
      'Replacement Athlete',
    ));
    expect(replacement?.email).toBe(athleteEmail);
    await persistence.deleteAuthUserAccount(replacement?.id);
    await persistence.deleteAuthUserAccount(ownerId);
  });

  it('preserves another athlete private Watch summary when its club owner erases the club', async () => {
    const suffix = randomUUID();
    const ownerId = randomUUID();
    const athleteId = randomUUID();
    const ownerProfileKey = `user:${ownerId}`;
    const athleteProfileKey = `user:${athleteId}`;
    await persistence.createAuthUser(testUser(
      ownerId,
      `watch-erasure-owner-${suffix}@tracklab.test`,
      'Watch Erasure Club Owner',
    ));
    await persistence.createAuthUser(testUser(
      athleteId,
      `watch-erasure-athlete-${suffix}@tracklab.test`,
      'Watch Erasure Athlete',
    ));

    const clubId = `watch-erasure-club-${suffix}`;
    const studioRiderId = `watch-erasure-rider-${suffix}`;
    const club = await persistence.ensureClub(ownerProfileKey, 'Watch Erasure Club', clubId);
    await persistence.ensureClubRosterMember(ownerProfileKey, studioRiderId, 'Watch Erasure Athlete');
    const inviteHash = `watch-erasure-invite-${suffix}`;
    await persistence.saveClubInvite({
      club,
      studioRiderId,
      riderName: 'Watch Erasure Athlete',
      inviteId: `watch-erasure-invite-id-${suffix}`,
      tokenHash: inviteHash,
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      persistence.claimClubInvite(inviteHash, athleteProfileKey, 'Watch Erasure Athlete'),
    ).resolves.toEqual({ clubId, studioRiderId });

    const now = Date.now() - 10_000;
    const installIdHash = `watch-erasure-install-${suffix}`;
    const sharingEnrollmentId = `watch-erasure-sharing-${suffix}`;
    await expect(persistence.createOrRefreshHeartRateWatchEnrollment({
      id: sharingEnrollmentId,
      ownerProfileKey: athleteProfileKey,
      requestId: `watch-erasure-sharing-request-${suffix}`,
      installIdHash,
      scope: 'studio',
      clubId,
      studioRiderId,
      liveStudioConsent: true,
      sessionStudioConsent: true,
      now,
    })).resolves.toMatchObject({ status: 'created' });
    const personalEnrollmentId = `watch-erasure-personal-${suffix}`;
    await expect(persistence.createOrRefreshHeartRateWatchEnrollment({
      id: personalEnrollmentId,
      ownerProfileKey: athleteProfileKey,
      requestId: `watch-erasure-personal-request-${suffix}`,
      installIdHash,
      scope: 'personal',
      now,
    })).resolves.toMatchObject({ status: 'created' });
    const pairingId = `watch-erasure-pairing-${suffix}`;
    const ingestTokenHash = `watch-erasure-token-${suffix}`;
    await expect(persistence.createHeartRateWatchConnection({
      id: `watch-erasure-connection-${suffix}`,
      enrollmentId: personalEnrollmentId,
      ownerProfileKey: athleteProfileKey,
      requestId: `watch-erasure-connect-request-${suffix}`,
      installIdHash,
      pairingId,
      relaySessionId: `watch-connect:watch-erasure-${suffix}`,
      riderId: `account:watch-erasure-${suffix}`,
      pairCodeHash: `watch-erasure-code-${suffix}`,
      ingestTokenHash,
      connectedUntil: now + persistence.heartRateWatchConnectDurationMs,
      now,
    })).resolves.toMatchObject({ status: 'created' });
    const streamId = `watch-erasure-stream-${suffix}`;
    await expect(persistence.createHeartRateStream(
      pairingId,
      ingestTokenHash,
      streamId,
      now,
      now,
    )).resolves.toMatchObject({ id: streamId, relayScope: 'account-block' });

    const trainingSessionId = `watch-erasure-training-${suffix}`;
    const startedAt = now + 1_000;
    const endedAt = now + 5_000;
    await expect(persistence.insertHeartRateSamples(streamId, ingestTokenHash, [{
      sequence: 0,
      recordedAt: startedAt + 1_000,
      activeElapsedMs: 1_000,
      bpm: 154,
    }], startedAt + 1_000)).resolves.toEqual([0]);
    await expect(persistence.saveTrainingSession(athleteProfileKey, {
      id: trainingSessionId,
      activityType: 'get-pulled',
      title: 'Watch summary that outlives the club',
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      distanceMeters: 20,
      source: 'live',
      details: { riderName: 'Watch Erasure Athlete', peakWatts: 640 },
      _clubId: clubId,
      _studioRiderId: studioRiderId,
    })).resolves.toMatchObject({ id: trainingSessionId, _clubId: clubId, _studioRiderId: studioRiderId });
    await expect(persistence.createHeartRateTrainingSegmentForConsentedPersonalClubSession({
      athleteProfileKey,
      clubId,
      studioRiderId,
      trainingSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt,
      endedAt,
      zoneWindows: [],
      activeClockSegments: [],
      now: endedAt + 1_000,
    })).resolves.toMatchObject({
      status: 'created',
      segment: {
        relayScope: 'account-block',
        clubId,
        studioRiderId,
        studioVisible: true,
        summary: { sampleCount: 1, averageBpm: 154, peakBpm: 154 },
      },
    });

    await expect(persistence.deleteAuthUserAccount(ownerId)).resolves.toMatchObject({
      deleted: true,
      profileKey: ownerProfileKey,
      clubIds: [clubId],
    });
    const detachedSessions = await persistence.loadTrainingSessions(athleteProfileKey);
    expect(detachedSessions).toHaveLength(1);
    expect(detachedSessions[0]).toMatchObject({ id: trainingSessionId });
    expect(detachedSessions[0]).not.toHaveProperty('_clubId');
    expect(detachedSessions[0]).not.toHaveProperty('_studioRiderId');
    await expect(persistence.loadHeartRateTrainingSegments(
      athleteProfileKey,
      trainingSessionId,
    )).resolves.toEqual([expect.objectContaining({
      relayScope: 'account-block',
      clubId: null,
      studioRiderId: null,
      studioVisible: false,
      summary: expect.objectContaining({ sampleCount: 1, averageBpm: 154, peakBpm: 154 }),
    })]);

    await persistence.deleteAuthUserAccount(athleteId);
  });

  it('orders PostgreSQL erasure around non-cascading profile keys and the official account restriction', async () => {
    const source = await readFile(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const implementation = source.slice(
      source.indexOf('async function deletePostgresAuthUserAccount'),
      source.indexOf('export async function deleteAuthUserAccount'),
    );
    expect(implementation).toContain('withPersistenceLock(`account-delete:${userId}`');
    expect(implementation).toContain('DELETE FROM ${schema}.official_friend_accounts WHERE user_id = $1');
    expect(implementation).toContain('DELETE FROM ${schema}.training_sessions WHERE profile_key = $1');
    expect(implementation).toContain("status = 'unclaimed'");
    expect(implementation.indexOf('DELETE FROM ${schema}.official_friend_accounts')).toBeLessThan(
      implementation.lastIndexOf('DELETE FROM ${schema}.auth_users'),
    );
    expect(implementation).toContain('UPDATE ${schema}.heart_rate_training_segments');
    expect(implementation).toContain('UPDATE ${schema}.heart_rate_training_segment_bindings');
    expect(implementation).toContain("AND relay_scope = 'account-block'");
    expect(implementation).toContain('SET club_id = NULL, studio_rider_id = NULL, studio_visible = false');
    expect(implementation.indexOf('UPDATE ${schema}.heart_rate_training_segments')).toBeLessThan(
      implementation.indexOf('DELETE FROM ${schema}.clubs WHERE owner_profile_key = $1'),
    );
    expect(implementation.indexOf('UPDATE ${schema}.heart_rate_training_segment_bindings')).toBeLessThan(
      implementation.indexOf('DELETE FROM ${schema}.clubs WHERE owner_profile_key = $1'),
    );
  });
});
