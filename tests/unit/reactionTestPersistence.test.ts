import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as persistence from '../../cloud/persistence.mjs';
import { databaseMigrations } from '../../cloud/migrations.mjs';

async function account() {
  const id = randomUUID();
  await persistence.createAuthUser({ id, email: `${id}@tracklab.test`, displayName: 'Private Account Name',
    passwordHash: 'unused-test-hash', membershipTier: 'spectator', bikeSeats: 1, admin: false });
  return id;
}

describe('Reaction Test measured best persistence', () => {
  it('keeps concurrent minima, opt-in settings and account erasure independent', async () => {
    const id = await account();
    await persistence.saveReactionTestLeaderboardSettings(id, { joined: true, displayName: 'Public Rider' });
    await Promise.all([250, 110, 190, 350, 110].map((ms) => persistence.saveReactionTestBest(id, ms)));
    await persistence.saveUserData(`user:${id}`, { accountProfile: { personalRecords: { reactionTestBestMs: 1 } } });
    await persistence.saveReactionTestBest(id, 70, 'studio-private');
    await expect(persistence.loadReactionTestBest(id)).resolves.toEqual({
      personalBestMs: 110, leaderboard: { joined: true, displayName: 'Public Rider' },
    });
    await expect(persistence.loadReactionTestLeaderboard(id, 5)).resolves.toEqual([
      { rank: 1, displayName: 'Public Rider', reactionTimeMs: 110, isYou: true },
    ]);
    await persistence.saveReactionTestLeaderboardSettings(id, { joined: false, displayName: '' });
    await expect(persistence.loadReactionTestLeaderboard(id, 50)).resolves.toEqual([]);
    await persistence.saveReactionTestLeaderboardSettings(id, { joined: true, displayName: 'Renamed Rider' });
    await expect(persistence.loadReactionTestLeaderboard()).resolves.toEqual([
      { rank: 1, displayName: 'Renamed Rider', reactionTimeMs: 110, isYou: false },
    ]);
    await persistence.deleteAuthUserAccount(id);
    await expect(persistence.loadReactionTestLeaderboard()).resolves.toEqual([]);
    await expect(persistence.loadReactionTestBest(id)).resolves.toMatchObject({ personalBestMs: null });
    await expect(persistence.loadReactionTestBest(id, 'studio-private')).resolves.toMatchObject({ personalBestMs: null });
    await expect(persistence.saveReactionTestBest(id, 50)).rejects.toThrow();
  });

  it('applies leaderboard limits without duplicates or private identity fields', async () => {
    const ids = [];
    for (let index = 0; index < 55; index += 1) {
      const id = await account(); ids.push(id);
      await persistence.saveReactionTestBest(id, 100 + index);
      await persistence.saveReactionTestLeaderboardSettings(id, { joined: true, displayName: `Rider ${index}` });
    }
    for (const limit of [5, 10, 25, 50]) {
      const rows = await persistence.loadReactionTestLeaderboard(ids[0], limit);
      expect(rows).toHaveLength(limit);
      expect(rows.at(-1)).toEqual({ rank: limit, displayName: `Rider ${limit - 1}`, reactionTimeMs: 99 + limit, isYou: false });
      expect(rows[0]).toEqual({ rank: 1, displayName: 'Rider 0', reactionTimeMs: 100, isYou: true });
    }
    await Promise.all(ids.map((id) => persistence.deleteAuthUserAccount(id)));
  });

  it('removes historical reactions before applying account and club history limits', async () => {
    const id = await account();
    const profileKey = `user:${id}`;
    const club = await persistence.ensureClub(profileKey, 'History Club', randomUUID());
    const now = Date.now();
    const session = { id: 'real-training', activityType: 'bmx-race', title: 'BMX Race', startedAt: now - 1000,
      endedAt: now - 500, durationMs: 500, distanceMeters: 100, source: 'live', details: {}, _clubId: club.id };
    await persistence.saveTrainingSession(profileKey, session);
    await persistence.saveTrainingSession('old-tablet-profile', session);
    for (const target of [profileKey, 'old-tablet-profile']) {
      await persistence.saveTrainingSession(target, { ...session, id: 'old-reaction-row', title: 'Reaction Test · EXCELLENT',
        startedAt: now - 100, details: { reactionTest: { valid: true, reactionTimeMs: 50 } } });
    }
    expect((await persistence.loadTrainingSessions(profileKey, { limit: 1 }))[0]?.id).toBe('real-training');
    expect((await persistence.loadClubTrainingSessions(profileKey, { limit: 1 }))[0]?.id).toBe('real-training');
    await persistence.deleteAuthUserAccount(id);
  });

  it('migrates durable bests with cascade deletion and an atomic PostgreSQL minimum', () => {
    const migration = databaseMigrations().find((entry: { version: number }) => entry.version === 45);
    expect(migration?.statements.join('\n')).toContain('REFERENCES tracklab.auth_users(id) ON DELETE CASCADE');
    expect(migration?.statements.join('\n')).toContain('PRIMARY KEY (user_id, studio_rider_id)');
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    expect(source).toContain('best_ms = LEAST(reaction_test_bests.best_ms, EXCLUDED.best_ms)');
    expect(source).toMatch(/AND NOT \(sessions.details \? 'reactionTest'\)[\s\S]*?ORDER BY sessions.started_at DESC LIMIT/);
  });

  it('separates the recording expiry from upload grace and never reopens an ended session', async () => {
    const id = await account();
    const now = Date.now();
    const profileKey = `user:${id}`;
    const club = await persistence.ensureClub(profileKey, 'Deferred Reaction Club', randomUUID());
    const authHash = randomUUID();
    const deviceId = randomUUID();
    await persistence.createAuthSession({ id: randomUUID(), userId: id, tokenHash: authHash,
      expiresAt: new Date(now + 60_000).toISOString() });
    await persistence.enrollClubTabletDevice({ id: deviceId, ownerProfileKey: profileKey, ownerUserId: id,
      name: 'Deferred Reaction Tablet', tokenHash: randomUUID(), authSessionTokenHash: authHash });
    await persistence.ensureClubRosterMember(profileKey, 'deadline-athlete', 'Deadline Athlete');
    const resultHash = randomUUID();
    const sessionHash = randomUUID();
    await persistence.createClubTabletResultAuthorization({ tokenHash: resultHash, deviceId, clubId: club.id,
      studioRiderId: 'deadline-athlete', riderName: 'Deadline Athlete', bikeDeviceId: 'Deadline Bike',
      sessionTokenHash: sessionHash, expiresAt: now + 10_000, recordingExpiresAt: now + 100, now });
    await persistence.updateClubTabletResultRecordingDeadline(sessionHash, now + 500);
    await expect(persistence.loadClubTabletResultAuthorization({ tokenHash: resultHash, deviceId, now })).resolves.toMatchObject({
      status: 'authorized', authorization: { recordingExpiresAt: now + 500 },
    });
    await persistence.updateClubTabletResultRecordingDeadline(sessionHash, now + 200, { ended: true });
    await persistence.updateClubTabletResultRecordingDeadline(sessionHash, now + 1000);
    await expect(persistence.loadClubTabletResultAuthorization({ tokenHash: resultHash, deviceId, now: now + 900 })).resolves.toMatchObject({
      status: 'authorized', authorization: { recordingExpiresAt: now + 200, expiresAt: now + 10_000 },
    });
    await persistence.deleteAuthUserAccount(id);
  });
});
