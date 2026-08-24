import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';
let serverOutput = '';

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Monitor View cloud test server did not become healthy.\n${serverOutput}`);
}

function api(pathname: string, init: RequestInit = {}, cookie = '') {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

async function register(email: string, name: string) {
  const response = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, password: 'tracklab-test-password' }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  const body = await response.json() as { user: { id: string } };
  return { cookie, user: body.user };
}

async function login(email: string) {
  const response = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'tracklab-test-password' }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get('set-cookie') || '').split(';', 1)[0];
}

type EventStream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

async function openTrainingHistoryStream(cookie: string): Promise<EventStream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/training-sessions/stream`, {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  if (!response.body) throw new Error('Training-history SSE response did not include a body.');
  return { controller, reader: response.body.getReader(), decoder: new TextDecoder(), buffer: '' };
}

async function waitForEvent(stream: EventStream, eventName: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.+)$/m)?.[1]?.trim();
      if (event === eventName) return data ? JSON.parse(data) : {};
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), remaining);
      }),
    ]);
    if (chunk.done) throw new Error(`Training-history SSE ended before ${eventName}.`);
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
  throw new Error(`Timed out waiting for ${eventName}.`);
}

async function claimStudioRider(
  ownerCookie: string,
  athleteCookie: string,
  studioRiderId: string,
  fullName: string,
) {
  const inviteResponse = await api('/api/club-connect/invites', {
    method: 'POST',
    body: JSON.stringify({ studioRiderId }),
  }, ownerCookie);
  expect(inviteResponse.status).toBe(201);
  const invite = await inviteResponse.json() as { token: string };
  const claimResponse = await api('/api/club-connect/claim', {
    method: 'POST',
    body: JSON.stringify({ token: invite.token, fullName }),
  }, athleteCookie);
  expect(claimResponse.status).toBe(200);
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'monitor-club-owner@tracklab.test',
      TRACKLAB_HEART_RATE_STUDIO_INVITATION_TTL_MS: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('owner-operated Monitor View athlete history', () => {
  it('binds one claimed athlete and bike, saves once, and notifies athlete and club histories', async () => {
    const associationResponse = await api('/.well-known/apple-app-site-association');
    expect(associationResponse.status).toBe(200);
    expect(associationResponse.headers.get('content-type')).toBe('application/json');
    expect(await associationResponse.json()).toEqual({
      applinks: {
        details: [{
          appIDs: ['DU7FUS4N34.com.preskilranch.tracklabbmx'],
          components: [{
            '/': '/',
            '?': { heartRateStudioInvite: '*' },
            comment: 'Open an athlete-specific TrackLab studio heart-rate invitation.',
          }, {
            '/': '/',
            '?': { locator: '*' },
            comment: 'Open a public BMX track inside the TrackLab directory.',
          }, {
            '/': '/',
            '#': 'heartRateAccountBlock=*',
            comment: 'Open a private same-account Apple Watch handoff without sending its code to the server.',
          }],
        }],
      },
    });

    const owner = await register('monitor-club-owner@tracklab.test', 'Monitor Test Club');
    const athlete = await register('monitor-athlete@tracklab.test', 'Monitor Athlete');
    const secondAthlete = await register('monitor-second@tracklab.test', 'Second Athlete');
    const outsider = await register('monitor-outsider@tracklab.test', 'Outsider');
    const riderOne = `monitor-rider-one-${Date.now()}`;
    const riderTwo = `monitor-rider-two-${Date.now()}`;
    const unclaimedRider = `monitor-rider-unclaimed-${Date.now()}`;
    const rosterResponse = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: riderOne, name: 'Monitor Athlete', createdAt: Date.now(), updatedAt: Date.now() },
          { id: riderTwo, name: 'Second Athlete', createdAt: Date.now(), updatedAt: Date.now() },
          { id: unclaimedRider, name: 'Not Claimed', createdAt: Date.now(), updatedAt: Date.now() },
        ],
      }),
    }, owner.cookie);
    expect(rosterResponse.status).toBe(200);
    await claimStudioRider(owner.cookie, athlete.cookie, riderOne, 'Monitor Athlete');
    await claimStudioRider(owner.cookie, secondAthlete.cookie, riderTwo, 'Second Athlete');

    const clubStateResponse = await api('/api/club-connect', {}, owner.cookie);
    expect(clubStateResponse.status).toBe(200);
    const clubState = await clubStateResponse.json() as any;
    const clubId = clubState.ownedClub.id as string;
    const armedAt = Date.now() - 6_000;
    const startedAt = armedAt + 1_000;
    const sessionId = `monitor-sprint:${riderOne}:${startedAt}`;
    const reservation = {
      clubId,
      studioRiderId: riderOne,
      bikeDeviceId: 101,
      sessionId,
      playerId: 1,
      armedAt,
    };
    const binding = {
      clubId,
      studioRiderId: riderOne,
      bikeDeviceId: 101,
      sessionId,
      playerId: 1,
      startedAt,
    };
    const result = {
      startedAt,
      endedAt: startedAt + 5_000,
      distanceMeters: 72.5,
      averageWatts: 640,
      peakWatts: 1_250,
      averageCadence: 156,
      peakCadence: 211,
      averageSpeedKph: 40.2,
      peakSpeedKph: 54.3,
    };

    const unclaimed = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify({ ...reservation, studioRiderId: unclaimedRider, sessionId: `${sessionId}:unclaimed` }),
    }, owner.cookie);
    expect(unclaimed.status).toBe(409);

    const forbiddenProfileOverride = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify({ ...reservation, athleteProfileKey: `user:${secondAthlete.user.id}` }),
    }, owner.cookie);
    expect(forbiddenProfileOverride.status).toBe(400);

    const authorizationResponse = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify(reservation),
    }, owner.cookie);
    expect(authorizationResponse.status).toBe(201);
    const firstCredential = await authorizationResponse.json() as any;
    expect(firstCredential.saveToken).toMatch(/^[a-zA-Z0-9_-]{40,}$/);
    expect(firstCredential.authorization).toMatchObject({
      clubId,
      studioRiderId: riderOne,
      bikeDeviceId: '101',
      sessionId,
      playerId: 1,
      armedAt,
      startedAt: null,
      activatedAt: null,
    });
    expect(JSON.stringify(firstCredential)).not.toContain('athleteProfileKey');
    expect(JSON.stringify(firstCredential)).not.toContain('ownerProfileKey');
    expect(JSON.stringify(firstCredential)).not.toContain('tokenHash');

    const rotatedAuthorization = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify(reservation),
    }, owner.cookie);
    expect(rotatedAuthorization.status).toBe(201);
    const credential = await rotatedAuthorization.json() as any;
    expect(credential.authorization.id).toBe(firstCredential.authorization.id);
    expect(credential.saveToken).not.toBe(firstCredential.saveToken);

    const saveBeforeActivation = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
      body: JSON.stringify({ ...binding, result }),
    }, owner.cookie);
    expect(saveBeforeActivation.status).toBe(409);

    const sameRiderConflict = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify({ ...reservation, bikeDeviceId: 102, sessionId: `${sessionId}:rider-conflict` }),
    }, owner.cookie);
    expect(sameRiderConflict.status).toBe(409);
    const sameBikeConflict = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify({
        ...reservation,
        studioRiderId: riderTwo,
        sessionId: `${sessionId}:bike-conflict`,
        playerId: 2,
      }),
    }, owner.cookie);
    expect(sameBikeConflict.status).toBe(409);

    const watchInvitation = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        relayScope: 'studio-block',
        studioRiderId: riderOne,
        playerId: 1,
      }),
    }, owner.cookie);
    expect(watchInvitation.status).toBe(201);
    const watchInvitationBody = await watchInvitation.json() as any;
    const wrongAthletePreview = await api(
      `/api/heart-rate/studio-invitations/preview?code=${encodeURIComponent(watchInvitationBody.inviteCode)}`,
      {},
      outsider.cookie,
    );
    expect(wrongAthletePreview.status).toBe(404);
    const invitationPreview = await api(
      `/api/heart-rate/studio-invitations/preview?code=${encodeURIComponent(watchInvitationBody.inviteCode)}`,
      {},
      athlete.cookie,
    );
    expect(invitationPreview.status).toBe(200);
    const invitationPreviewBody = await invitationPreview.json() as any;
    expect(invitationPreviewBody).toEqual({
      invitation: {
        clubName: 'Monitor Test Club',
        riderName: 'Monitor Athlete',
        sessionId,
        activityType: 'monitor-sprint',
        relayScope: 'studio-block',
        playerId: 1,
        expiresAt: watchInvitationBody.invitation.expiresAt,
      },
    });
    expect(JSON.stringify(invitationPreviewBody)).not.toMatch(/hash|token|profileKey|athleteProfile|ownerProfile/i);
    const claimedInvitation = await api('/api/heart-rate/studio-invitations/claim', {
      method: 'POST',
      body: JSON.stringify({
        inviteCode: watchInvitationBody.inviteCode,
        studioBlockConsent: true,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(claimedInvitation.status).toBe(201);
    const claimedInvitationBody = await claimedInvitation.json() as any;
    expect(claimedInvitationBody.pairing.relayScope).toBe('studio-block');
    const claimedPreview = await api(
      `/api/heart-rate/studio-invitations/preview?code=${encodeURIComponent(watchInvitationBody.inviteCode)}`,
      {},
      athlete.cookie,
    );
    expect(claimedPreview.status).toBe(404);

    const oldTokenActivation = await api(
      `/api/club-live/monitor-authorizations/${encodeURIComponent(credential.authorization.id)}/activate`,
      {
        method: 'POST',
        headers: { 'X-TrackLab-Monitor-Save-Token': firstCredential.saveToken },
        body: JSON.stringify({ startedAt }),
      },
      owner.cookie,
    );
    expect(oldTokenActivation.status).toBe(401);
    const activatedResponse = await api(
      `/api/club-live/monitor-authorizations/${encodeURIComponent(credential.authorization.id)}/activate`,
      {
        method: 'POST',
        headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
        body: JSON.stringify({ startedAt }),
      },
      owner.cookie,
    );
    expect(activatedResponse.status).toBe(200);
    expect((await activatedResponse.json() as any).authorization).toMatchObject({
      armedAt,
      startedAt,
    });

    const watchClaimResponse = await api('/api/heart-rate/pairings/claim', {
      method: 'POST',
      body: JSON.stringify({ pairCode: claimedInvitationBody.pairCode }),
    }, athlete.cookie);
    expect(watchClaimResponse.status).toBe(200);
    const watchClaim = await watchClaimResponse.json() as any;
    expect(watchClaim.pairing.relayScope).toBe('studio-block');
    expect(watchClaim.ingestExpiresAt - Date.now()).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
    const offlineTrainingSessionId = `${sessionId}:offline-before-watch-upload`;
    const offlineTrainingSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: { clubId, studioRiderId: riderOne },
        session: {
          id: offlineTrainingSessionId,
          activityType: 'get-pulled',
          title: 'Offline Watch relay test',
          startedAt,
          endedAt: startedAt + 5_000,
          durationMs: 5_000,
          distanceMeters: 72.5,
          source: 'live',
          createdAt: startedAt,
          details: {
            cadence: 156,
            heartRate: { averageBpm: 160 },
            nested: { peakBpm: 170, HR: 165, HealthKitSamples: [1, 2, 3], allowed: true },
            riders: [{
              playerId: 1,
              riderId: riderOne,
              riderName: 'Monitor Athlete',
              bpm: 166,
              cadence: 156,
            }],
          },
        },
      }),
    }, athlete.cookie);
    expect(offlineTrainingSave.status).toBe(201);
    const offlineTrainingSaveBody = await offlineTrainingSave.json() as any;
    expect(offlineTrainingSaveBody.heartRate).toEqual({ status: 'pending' });
    expect(offlineTrainingSaveBody.session.details).toMatchObject({
      cadence: 156,
      nested: { allowed: true },
      riders: [{ playerId: 1, riderId: riderOne, cadence: 156 }],
    });
    expect(JSON.stringify(offlineTrainingSaveBody.session.details))
      .not.toMatch(/heart.?rate|health.?kit|bpm|"HR"/i);
    const blockStartedAt = startedAt - 1_000;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${watchClaim.ingestToken}` },
      body: JSON.stringify({ startedAt: blockStartedAt }),
    });
    expect(streamResponse.status).toBe(201);
    const blockStream = (await streamResponse.json() as any).stream;
    expect(blockStream).toMatchObject({ relayScope: 'studio-block', sessionId });
    const samplesResponse = await api(`/api/heart-rate/streams/${blockStream.id}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${watchClaim.ingestToken}` },
      body: JSON.stringify({
        samples: [
          { sequence: 1, recordedAt: startedAt, activeElapsedMs: 1_000, bpm: 150 },
          { sequence: 2, recordedAt: startedAt + 2_500, activeElapsedMs: 3_500, bpm: 160 },
          { sequence: 3, recordedAt: startedAt + 5_000, activeElapsedMs: 6_000, bpm: 170 },
        ],
      }),
    });
    expect(samplesResponse.status).toBe(200);
    const reconciledOfflineHeartRate = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(offlineTrainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(reconciledOfflineHeartRate.status).toBe(200);
    expect((await reconciledOfflineHeartRate.json() as any).segments).toEqual([
      expect.objectContaining({
        trainingSessionId: offlineTrainingSessionId,
        summary: expect.objectContaining({ sampleCount: 3, averageBpm: 155, peakBpm: 170 }),
      }),
    ]);
    const privateFieldGhostId = `ghost-private-fields-${Date.now()}`;
    const privateFieldGhostTrackId = `track-private-fields-${Date.now()}`;
    const privateFieldGhostSave = await api('/api/ghosts', {
      method: 'POST',
      body: JSON.stringify({
        ghost: {
          id: privateFieldGhostId,
          trackId: privateFieldGhostTrackId,
          trackName: 'Private field track',
          riderName: 'Monitor Test Club',
          ownerName: 'Monitor Test Club',
          colorName: 'blue',
          accent: '#0000ff',
          raceSource: 'live',
          finishTimeMs: 5_000,
          savedAt: Date.now(),
          analyticsPublic: true,
          summary: {
            cadence: 156,
            heartRate: 160,
            nested: { peakBpm: 170, HR: 165, healthKit: { samples: [1, 2] }, allowed: true },
          },
          points: [
            { elapsedMs: 0, distanceMeters: 0, velocityMps: 0 },
            { elapsedMs: 5_000, distanceMeters: 72.5, velocityMps: 14.5 },
          ],
        },
      }),
    }, owner.cookie);
    expect(privateFieldGhostSave.status).toBe(200);
    const privateFieldGhosts = await api(
      `/api/ghosts?trackId=${encodeURIComponent(privateFieldGhostTrackId)}`,
      {},
      owner.cookie,
    );
    expect(privateFieldGhosts.status).toBe(200);
    const privateFieldGhost = (await privateFieldGhosts.json() as any).ghosts
      .find((ghost: any) => ghost.id === privateFieldGhostId);
    expect(privateFieldGhost.summary).toMatchObject({ cadence: 156, nested: { allowed: true } });
    expect(JSON.stringify(privateFieldGhost.summary)).not.toMatch(/heart.?rate|health.?kit|bpm|"HR"/i);
    const blockStatusResponse = await api(
      `/api/heart-rate/studio-blocks?clubId=${encodeURIComponent(clubId)}`,
      {},
      owner.cookie,
    );
    expect(blockStatusResponse.status).toBe(200);
    const blockStatusBody = await blockStatusResponse.json() as any;
    expect(blockStatusBody.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: watchInvitationBody.invitation.id,
        studioRiderId: riderOne,
        anchorSessionId: sessionId,
        state: 'watch-ready',
      }),
    ]));
    expect(JSON.stringify(blockStatusBody)).not.toMatch(/profileKey|pairingId|token|hash/i);
    const outsiderBlockStatus = await api(
      `/api/heart-rate/studio-blocks?clubId=${encodeURIComponent(clubId)}`,
      {},
      outsider.cookie,
    );
    expect(outsiderBlockStatus.status).toBe(403);

    const revokedInvitationResponse = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        studioRiderId: riderOne,
        playerId: 1,
      }),
    }, owner.cookie);
    expect(revokedInvitationResponse.status).toBe(201);
    const revokedInvitation = await revokedInvitationResponse.json() as any;
    const revokeInvitation = await api(
      `/api/heart-rate/studio-invitations/${encodeURIComponent(revokedInvitation.invitation.id)}`,
      { method: 'DELETE' },
      owner.cookie,
    );
    expect(revokeInvitation.status).toBe(200);
    const revokedPreview = await api(
      `/api/heart-rate/studio-invitations/preview?code=${encodeURIComponent(revokedInvitation.inviteCode)}`,
      {},
      athlete.cookie,
    );
    expect(revokedPreview.status).toBe(404);

    const expiringInvitationResponse = await api('/api/heart-rate/studio-invitations', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        activityType: 'monitor-sprint',
        studioRiderId: riderOne,
        playerId: 1,
      }),
    }, owner.cookie);
    expect(expiringInvitationResponse.status).toBe(201);
    const expiringInvitation = await expiringInvitationResponse.json() as any;
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    const expiredPreview = await api(
      `/api/heart-rate/studio-invitations/preview?code=${encodeURIComponent(expiringInvitation.inviteCode)}`,
      {},
      athlete.cookie,
    );
    expect(expiredPreview.status).toBe(404);

    const oldTokenRejected = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': firstCredential.saveToken },
      body: JSON.stringify({ ...binding, result }),
    }, owner.cookie);
    expect(oldTokenRejected.status).toBe(401);

    const outsiderRejected = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
      body: JSON.stringify({ ...binding, result }),
    }, outsider.cookie);
    expect(outsiderRejected.status).toBe(403);

    const mismatchedBike = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
      body: JSON.stringify({ ...binding, bikeDeviceId: 999, result }),
    }, owner.cookie);
    expect(mismatchedBike.status).toBe(409);

    const ownerEvents = await openTrainingHistoryStream(owner.cookie);
    const athleteEvents = await openTrainingHistoryStream(athlete.cookie);
    await Promise.all([
      waitForEvent(ownerEvents, 'ready'),
      waitForEvent(athleteEvents, 'ready'),
    ]);
    const savedResponse = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
      body: JSON.stringify({ ...binding, result }),
    }, owner.cookie);
    expect(savedResponse.status).toBe(201);
    const saved = await savedResponse.json() as any;
    expect(saved.replayed).toBe(false);
    expect(saved.session).toMatchObject({
      id: sessionId,
      activityType: 'monitor-sprint',
      durationMs: 5_000,
      distanceMeters: 72.5,
      club: { id: clubId, studioRiderId: riderOne, role: 'owner' },
      details: {
        riders: [{
          playerId: 1,
          riderId: riderOne,
          riderName: 'Monitor Athlete',
          averageCadence: 156,
          peakCadence: 211,
        }],
      },
    });
    expect(saved.session.details.riders[0]).not.toHaveProperty('averageWatts');
    expect(saved.session.details.riders[0]).not.toHaveProperty('peakWatts');
    expect(saved.heartRate).toMatchObject({
      status: 'created',
      segment: {
        trainingSessionId: sessionId,
        relayScope: 'studio-block',
        summary: {
          sampleCount: 3,
          coverageMs: 5_000,
          coveragePercent: 100,
          minimumBpm: 150,
          averageBpm: 155,
          peakBpm: 170,
        },
      },
    });
    expect(JSON.stringify(saved.heartRate)).not.toMatch(/profileKey|pairingId|token|hash/i);

    const athleteHeartRate = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(sessionId)}`,
      {},
      athlete.cookie,
    );
    expect(athleteHeartRate.status).toBe(200);
    expect((await athleteHeartRate.json() as any).segments).toEqual([
      expect.objectContaining({
        trainingSessionId: sessionId,
        summary: expect.objectContaining({ averageBpm: 155, peakBpm: 170 }),
      }),
    ]);
    const clubHeartRate = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(sessionId)}`,
      {},
      owner.cookie,
    );
    expect(clubHeartRate.status).toBe(200);
    const clubHeartRateBody = await clubHeartRate.json() as any;
    expect(clubHeartRateBody.segments).toEqual([
      expect.objectContaining({
        trainingSessionId: sessionId,
        studioRiderId: riderOne,
        summary: expect.objectContaining({ sampleCount: 3, averageBpm: 155 }),
      }),
    ]);
    expect(JSON.stringify(clubHeartRateBody)).not.toMatch(/"riderId"|profileKey|pairingId|token|hash/i);

    const [ownerEvent, athleteEvent] = await Promise.all([
      waitForEvent(ownerEvents, 'training-history-updated'),
      waitForEvent(athleteEvents, 'training-history-updated'),
    ]);
    expect(ownerEvent).toMatchObject({ sessionId, activityType: 'monitor-sprint' });
    expect(athleteEvent).toMatchObject({ sessionId, activityType: 'monitor-sprint' });
    ownerEvents.controller.abort();
    athleteEvents.controller.abort();

    const replayed = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': credential.saveToken },
      body: JSON.stringify({ ...binding, result }),
    }, owner.cookie);
    expect(replayed.status).toBe(409);

    const personalClubSessionId = `${sessionId}:personal-straight`;
    const personalClubSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: { clubId, studioRiderId: riderOne },
        session: {
          id: personalClubSessionId,
          activityType: 'straight-sprint',
          title: 'Club straight sprint',
          startedAt,
          endedAt: startedAt + 5_000,
          durationMs: 5_000,
          distanceMeters: 72.5,
          source: 'live',
          createdAt: startedAt,
          details: {
            summaries: [{ playerId: 1, riderId: riderOne, riderName: 'Monitor Athlete' }],
          },
        },
      }),
    }, athlete.cookie);
    expect(personalClubSave.status).toBe(201);
    expect((await personalClubSave.json() as any).heartRate).toMatchObject({
      status: 'created',
      segment: {
        trainingSessionId: personalClubSessionId,
        summary: { sampleCount: 3, averageBpm: 155, peakBpm: 170 },
      },
    });

    const ownerEnrollmentCookie = await login('monitor-club-owner@tracklab.test');
    const enrollTablet = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'HR test tablet' }),
    }, ownerEnrollmentCookie);
    expect(enrollTablet.status).toBe(201);
    const tabletCredential = await enrollTablet.json() as any;
    const selectTabletAthlete = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tabletCredential.deviceToken}` },
      body: JSON.stringify({ studioRiderId: riderOne, bikeDeviceId: '303' }),
    });
    expect(selectTabletAthlete.status).toBe(201);
    const tabletAthleteSession = await selectTabletAthlete.json() as any;
    const tabletRaceSessionId = `${sessionId}:tablet-race`;
    const tabletRaceSave = await api('/api/club-tablet/training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Club-Tablet-Session': tabletAthleteSession.sessionToken },
      body: JSON.stringify({
        localPlayerId: 1,
        session: {
          id: tabletRaceSessionId,
          activityType: 'bmx-race',
          title: 'Club tablet race',
          startedAt,
          endedAt: startedAt + 5_000,
          durationMs: 5_000,
          distanceMeters: 72.5,
          source: 'live',
          createdAt: startedAt,
          details: {
            summaries: [{
              playerId: 1,
              riderName: 'Untrusted name',
              rank: 1,
              finishTimeMs: 5_000,
              distanceMeters: 72.5,
              topSpeedKph: 54.3,
              averageSpeedKph: 40.2,
              topCadence: 211,
              averageCadence: 156,
              topWatts: 1_250,
              averageWatts: 640,
              heartRate: 160,
              averageBpm: 158,
              HealthKit: { source: 'forbidden' },
            }],
            zoneResults: [{
              zoneId: 'zone-1',
              zoneName: 'Zone 1',
              zoneType: 'pedal',
              startMeter: 0,
              endMeter: 36,
              riders: [{
                playerId: 1,
                sampleCount: 1,
                entryElapsedMs: 0,
                exitElapsedMs: 2_500,
              }],
            }, {
              zoneId: 'zone-2',
              zoneName: 'Zone 2',
              zoneType: 'pedal',
              startMeter: 36,
              endMeter: 72.5,
              riders: [{
                playerId: 1,
                sampleCount: 2,
                entryElapsedMs: 2_500,
                exitElapsedMs: 5_000,
              }],
            }],
          },
        },
      }),
    });
    expect(tabletRaceSave.status).toBe(201);
    const tabletRaceSaveBody = await tabletRaceSave.json() as any;
    expect(tabletRaceSaveBody.heartRate).toMatchObject({
      status: 'created',
      segment: {
        trainingSessionId: tabletRaceSessionId,
        summary: { sampleCount: 3, averageBpm: 155, peakBpm: 170 },
        zoneSummaries: [{
          zoneId: 'zone-1',
          zoneName: 'Zone 1',
          startElapsedMs: 0,
          endElapsedMs: 2_500,
          averageBpm: 150,
        }, {
          zoneId: 'zone-2',
          zoneName: 'Zone 2',
          startElapsedMs: 2_500,
          endElapsedMs: 5_000,
          averageBpm: 160,
        }],
      },
    });
    expect(JSON.stringify(tabletRaceSaveBody.heartRate)).not.toMatch(/profileKey|pairingId|token|hash/i);
    expect(JSON.stringify(tabletRaceSaveBody.session.details))
      .not.toMatch(/heart.?rate|health.?kit|bpm|"HR"/i);
    const tabletRaceClubHeartRate = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(tabletRaceSessionId)}`,
      {},
      owner.cookie,
    );
    expect(tabletRaceClubHeartRate.status).toBe(200);
    expect((await tabletRaceClubHeartRate.json() as any).segments).toEqual([
      expect.objectContaining({
        trainingSessionId: tabletRaceSessionId,
        activityType: 'bmx-race',
        studioRiderId: riderOne,
      }),
    ]);
    const stopTabletAthlete = await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: { 'X-TrackLab-Club-Tablet-Session': tabletAthleteSession.sessionToken },
    });
    expect(stopTabletAthlete.status).toBe(200);

    const secondStartedAt = Date.now();
    const secondSessionId = `${sessionId}:second`;
    const secondReservation = {
      clubId,
      studioRiderId: riderOne,
      bikeDeviceId: 101,
      sessionId: secondSessionId,
      playerId: 1,
      armedAt: secondStartedAt - 100,
    };
    const secondAuthorizationResponse = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify(secondReservation),
    }, owner.cookie);
    expect(secondAuthorizationResponse.status).toBe(201);
    const secondCredential = await secondAuthorizationResponse.json() as any;
    const secondActivation = await api(
      `/api/club-live/monitor-authorizations/${encodeURIComponent(secondCredential.authorization.id)}/activate`,
      {
        method: 'POST',
        headers: { 'X-TrackLab-Monitor-Save-Token': secondCredential.saveToken },
        body: JSON.stringify({ startedAt: secondStartedAt }),
      },
      owner.cookie,
    );
    expect(secondActivation.status).toBe(200);
    const secondElapsed = secondStartedAt - blockStartedAt;
    const secondSamples = await api(`/api/heart-rate/streams/${blockStream.id}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${watchClaim.ingestToken}` },
      body: JSON.stringify({
        samples: [
          { sequence: 4, recordedAt: secondStartedAt, activeElapsedMs: secondElapsed, bpm: 175 },
          { sequence: 5, recordedAt: secondStartedAt + 2_500, activeElapsedMs: secondElapsed + 2_500, bpm: 180 },
          { sequence: 6, recordedAt: secondStartedAt + 5_000, activeElapsedMs: secondElapsed + 5_000, bpm: 185 },
        ],
      }),
    });
    expect(secondSamples.status).toBe(200);
    const secondResult = {
      ...result,
      startedAt: secondStartedAt,
      endedAt: secondStartedAt + 5_000,
    };
    const secondSavedResponse = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': secondCredential.saveToken },
      body: JSON.stringify({
        ...secondReservation,
        startedAt: secondStartedAt,
        result: secondResult,
      }),
    }, owner.cookie);
    expect(secondSavedResponse.status).toBe(201);
    const secondSaved = await secondSavedResponse.json() as any;
    expect(secondSaved.heartRate).toMatchObject({
      status: 'created',
      segment: {
        streamId: blockStream.id,
        trainingSessionId: secondSessionId,
        summary: { sampleCount: 3, averageBpm: 177.5, peakBpm: 185 },
      },
    });
    const blockEndedAt = secondStartedAt + 6_000;
    const finalizedBlockResponse = await api(
      `/api/heart-rate/streams/${blockStream.id}/finalize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${watchClaim.ingestToken}` },
        body: JSON.stringify({
          endedAt: blockEndedAt,
          samples: [{
            sequence: 7,
            recordedAt: secondStartedAt + 5_500,
            activeElapsedMs: secondElapsed + 5_500,
            bpm: 182,
          }],
        }),
      },
    );
    expect(finalizedBlockResponse.status).toBe(200);
    expect((await finalizedBlockResponse.json() as any).stream).toMatchObject({
      relayScope: 'studio-block',
      endedAt: blockEndedAt,
      activeDurationMs: blockEndedAt - blockStartedAt,
    });
    const clubAfterBlockFinalize = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(sessionId)}`,
      {},
      owner.cookie,
    );
    expect(clubAfterBlockFinalize.status).toBe(200);
    expect((await clubAfterBlockFinalize.json() as any).streams).toEqual([]);

    const athleteHistory = await api('/api/training-sessions', {}, athlete.cookie);
    const athleteSessions = (await athleteHistory.json() as any).sessions;
    expect(athleteSessions.map((candidate: any) => candidate.id)).toContain(sessionId);
    const athleteSession = athleteSessions.find((candidate: any) => candidate.id === sessionId);
    expect(athleteSession).toMatchObject({
      club: { id: clubId, studioRiderId: riderOne, role: 'athlete' },
      details: {
        riders: [{ averageWatts: 640, peakWatts: 1_250, peakCadence: 211 }],
      },
    });

    const ownerHistory = await api('/api/training-sessions', {}, owner.cookie);
    const ownerSessions = (await ownerHistory.json() as any).sessions;
    const clubSession = ownerSessions.find((candidate: any) => (
      candidate.id === sessionId || candidate.id.endsWith(`:${sessionId}`)
    ));
    expect(clubSession).toMatchObject({
      club: { id: clubId, studioRiderId: riderOne, role: 'owner' },
      details: { riders: [{ peakCadence: 211 }] },
    });
    expect(clubSession.details.riders[0]).not.toHaveProperty('peakWatts');
    const secondHistory = await api('/api/training-sessions', {}, secondAthlete.cookie);
    expect((await secondHistory.json() as any).sessions.some((candidate: any) => candidate.id === sessionId)).toBe(false);

    const cancelBinding = {
      ...binding,
      studioRiderId: riderTwo,
      bikeDeviceId: 102,
      sessionId: `${sessionId}:cancelled`,
      playerId: 2,
      startedAt: Date.now(),
    };
    const cancelAuthorization = await api('/api/club-live/monitor-authorizations', {
      method: 'POST',
      body: JSON.stringify(cancelBinding),
    }, owner.cookie);
    expect(cancelAuthorization.status).toBe(201);
    const cancelledCredential = await cancelAuthorization.json() as any;
    const cancelResponse = await api('/api/club-live/monitor-authorizations', {
      method: 'DELETE',
      body: JSON.stringify({ authorizationId: cancelledCredential.authorization.id }),
    }, owner.cookie);
    expect(cancelResponse.status).toBe(200);
    const saveCancelled = await api('/api/club-live/monitor-training-sessions', {
      method: 'POST',
      headers: { 'X-TrackLab-Monitor-Save-Token': cancelledCredential.saveToken },
      body: JSON.stringify({
        ...cancelBinding,
        result: { ...result, startedAt: cancelBinding.startedAt, endedAt: cancelBinding.startedAt + 1_000 },
      }),
    }, owner.cookie);
    expect(saveCancelled.status).toBe(410);

    const stoppedBlockResponse = await api(
      `/api/heart-rate/studio-blocks/${encodeURIComponent(watchInvitationBody.invitation.id)}`,
      { method: 'DELETE' },
      owner.cookie,
    );
    expect(stoppedBlockResponse.status).toBe(200);
    expect((await stoppedBlockResponse.json() as any).block).toMatchObject({
      invitationId: watchInvitationBody.invitation.id,
      state: 'stopped',
    });
    const clubAfterOwnerStop = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(clubId)}&sessionId=${encodeURIComponent(sessionId)}`,
      {},
      owner.cookie,
    );
    expect((await clubAfterOwnerStop.json() as any).segments).toEqual([]);
    const athleteAfterOwnerStop = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(sessionId)}`,
      {},
      athlete.cookie,
    );
    expect((await athleteAfterOwnerStop.json() as any).segments).toHaveLength(1);
    const athleteCannotRestoreStudioVisibility = await api(
      `/api/heart-rate/pairings/${encodeURIComponent(claimedInvitationBody.pairing.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ liveStudioConsent: true, sessionStudioConsent: true }),
      },
      athlete.cookie,
    );
    expect(athleteCannotRestoreStudioVisibility.status).toBe(409);
  }, 25_000);
});
