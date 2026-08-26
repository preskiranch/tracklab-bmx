import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  authorizeClubEventRoomJoin,
  createAuthSession,
  createClubEvent,
  enrollClubTabletDevice,
  ensureClub,
  ensureClubRosterMember,
  joinClubEvent,
  loadCurrentClubEvent,
  markClubEventParticipantLaunched,
  startClubEvent,
} from '../../cloud/persistence.mjs';

describe('Club Event persistence availability', () => {
  it('records launch only after the WebSocket layer explicitly acknowledges a joined participant', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const ownerProfileKey = `launch-owner-${suffix}`;
    const ownerUserId = `launch-user-${suffix}`;
    const clubId = `launch-club-${suffix}`;
    const eventId = `launch-event-${suffix}`;
    const deviceId = `launch-device-${suffix}`;
    const studioRiderId = `launch-rider-${suffix}`;
    const bikeDeviceId = `launch-bike-${suffix}`;
    const sessionTokenHash = `launch-athlete-session-${suffix}`;
    const authSessionTokenHash = `launch-owner-session-${suffix}`;
    await ensureClub(ownerProfileKey, 'Launch Test Club', clubId);
    await createAuthSession({
      id: `launch-auth-${suffix}`,
      userId: ownerUserId,
      tokenHash: authSessionTokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(enrollClubTabletDevice({
      id: deviceId,
      ownerProfileKey,
      ownerUserId,
      name: 'Launch tablet',
      tokenHash: `launch-device-token-${suffix}`,
      authSessionTokenHash,
    })).resolves.toBeTruthy();
    await ensureClubRosterMember(ownerProfileKey, studioRiderId, 'Launch Rider');
    await expect(createClubEvent({
      id: eventId,
      ownerProfileKey,
      activityType: 'straight-sprint',
      configuration: { trackId: 'launch-track' },
    })).resolves.toMatchObject({ status: 'created' });
    await expect(joinClubEvent({
      clubId,
      eventId,
      deviceId,
      studioRiderId,
      riderName: 'Launch Rider',
      bikeDeviceId,
      sessionTokenHash,
    })).resolves.toMatchObject({ status: 'joined' });
    await expect(startClubEvent({ ownerProfileKey, eventId, leadMs: 3_000 }))
      .resolves.toMatchObject({ status: 'started' });

    await expect(authorizeClubEventRoomJoin({
      clubId,
      eventId,
      deviceId,
      studioRiderId,
      bikeDeviceId,
      sessionTokenHash,
    })).resolves.toMatchObject({ status: 'authorized' });
    expect((await loadCurrentClubEvent(clubId))?.participants[0]?.launchedAt).toBeNull();

    await expect(markClubEventParticipantLaunched({
      clubId,
      eventId,
      deviceId,
      studioRiderId,
      bikeDeviceId,
      sessionTokenHash,
    })).resolves.toMatchObject({ status: 'launched' });
    expect((await loadCurrentClubEvent(clubId))?.participants[0]?.launchedAt).toEqual(expect.any(Number));
  });

  it('does not turn a configured database outage into an empty current event', () => {
    const persistenceUrl = new URL('../../cloud/persistence.mjs', import.meta.url).href;
    const source = `
      const persistence = await import(${JSON.stringify(persistenceUrl)});
      const expectUnavailableError = async (operation) => {
        try {
          await operation();
          return false;
        } catch (error) {
          return error?.code === 'TRACKLAB_CLUB_EVENT_PERSISTENCE_UNAVAILABLE';
        }
      };
      const currentUnavailable = await expectUnavailableError(
        () => persistence.loadCurrentClubEvent('outage-test-club'),
      );
      const deviceUnavailable = await expectUnavailableError(
        () => persistence.loadClubTabletDeviceByTokenHash('0'.repeat(64), { requireAvailable: true }),
      );
      const mutations = await Promise.all([
        persistence.createClubEvent({
          id: 'outage-event',
          ownerProfileKey: 'user:outage-owner',
          activityType: 'straight-sprint',
          configuration: {},
        }),
        persistence.joinClubEvent({
          clubId: 'outage-test-club',
          eventId: 'outage-event',
          deviceId: 'outage-device',
          studioRiderId: 'outage-rider',
          riderName: 'Outage Rider',
          bikeDeviceId: 'outage-bike',
          sessionTokenHash: '1'.repeat(64),
        }),
        persistence.releaseCurrentClubEventParticipantForSession({
          clubId: 'outage-test-club',
          deviceId: 'outage-device',
          sessionTokenHash: '1'.repeat(64),
        }),
        persistence.startClubEvent({
          ownerProfileKey: 'user:outage-owner',
          eventId: 'outage-event',
        }),
        persistence.cancelClubEvent({
          ownerProfileKey: 'user:outage-owner',
          eventId: 'outage-event',
        }),
      ]);
      try {
        if (!currentUnavailable || !deviceUnavailable) throw new Error('strict loader fell back during outage');
        if (mutations.some((result) => result?.status !== 'unavailable')) {
          throw new Error('Club Event mutation fell back during outage');
        }
      } catch (error) {
        console.error(error);
        process.exitCode = 3;
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://tracklab:tracklab@127.0.0.1:1/tracklab',
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
