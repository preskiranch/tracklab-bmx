import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  claimFriendInvite,
  createAccountFriendRequest,
  createAccountTrackShare,
  createAuthSession,
  createAuthUser,
  createDurableLiveAudioFriendInvite,
  createFriendInvite,
  deleteAuthSession,
  deletePushInstallation,
  enrollClubTabletDevice,
  enqueuePushEvent,
  ensureClub,
  leasePushDeliveries,
  leasePushEvents,
  listActivePushInstallations,
  listPendingDurableLiveAudioFriendInvites,
  loadPushPreferences,
  markPushEventState,
  openAccountTrackShare,
  preparePushDeliveries,
  pruneExpiredData,
  pushEventIsEligible,
  recordPushDeliveryResult,
  registerPushInstallation,
  respondToAccountFriendRequest,
  savePushPreferences,
  transitionDurableLiveAudioFriendInvite,
  withCurrentPushDeliveryLease,
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

async function session(userId: string, expiresAt = Date.now() + 60_000) {
  const tokenHash = `session-${randomUUID()}`;
  await createAuthSession({
    id: randomUUID(),
    userId,
    tokenHash,
    expiresAt: new Date(expiresAt).toISOString(),
  });
  return tokenHash;
}

function installation(userId: string, authSessionTokenHash: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId,
    authSessionTokenHash,
    credentialHash: `credential-${randomUUID()}`,
    platform: 'ios',
    environment: 'production',
    topic: 'com.preskilranch.tracklabbmx',
    tokenCiphertext: Buffer.from(randomUUID()).toString('base64url'),
    tokenNonce: Buffer.alloc(12, 1).toString('base64url'),
    tokenTag: Buffer.alloc(16, 2).toString('base64url'),
    tokenKeyVersion: 1,
    tokenFingerprint: Buffer.from(randomUUID()).toString('hex').slice(0, 64).padEnd(64, '0'),
    permissionStatus: 'granted',
    protocolVersion: 1,
    appBuild: '12',
    osVersion: '26.0',
    ...overrides,
  };
}

async function explicitFriends(left: ReturnType<typeof account>, right: ReturnType<typeof account>) {
  await createAuthUser(left);
  await createAuthUser(right);
  const tokenHash = `invite-${randomUUID()}`;
  await createFriendInvite({
    id: randomUUID(),
    inviterUserId: left.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await expect(claimFriendInvite(tokenHash, right.id)).resolves.toBeTruthy();
}

function liveInviteEvent(inviteId: string, recipientUserId: string, actorUserId: string, origin: string, expiresAt: number) {
  return {
    id: randomUUID(),
    notificationId: randomUUID(),
    recipientUserId,
    actorUserId,
    kind: 'live_audio_invite',
    objectId: inviteId,
    idempotencyKey: `live-audio:${inviteId}`,
    collapseId: `tl-${inviteId}`.slice(0, 64),
    originInstanceId: origin,
    expiresAt,
  };
}

function socialEvent(
  kind: 'live_audio_invite' | 'friend_request' | 'friend_connection' | 'track_share',
  recipientUserId: string,
  actorUserId: string,
  objectId: string,
  expiresAt = Date.now() + (24 * 60 * 60 * 1_000),
  originInstanceId: string | null = null,
) {
  const id = randomUUID();
  return {
    id,
    notificationId: randomUUID(),
    recipientUserId,
    actorUserId,
    kind,
    objectId,
    idempotencyKey: `${kind}:${objectId}:${id}`,
    collapseId: `tl-${kind}-${id}`.slice(0, 64),
    originInstanceId,
    expiresAt,
  };
}

describe('private push persistence', () => {
  it('serializes SQL installation caps and applies preference patches in one atomic statement', () => {
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const registration = source.slice(
      source.indexOf('export async function registerPushInstallation'),
      source.indexOf('export async function deletePushInstallation'),
    );
    const preferences = source.slice(
      source.indexOf('export async function savePushPreferences'),
      source.indexOf('export async function listActivePushInstallations'),
    );
    const dispatchFence = source.slice(
      source.indexOf('export async function withCurrentPushDeliveryLease'),
      source.indexOf('export async function recordPushDeliveryResult'),
    );

    const accountLock = registration.indexOf('push-installation-user:${candidate.userId}');
    const fingerprintLock = registration.indexOf('push-installation-fingerprint:${candidate.topic}');
    const activeCount = registration.indexOf('SELECT count(*)::integer AS total');
    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(fingerprintLock).toBeGreaterThan(accountLock);
    expect(activeCount).toBeGreaterThan(fingerprintLock);
    expect(preferences).not.toContain('loadPushPreferences(');
    expect(preferences).toContain('live_audio = COALESCE($2::boolean, current.live_audio)');
    expect(preferences).toContain('track_shares = COALESCE($5::boolean, current.track_shares)');
    expect(registration).toContain('revision = ${schema}.push_installations.revision + 1');
    expect(dispatchFence).toContain('push-installation:${candidate.installationId}');
    expect(dispatchFence).toContain("delivery.state = 'leased'");
    expect(dispatchFence).toContain('delivery.lease_owner = $3');
    expect(dispatchFence).toContain('installation.revision = $8');
  });

  it('binds an installation to one exact unexpired personal auth session', async () => {
    const first = account('PushFirst');
    const second = account('PushSecond');
    await createAuthUser(first);
    await createAuthUser(second);
    const firstSession = await session(first.id);
    const secondSession = await session(second.id);
    const candidate = installation(first.id, firstSession);

    const saved = await registerPushInstallation(candidate);
    expect(saved).toMatchObject({
      status: 'saved',
      installation: { userId: first.id, authSessionTokenHash: firstSession },
    });
    await expect(listActivePushInstallations(first.id)).resolves.toHaveLength(1);

    await expect(registerPushInstallation({
      ...candidate,
      userId: second.id,
      authSessionTokenHash: secondSession,
      credentialHash: `wrong-${randomUUID()}`,
    })).resolves.toMatchObject({ status: 'unavailable', installation: null });

    await expect(registerPushInstallation({
      ...candidate,
      userId: second.id,
      authSessionTokenHash: secondSession,
    })).resolves.toMatchObject({
      status: 'saved',
      installation: { userId: second.id, authSessionTokenHash: secondSession },
    });
    await expect(listActivePushInstallations(first.id)).resolves.toEqual([]);
    await expect(listActivePushInstallations(second.id)).resolves.toHaveLength(1);

    await expect(deletePushInstallation({
      id: candidate.id,
      userId: second.id,
      authSessionTokenHash: firstSession,
      credentialHash: candidate.credentialHash,
    })).resolves.toBe(false);
    await expect(deletePushInstallation({
      id: candidate.id,
      userId: second.id,
      authSessionTokenHash: secondSession,
      credentialHash: candidate.credentialHash,
    })).resolves.toBe(true);
  });

  it('revokes fanout immediately on logout and treats expired session bindings as inactive', async () => {
    const rider = account('PushLogout');
    await createAuthUser(rider);
    const activeSession = await session(rider.id);
    const active = installation(rider.id, activeSession);
    await registerPushInstallation(active);
    await expect(listActivePushInstallations(rider.id)).resolves.toHaveLength(1);
    await deleteAuthSession(activeSession);
    await expect(listActivePushInstallations(rider.id)).resolves.toEqual([]);

    const now = Date.now();
    const expiringSession = await session(rider.id, now + 100);
    await registerPushInstallation(installation(rider.id, expiringSession), now);
    await expect(listActivePushInstallations(rider.id, now + 101)).resolves.toEqual([]);
  });

  it('atomically enforces the ten-installation account cap and one token fingerprint owner', async () => {
    const rider = account('PushCap');
    await createAuthUser(rider);
    const now = Date.now();
    const tokenHash = await session(rider.id, now + 120_000);
    const results = await Promise.all(Array.from({ length: 11 }, () => (
      registerPushInstallation(installation(rider.id, tokenHash), now)
    )));

    expect(results.filter((result) => result.status === 'saved')).toHaveLength(10);
    expect(results.filter((result) => result.status === 'limit')).toHaveLength(1);
    await expect(listActivePushInstallations(rider.id, now)).resolves.toHaveLength(10);

    const other = account('PushFingerprintConflict');
    await createAuthUser(other);
    const otherSession = await session(other.id, now + 120_000);
    const fingerprint = results.find((result) => result.installation)?.installation?.tokenFingerprint;
    await expect(registerPushInstallation(installation(other.id, otherSession, {
      tokenFingerprint: fingerprint,
    }), now)).resolves.toMatchObject({ status: 'unavailable', installation: null });
  });

  it('stores complete preferences and applies them during authoritative event eligibility', async () => {
    const sender = account('PushPreferenceSender');
    const target = account('PushPreferenceTarget');
    await explicitFriends(sender, target);
    await expect(loadPushPreferences(target.id)).resolves.toEqual({
      liveAudio: true,
      friendRequests: true,
      friendConnections: true,
      trackShares: true,
    });
    await expect(savePushPreferences(target.id, { liveAudio: false })).resolves.toEqual({
      liveAudio: false,
      friendRequests: true,
      friendConnections: true,
      trackShares: true,
    });

    const now = Date.now();
    const origin = `instance-${randomUUID()}`;
    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
    const created = await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);

    expect(created.status).toBe('created');
    await expect(pushEventIsEligible(event.id, origin, now)).resolves.toBe(false);
  });

  it('merges concurrent partial preference writes without losing another device category', async () => {
    const rider = account('PushPreferenceRace');
    await createAuthUser(rider);

    await Promise.all([
      savePushPreferences(rider.id, { liveAudio: false }),
      savePushPreferences(rider.id, { trackShares: false }),
    ]);

    await expect(loadPushPreferences(rider.id)).resolves.toEqual({
      liveAudio: false,
      friendRequests: true,
      friendConnections: true,
      trackShares: false,
    });
  });

  it('atomically stores one live invite with its outbox event and blocks account-wide overlap', async () => {
    const sender = account('PushTalkSender');
    const target = account('PushTalkTarget');
    const other = account('PushTalkOther');
    await explicitFriends(sender, target);
    await createAuthUser(other);
    const tokenHash = `invite-${randomUUID()}`;
    await createFriendInvite({
      id: randomUUID(),
      inviterUserId: sender.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await claimFriendInvite(tokenHash, other.id);
    const now = Date.now();
    const origin = `instance-${randomUUID()}`;
    const inviteId = `LIVE-${randomUUID()}`;
    const candidate = {
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    };
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);

    await expect(createDurableLiveAudioFriendInvite(candidate, event, now)).resolves.toMatchObject({
      status: 'created',
      invite: { id: inviteId, status: 'pending' },
    });
    await expect(createDurableLiveAudioFriendInvite(candidate, event, now)).resolves.toMatchObject({
      status: 'replay',
      invite: { id: inviteId },
    });
    await expect(listPendingDurableLiveAudioFriendInvites(target.id, origin, now)).resolves.toMatchObject([
      { id: inviteId, senderUserId: sender.id, targetUserId: target.id },
    ]);
    await expect(leasePushEvents({
      leaseOwner: `worker-${randomUUID()}`,
      originInstanceId: origin,
      now,
    })).resolves.toMatchObject([{ id: event.id, kind: 'live_audio_invite' }]);

    const overlappingId = `LIVE-${randomUUID()}`;
    await expect(createDurableLiveAudioFriendInvite({
      ...candidate,
      id: overlappingId,
      targetUserId: other.id,
      roomId: `TALK-${randomUUID()}`,
    }, liveInviteEvent(overlappingId, other.id, sender.id, origin, now + 90_000), now)).resolves.toMatchObject({
      status: 'busy', invite: null,
    });
  });

  it('cancels the live invite push in the same terminal transition', async () => {
    const sender = account('PushTransitionSender');
    const target = account('PushTransitionTarget');
    await explicitFriends(sender, target);
    const now = Date.now();
    const origin = `instance-${randomUUID()}`;
    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
    await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);

    await expect(transitionDurableLiveAudioFriendInvite({
      inviteId,
      actorUserId: sender.id,
      action: 'cancel',
      originInstanceId: origin,
      now: now + 1,
    })).resolves.toMatchObject({ status: 'cancelled' });
    await expect(pushEventIsEligible(event.id, origin, now + 1)).resolves.toBe(false);
    await expect(leasePushEvents({
      leaseOwner: `worker-${randomUUID()}`,
      originInstanceId: origin,
      now: now + 1,
    })).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: event.id })]));
  });

  it('fences stale event and delivery workers while preserving one stable APNs id', async () => {
    const sender = account('PushLeaseSender');
    const target = account('PushLeaseTarget');
    await explicitFriends(sender, target);
    const now = Date.now();
    const origin = `instance-${randomUUID()}`;
    const targetSession = await session(target.id, now + 120_000);
    const targetInstallation = installation(target.id, targetSession);
    await expect(registerPushInstallation(targetInstallation, now)).resolves.toMatchObject({ status: 'saved' });

    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
    await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);

    const eventOwner = `event-worker-${randomUUID()}`;
    await expect(leasePushEvents({ leaseOwner: eventOwner, originInstanceId: origin, now }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: event.id, state: 'leased' })]));
    const apnsId = randomUUID();
    await expect(preparePushDeliveries(event.id, [{
      installationId: targetInstallation.id,
      apnsId,
    }], now)).resolves.toEqual([expect.objectContaining({ apnsId, state: 'pending' })]);
    await expect(markPushEventState(event.id, 'dispatched', '', now, 'stale-event-worker')).resolves.toBe(false);
    await expect(markPushEventState(event.id, 'dispatched', '', now, eventOwner)).resolves.toBe(true);

    const firstOwner = `delivery-worker-${randomUUID()}`;
    const firstLease = await leasePushDeliveries({
      leaseOwner: firstOwner,
      originInstanceId: origin,
      now,
      leaseMs: 5_000,
    });
    expect(firstLease).toEqual(expect.arrayContaining([
      expect.objectContaining({ delivery: expect.objectContaining({ apnsId, leaseOwner: firstOwner }) }),
    ]));

    const secondOwner = `delivery-worker-${randomUUID()}`;
    const secondLease = await leasePushDeliveries({
      leaseOwner: secondOwner,
      originInstanceId: origin,
      now: now + 5_001,
      leaseMs: 5_000,
    });
    expect(secondLease).toEqual(expect.arrayContaining([
      expect.objectContaining({ delivery: expect.objectContaining({ apnsId, leaseOwner: secondOwner }) }),
    ]));
    await expect(recordPushDeliveryResult({
      eventId: event.id,
      installationId: targetInstallation.id,
      state: 'dead',
      leaseOwner: firstOwner,
      now: now + 5_002,
    })).resolves.toBe(false);
    await expect(recordPushDeliveryResult({
      eventId: event.id,
      installationId: targetInstallation.id,
      state: 'sent',
      status: 200,
      leaseOwner: secondOwner,
      now: now + 5_002,
    })).resolves.toBe(true);
  });

  it('serializes a delayed send against account rebinding and rejects the stale leased snapshot', async () => {
    const sender = account('PushRebindSender');
    const firstTarget = account('PushRebindFirstTarget');
    const secondTarget = account('PushRebindSecondTarget');
    await explicitFriends(sender, firstTarget);
    await createAuthUser(secondTarget);
    const now = Date.now();
    const origin = `rebind-${randomUUID()}`;
    const firstSession = await session(firstTarget.id, now + 120_000);
    const secondSession = await session(secondTarget.id, now + 120_000);
    const candidate = installation(firstTarget.id, firstSession);
    const saved = await registerPushInstallation(candidate, now);
    expect(saved).toMatchObject({ status: 'saved', installation: { revision: 1 } });

    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, firstTarget.id, sender.id, origin, now + 90_000);
    await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: firstTarget.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);
    const eventOwner = `event-worker-${randomUUID()}`;
    await leasePushEvents({ leaseOwner: eventOwner, originInstanceId: origin, now });
    await preparePushDeliveries(event.id, [{
      installationId: candidate.id,
      apnsId: randomUUID(),
    }], now);
    await markPushEventState(event.id, 'dispatched', '', now, eventOwner);
    const deliveryOwner = `delivery-worker-${randomUUID()}`;
    const [leased] = await leasePushDeliveries({
      leaseOwner: deliveryOwner,
      originInstanceId: origin,
      now,
      leaseMs: 30_000,
    });
    expect(leased.installation).toMatchObject({
      userId: firstTarget.id,
      authSessionTokenHash: firstSession,
      revision: 1,
    });

    let enterSend = () => {};
    const sendEntered = new Promise<void>((resolve) => { enterSend = resolve; });
    let releaseSend = () => {};
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    const guardedSend = withCurrentPushDeliveryLease({
      eventId: event.id,
      installationId: candidate.id,
      leaseOwner: deliveryOwner,
      recipientUserId: firstTarget.id,
      originInstanceId: origin,
      authSessionTokenHash: firstSession,
      tokenFingerprint: leased.installation.tokenFingerprint,
      installationRevision: leased.installation.revision,
    }, async () => {
      enterSend();
      await sendGate;
      return 'provider-finished';
    }, now + 1);
    await sendEntered;

    let rebindSettled = false;
    const rebind = registerPushInstallation({
      ...candidate,
      userId: secondTarget.id,
      authSessionTokenHash: secondSession,
    }, now + 2).then((value) => {
      rebindSettled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rebindSettled).toBe(false);

    releaseSend();
    await expect(guardedSend).resolves.toEqual({ status: 'current', value: 'provider-finished' });
    await expect(rebind).resolves.toMatchObject({
      status: 'saved',
      installation: { userId: secondTarget.id, authSessionTokenHash: secondSession, revision: 2 },
    });

    let staleSendCalled = false;
    await expect(withCurrentPushDeliveryLease({
      eventId: event.id,
      installationId: candidate.id,
      leaseOwner: deliveryOwner,
      recipientUserId: firstTarget.id,
      originInstanceId: origin,
      authSessionTokenHash: firstSession,
      tokenFingerprint: leased.installation.tokenFingerprint,
      installationRevision: leased.installation.revision,
    }, async () => {
      staleSendCalled = true;
    }, now + 3)).resolves.toEqual({ status: 'stale', value: null });
    expect(staleSendCalled).toBe(false);
  });

  for (const sessionBoundary of ['logout', 'kiosk-enrollment'] as const) {
    it(`waits for an already-linearized send before ${sessionBoundary} removes its memory installation`, async () => {
      const sender = account(`PushBoundarySender-${sessionBoundary}`);
      const target = account(`PushBoundaryTarget-${sessionBoundary}`);
      await explicitFriends(sender, target);
      const now = Date.now();
      const origin = `boundary-${randomUUID()}`;
      const targetSession = await session(target.id, now + 120_000);
      const candidate = installation(target.id, targetSession);
      const saved = await registerPushInstallation(candidate, now);

      const inviteId = `LIVE-${randomUUID()}`;
      const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
      await createDurableLiveAudioFriendInvite({
        id: inviteId,
        senderUserId: sender.id,
        targetUserId: target.id,
        roomId: `TALK-${randomUUID()}`,
        originInstanceId: origin,
        createdAt: now,
        expiresAt: now + 90_000,
      }, event, now);
      const eventOwner = `event-worker-${randomUUID()}`;
      await leasePushEvents({ leaseOwner: eventOwner, originInstanceId: origin, now });
      await preparePushDeliveries(event.id, [{
        installationId: candidate.id,
        apnsId: randomUUID(),
      }], now);
      await markPushEventState(event.id, 'dispatched', '', now, eventOwner);
      const deliveryOwner = `delivery-worker-${randomUUID()}`;
      const [leased] = await leasePushDeliveries({
        leaseOwner: deliveryOwner,
        originInstanceId: origin,
        now,
        leaseMs: 30_000,
      });

      if (sessionBoundary === 'kiosk-enrollment') {
        await ensureClub(target.id, 'Push Boundary Club', randomUUID());
      }
      let enterSend = () => {};
      const sendEntered = new Promise<void>((resolve) => { enterSend = resolve; });
      let releaseSend = () => {};
      const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
      const guardedSend = withCurrentPushDeliveryLease({
        eventId: event.id,
        installationId: candidate.id,
        leaseOwner: deliveryOwner,
        recipientUserId: target.id,
        originInstanceId: origin,
        authSessionTokenHash: targetSession,
        tokenFingerprint: leased.installation.tokenFingerprint,
        installationRevision: saved.installation?.revision,
      }, async () => {
        enterSend();
        await sendGate;
        return 'provider-finished';
      }, now + 1);
      await sendEntered;

      let boundarySettled = false;
      const boundary = (sessionBoundary === 'logout'
        ? deleteAuthSession(targetSession)
        : enrollClubTabletDevice({
            id: randomUUID(),
            ownerProfileKey: target.id,
            ownerUserId: target.id,
            name: 'Shared studio iPad',
            tokenHash: `tablet-${randomUUID()}`,
            authSessionTokenHash: targetSession,
          }))
        .then((value) => {
          boundarySettled = true;
          return value;
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(boundarySettled).toBe(false);
      await expect(listActivePushInstallations(target.id, now + 2)).resolves.toEqual([]);

      releaseSend();
      await expect(guardedSend).resolves.toEqual({ status: 'current', value: 'provider-finished' });
      const boundaryResult = await boundary;
      if (sessionBoundary === 'kiosk-enrollment') expect(boundaryResult).toBeTruthy();
      expect(boundarySettled).toBe(true);
      await expect(listActivePushInstallations(target.id, now + 3)).resolves.toEqual([]);
    });
  }

  it('observes an eligibility revocation that occurs while a protected send is waiting', async () => {
    const sender = account('PushEligibilitySender');
    const target = account('PushEligibilityTarget');
    await explicitFriends(sender, target);
    const now = Date.now();
    const origin = `eligibility-${randomUUID()}`;
    const targetSession = await session(target.id, now + 120_000);
    const candidate = installation(target.id, targetSession);
    const saved = await registerPushInstallation(candidate, now);
    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
    await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);
    const eventOwner = `event-worker-${randomUUID()}`;
    await leasePushEvents({ leaseOwner: eventOwner, originInstanceId: origin, now });
    await preparePushDeliveries(event.id, [{
      installationId: candidate.id,
      apnsId: randomUUID(),
    }], now);
    await markPushEventState(event.id, 'dispatched', '', now, eventOwner);
    const deliveryOwner = `delivery-worker-${randomUUID()}`;
    const [leased] = await leasePushDeliveries({
      leaseOwner: deliveryOwner,
      originInstanceId: origin,
      now,
      leaseMs: 30_000,
    });
    await expect(pushEventIsEligible(event.id, origin, now + 1, 'dispatched')).resolves.toBe(true);

    let enterSend = () => {};
    const sendEntered = new Promise<void>((resolve) => { enterSend = resolve; });
    let releaseSend = () => {};
    const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
    let providerCalled = false;
    const guardedSend = withCurrentPushDeliveryLease({
      eventId: event.id,
      installationId: candidate.id,
      leaseOwner: deliveryOwner,
      recipientUserId: target.id,
      originInstanceId: origin,
      authSessionTokenHash: targetSession,
      tokenFingerprint: leased.installation.tokenFingerprint,
      installationRevision: saved.installation?.revision,
    }, async () => {
      enterSend();
      await sendGate;
      if (!(await pushEventIsEligible(event.id, origin, now + 2, 'dispatched'))) {
        return 'no-longer-eligible';
      }
      providerCalled = true;
      return 'provider-called';
    }, now + 1);
    await sendEntered;
    await savePushPreferences(target.id, { liveAudio: false });
    releaseSend();

    await expect(guardedSend).resolves.toEqual({
      status: 'current',
      value: 'no-longer-eligible',
    });
    expect(providerCalled).toBe(false);
  });

  it('prioritizes a short Talk live event ahead of ordinary durable social alerts', async () => {
    const actor = account('PushPriorityActor');
    const recipient = account('PushPriorityRecipient');
    await createAuthUser(actor);
    await createAuthUser(recipient);
    const now = Date.now();
    const origin = `priority-${randomUUID()}`;
    const ordinary = socialEvent(
      'friend_request', recipient.id, actor.id, randomUUID(), now + (24 * 60 * 60 * 1_000), origin,
    );
    const live = socialEvent(
      'live_audio_invite', recipient.id, actor.id, randomUUID(), now + 90_000, origin,
    );
    await enqueuePushEvent(ordinary, now);
    await enqueuePushEvent(live, now);
    const owner = `priority-worker-${randomUUID()}`;
    const leased = await leasePushEvents({ leaseOwner: owner, originInstanceId: origin, now, limit: 100 });
    const liveIndex = leased.findIndex((event) => event.id === live.id);
    const ordinaryIndex = leased.findIndex((event) => event.id === ordinary.id);

    expect(liveIndex).toBeGreaterThanOrEqual(0);
    expect(ordinaryIndex).toBeGreaterThan(liveIndex);
    await markPushEventState(live.id, 'cancelled', 'test-complete', now, owner);
    await markPushEventState(ordinary.id, 'cancelled', 'test-complete', now, owner);
  });

  it('creates only the four authorized social event types with their business transaction', async () => {
    const requester = account('PushRequestActor');
    const approver = account('PushRequestTarget');
    await createAuthUser(requester);
    await createAuthUser(approver);
    const requestId = randomUUID();
    const requestEvent = socialEvent('friend_request', approver.id, requester.id, requestId);
    await expect(createAccountFriendRequest({
      id: requestId,
      fromUserId: requester.id,
      toUserId: approver.id,
      pushEvent: requestEvent,
    })).resolves.toMatchObject({ requestId });
    await expect(pushEventIsEligible(requestEvent.id, 'any-instance')).resolves.toBe(true);

    const connectionEvent = socialEvent('friend_connection', requester.id, approver.id, requestId);
    await expect(respondToAccountFriendRequest(
      requestId,
      approver.id,
      'accept',
      connectionEvent,
    )).resolves.toMatchObject({ requestId, action: 'accept' });
    await expect(pushEventIsEligible(requestEvent.id, 'any-instance')).resolves.toBe(false);
    await expect(pushEventIsEligible(connectionEvent.id, 'any-instance')).resolves.toBe(true);

    const inviter = account('PushInviteOwner');
    const claimant = account('PushInviteClaimant');
    await createAuthUser(inviter);
    await createAuthUser(claimant);
    const inviteId = randomUUID();
    const inviteHash = `invite-${randomUUID()}`;
    await createFriendInvite({
      id: inviteId,
      inviterUserId: inviter.id,
      tokenHash: inviteHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const inviteConnectionEvent = socialEvent(
      'friend_connection', inviter.id, claimant.id, inviteId,
    );
    await expect(claimFriendInvite(inviteHash, claimant.id, inviteConnectionEvent))
      .resolves.toMatchObject({ inviteId });
    await expect(pushEventIsEligible(inviteConnectionEvent.id, 'any-instance')).resolves.toBe(true);

    const shareSender = account('PushShareSender');
    const shareTarget = account('PushShareTarget');
    await explicitFriends(shareSender, shareTarget);
    const shareId = randomUUID();
    const trackId = `track-${randomUUID()}`;
    const shareEvent = socialEvent('track_share', shareTarget.id, shareSender.id, shareId);
    await expect(createAccountTrackShare({
      id: shareId,
      senderUserId: shareSender.id,
      recipientUserId: shareTarget.id,
      trackId,
      trackSnapshot: { id: trackId, name: 'Private test track' },
      pushEvent: shareEvent,
    })).resolves.toMatchObject({ id: shareId, recipientUserId: shareTarget.id });
    await expect(pushEventIsEligible(shareEvent.id, 'any-instance')).resolves.toBe(true);
    await expect(openAccountTrackShare(shareTarget.id, shareId)).resolves.toMatchObject({ id: shareId });
    await expect(pushEventIsEligible(shareEvent.id, 'any-instance')).resolves.toBe(false);
  });

  it('prunes session-bound installations and private notification metadata after bounded retention', async () => {
    const sender = account('PushRetentionSender');
    const target = account('PushRetentionTarget');
    await explicitFriends(sender, target);
    const now = Date.now();
    const expiringSession = await session(target.id, now + 100);
    const originalInstallation = installation(target.id, expiringSession);
    await registerPushInstallation(originalInstallation, now);

    const origin = `retention-${randomUUID()}`;
    const inviteId = `LIVE-${randomUUID()}`;
    const event = liveInviteEvent(inviteId, target.id, sender.id, origin, now + 90_000);
    await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: now,
      expiresAt: now + 90_000,
    }, event, now);

    const retentionTime = now + 90_000 + (7 * 24 * 60 * 60 * 1_000) + 1;
    const pruned = await pruneExpiredData(retentionTime);
    expect(pruned.removedSessions).toBeGreaterThanOrEqual(1);
    expect(pruned.removedPushEvents).toBeGreaterThanOrEqual(1);
    expect(pruned.removedLiveAudioFriendInvites).toBeGreaterThanOrEqual(1);
    await expect(listActivePushInstallations(target.id, retentionTime)).resolves.toEqual([]);

    const replacementSession = await session(target.id, retentionTime + 120_000);
    await expect(registerPushInstallation(installation(target.id, replacementSession, {
      tokenFingerprint: originalInstallation.tokenFingerprint,
    }), retentionTime)).resolves.toMatchObject({ status: 'saved' });

    const replay = await createDurableLiveAudioFriendInvite({
      id: inviteId,
      senderUserId: sender.id,
      targetUserId: target.id,
      roomId: `TALK-${randomUUID()}`,
      originInstanceId: origin,
      createdAt: retentionTime,
      expiresAt: retentionTime + 90_000,
    }, {
      ...event,
      expiresAt: retentionTime + 90_000,
    }, retentionTime);
    expect(replay.status).toBe('created');
  });
});
