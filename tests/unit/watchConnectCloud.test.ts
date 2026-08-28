import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as persistence from '../../cloud/persistence.mjs';

let child: ChildProcess;
let baseUrl = '';
let serverOutput = '';
const metricsToken = 'watch-connect-test-metrics-token';

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
      // The isolated memory server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Watch Connect test server did not become healthy.\n${serverOutput}`);
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

async function register(email: string, name: string, forwardedFor = '') {
  const response = await api('/api/auth/register', {
    method: 'POST',
    headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {},
    body: JSON.stringify({ email, name, password: 'tracklab-test-password' }),
  });
  expect(response.status).toBe(201);
  const cookie = (response.headers.get('set-cookie') || '').split(';', 1)[0];
  const body = await response.json() as any;
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

const requestId = (label: string) => `${label}_${'x'.repeat(32)}`;
const installId = (character: string) => `wci_${character.repeat(64)}`;

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
      TRACKLAB_ADMIN_EMAILS: 'watch-connect-owner@tracklab.test',
      TRACKLAB_METRICS_TOKEN: metricsToken,
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

describe('Watch Connect cloud workflow', () => {
  it('trusts one installation, rotates replay credentials, and keeps a four-hour private connection', async () => {
    const athlete = await register('watch-connect-athlete@tracklab.test', 'Watch Athlete');
    const other = await register('watch-connect-other@tracklab.test', 'Other Athlete');
    const trustedInstall = installId('a');

    expect((await api('/api/heart-rate/watch-connect')).status).toBe(401);
    const enrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('personal-enroll'),
        installId: trustedInstall,
        scope: 'personal',
      }),
    }, athlete.cookie);
    expect(enrollmentResponse.status).toBe(201);
    const enrolled = await enrollmentResponse.json() as any;
    expect(enrolled.enrollment).toMatchObject({
      scope: 'personal',
      state: 'trusted',
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
    });
    expect(JSON.stringify(enrolled)).not.toMatch(/install|hash|token|profileKey|bike/i);

    const crossAccount = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('wrong-account'),
        installId: trustedInstall,
        scope: 'personal',
      }),
    }, other.cookie);
    expect(crossAccount.status).toBe(409);

    const connectRequestId = requestId('personal-connect');
    const connectionResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: connectRequestId,
        enrollmentId: enrolled.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(connectionResponse.status).toBe(201);
    const first = await connectionResponse.json() as any;
    expect(first.connection).toMatchObject({ scope: 'personal', state: 'connecting' });
    expect(first.connection.connectedUntil - first.connection.connectedAt).toBe(4 * 60 * 60 * 1000);
    expect(first.credentials).toMatchObject({
      connectionId: first.connection.id,
      relaySessionId: `watch-connect:${first.connection.id}`,
      expiresAt: first.connection.connectedUntil,
    });
    expect(first.credentials.ingestToken.length).toBeGreaterThanOrEqual(32);

    const replayResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: connectRequestId,
        enrollmentId: enrolled.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as any;
    expect(replay.replayed).toBe(true);
    expect(replay.connection.id).toBe(first.connection.id);
    expect(replay.connection.connectedUntil).toBe(first.connection.connectedUntil);
    expect(replay.credentials.ingestToken).not.toBe(first.credentials.ingestToken);

    const startedAt = Date.now();
    const rejectedOldToken = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt }),
    });
    expect(rejectedOldToken.status).toBe(401);

    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${replay.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;
    expect(stream).toMatchObject({
      sessionId: replay.credentials.relaySessionId,
      relayScope: 'account-block',
    });
    expect(JSON.stringify(stream)).not.toMatch(/clubId|studioRiderId/i);

    const activeDoublePress = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('second-press'),
        enrollmentId: enrolled.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(activeDoublePress.status).toBe(200);
    const recovered = await activeDoublePress.json() as any;
    expect(recovered.connection.id).toBe(first.connection.id);
    expect(recovered.credentials.ingestToken).not.toBe(replay.credentials.ingestToken);

    const stoppedResponse = await api(
      `/api/heart-rate/watch-connect/connections/${encodeURIComponent(first.connection.id)}`,
      { method: 'DELETE' },
      athlete.cookie,
    );
    expect(stoppedResponse.status).toBe(200);
    expect((await stoppedResponse.json() as any).connection.state).toBe('stopped');

    const queuedSample = await api(`/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${recovered.credentials.ingestToken}` },
      body: JSON.stringify({
        samples: [{
          sequence: 0,
          recordedAt: startedAt,
          activeElapsedMs: 0,
          bpm: 144,
        }],
      }),
    });
    expect(queuedSample.status).toBe(200);
    expect(await queuedSample.json()).toEqual({ accepted: 1, duplicates: 0 });

    const reconnectResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('after-explicit-stop'),
        enrollmentId: enrolled.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(reconnectResponse.status).toBe(201);
    const reconnect = await reconnectResponse.json() as any;
    const reconnectStartedAt = Date.now();
    const reconnectStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${reconnect.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: reconnectStartedAt }),
    });
    expect(reconnectStreamResponse.status).toBe(201);
    const reconnectStream = (await reconnectStreamResponse.json() as any).stream;
    const directWatchFinalize = await api(
      `/api/heart-rate/streams/${encodeURIComponent(reconnectStream.id)}/finalize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${reconnect.credentials.ingestToken}` },
        body: JSON.stringify({
          endedAt: reconnectStartedAt,
          activeDurationMs: 0,
          samples: [{
            sequence: 0,
            recordedAt: reconnectStartedAt,
            activeElapsedMs: 0,
            bpm: 150,
          }],
        }),
      },
    );
    expect(directWatchFinalize.status).toBe(200);
    const statusAfterWatchStop = await api('/api/heart-rate/watch-connect', {}, athlete.cookie);
    const statusAfterWatchStopBody = await statusAfterWatchStop.json() as any;
    expect(statusAfterWatchStopBody.connections.find((candidate: any) => (
      candidate.id === reconnect.connection.id
    )).state).toBe('stopped');

    const immediateAfterWatchStop = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('after-watch-stop'),
        enrollmentId: enrolled.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(immediateAfterWatchStop.status).toBe(201);
    const allModesConnection = await immediateAfterWatchStop.json() as any;
    const allModesStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const allModesEndedAt = Date.now();
    const activityTypes = [
      'bmx-race',
      'straight-sprint',
      'explore',
      'get-pulled',
      'monitor-sprint',
    ];
    const allModeSessionIds: string[] = [];
    for (const activityType of activityTypes) {
      const sessionId = `watch-connect-${activityType}-${Date.now()}`;
      allModeSessionIds.push(sessionId);
      const save = await api('/api/training-sessions', {
        method: 'POST',
        body: JSON.stringify({
          session: {
            id: sessionId,
            activityType,
            title: `Watch Connect ${activityType}`,
            startedAt: allModesStartedAt,
            endedAt: allModesEndedAt,
            durationMs: allModesEndedAt - allModesStartedAt,
            distanceMeters: 10,
            source: 'live',
            createdAt: allModesStartedAt,
            details: {
              summaries: [{
                playerId: 1,
                finishTimeMs: allModesEndedAt - allModesStartedAt,
                cadence: 100,
                averageBpm: 999,
              }],
              activeClockSegments: [{
                startedAt: allModesStartedAt,
                endedAt: allModesEndedAt,
                activeElapsedAtStartMs: 0,
              }],
            },
          },
        }),
      }, athlete.cookie);
      expect(save.status).toBe(201);
      const savedBody = await save.json() as any;
      expect(savedBody.heartRate.status).toBe('pending');
      expect(JSON.stringify(savedBody.session)).not.toMatch(/heart.?rate|health.?kit|bpm|"HR"/i);
      const pendingHistory = await api(
        `/api/heart-rate/streams?sessionId=${encodeURIComponent(sessionId)}`,
        {},
        athlete.cookie,
      );
      expect(pendingHistory.status).toBe(200);
      expect(await pendingHistory.json()).toMatchObject({
        streams: [],
        segments: [],
        attachment: { status: 'syncing' },
      });
    }
    // The continuous Watch stream can arrive after the result POST. Every
    // exact private result binding above must reconcile when it does.
    const allModesStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${allModesConnection.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: allModesStartedAt - 1 }),
    });
    expect(allModesStreamResponse.status).toBe(201);
    const allModesStream = (await allModesStreamResponse.json() as any).stream;
    const allModesSamples = await api(
      `/api/heart-rate/streams/${encodeURIComponent(allModesStream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${allModesConnection.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 0,
            recordedAt: allModesStartedAt - 1,
            activeElapsedMs: 0,
            bpm: 111,
          }, {
            sequence: 1,
            recordedAt: allModesEndedAt,
            activeElapsedMs: allModesEndedAt - allModesStartedAt + 1,
            bpm: 146,
          }, {
            sequence: 2,
            recordedAt: allModesEndedAt + 1,
            activeElapsedMs: allModesEndedAt - allModesStartedAt + 2,
            bpm: 199,
          }],
        }),
      },
    );
    expect(allModesSamples.status).toBe(200);
    const latestForOwner = await api('/api/heart-rate/live/latest', {}, athlete.cookie);
    expect(latestForOwner.status).toBe(200);
    const latestForOwnerText = await latestForOwner.text();
    expect(latestForOwnerText).not.toMatch(/profileKey|pairing|token|samples/i);
    expect(JSON.parse(latestForOwnerText)).toMatchObject({
      freshnessMs: 10_000,
      reading: {
        streamId: allModesStream.id,
        sessionId: allModesConnection.credentials.relaySessionId,
        relayScope: 'account-block',
        riderId: `account:${athlete.user.id}`,
        bpm: 199,
        recordedAt: allModesEndedAt + 1,
        freshUntil: allModesEndedAt + 10_001,
      },
    });
    const latestForOther = await api('/api/heart-rate/live/latest', {}, other.cookie);
    expect(latestForOther.status).toBe(200);
    expect(await latestForOther.json()).toEqual({ reading: null, freshnessMs: 10_000 });
    expect((await api('/api/heart-rate/live/latest')).status).toBe(401);
    for (let index = 0; index < allModeSessionIds.length; index += 1) {
      const history = await api(
        `/api/heart-rate/streams?sessionId=${encodeURIComponent(allModeSessionIds[index])}`,
        {},
        athlete.cookie,
      );
      expect(history.status).toBe(200);
      const historyBody = await history.json() as any;
      expect(historyBody.attachment).toEqual({ status: 'saved' });
      expect(historyBody.segments).toEqual([
        expect.objectContaining({
          activityType: activityTypes[index],
          relayScope: 'account-block',
          trainingSessionId: allModeSessionIds[index],
          summary: expect.objectContaining({
            sampleCount: 1,
            minimumBpm: 146,
            averageBpm: 146,
            peakBpm: 146,
          }),
        }),
      ]);
    }
    const wrongAccountSameSession = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(allModeSessionIds[3])}`,
      {},
      other.cookie,
    );
    expect(wrongAccountSameSession.status).toBe(200);
    expect(await wrongAccountSameSession.json()).toEqual({
      streams: [],
      segments: [],
      attachment: { status: 'not-recorded' },
    });

    const legacyBlocksBefore = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    expect(legacyBlocksBefore.status).toBe(200);
    expect((await legacyBlocksBefore.json() as any).blocks).toEqual([]);

    const legacyCreate = await api('/api/heart-rate/account-blocks', {
      method: 'POST',
      body: JSON.stringify({ requestId: requestId('legacy-alongside-watch-connect') }),
    }, athlete.cookie);
    expect(legacyCreate.status).toBe(201);
    const legacyCreateBody = await legacyCreate.json() as any;
    expect(legacyCreateBody.pairing.id).not.toBe(allModesConnection.credentials.pairingId);
    const legacyBlocksAfter = await api('/api/heart-rate/account-blocks', {}, athlete.cookie);
    expect((await legacyBlocksAfter.json() as any).blocks).toEqual([
      expect.objectContaining({ pairingId: legacyCreateBody.pairing.id }),
    ]);

    const legacyHandoffCannotControlWatch = await api(
      `/api/heart-rate/account-blocks/${encodeURIComponent(allModesConnection.credentials.pairingId)}/handoff`,
      { method: 'POST', body: JSON.stringify({}) },
      athlete.cookie,
    );
    expect(legacyHandoffCannotControlWatch.status).toBe(404);
    const legacyStopCannotControlWatch = await api(
      `/api/heart-rate/account-blocks/${encodeURIComponent(allModesConnection.credentials.pairingId)}`,
      { method: 'DELETE' },
      athlete.cookie,
    );
    expect(legacyStopCannotControlWatch.status).toBe(404);
    const stillConnected = await api('/api/heart-rate/watch-connect', {}, athlete.cookie);
    expect((await stillConnected.json() as any).connections.find((candidate: any) => (
      candidate.id === allModesConnection.connection.id
    )).state).toBe('connected');

    const legacySignoutRevoke = await api(
      `/api/heart-rate/pairings/${encodeURIComponent(allModesConnection.credentials.pairingId)}`,
      { method: 'DELETE' },
      athlete.cookie,
    );
    expect(legacySignoutRevoke.status).toBe(200);
    const afterLegacySignout = await api('/api/heart-rate/watch-connect', {}, athlete.cookie);
    expect((await afterLegacySignout.json() as any).connections.find((candidate: any) => (
      candidate.id === allModesConnection.connection.id
    )).state).toBe('revoked');
    const latestAfterRevoke = await api('/api/heart-rate/live/latest', {}, athlete.cookie);
    expect(latestAfterRevoke.status).toBe(200);
    expect(await latestAfterRevoke.json()).toEqual({ reading: null, freshnessMs: 10_000 });
    const revokedToken = await api(
      `/api/heart-rate/streams/${encodeURIComponent(allModesStream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${allModesConnection.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 1,
            recordedAt: allModesStartedAt + 1,
            activeElapsedMs: 1,
            bpm: 145,
          }],
        }),
      },
    );
    expect(revokedToken.status).toBe(401);

    const otherStatus = await api('/api/heart-rate/watch-connect', {}, other.cookie);
    expect(otherStatus.status).toBe(200);
    expect(await otherStatus.json()).toEqual({ enrollments: [], connections: [] });
  });

  it('recognizes the exact claimed studio athlete without binding Watch trust to a Wattbike', async () => {
    const owner = await register('watch-connect-owner@tracklab.test', 'Watch Studio Owner');
    const athlete = await register('watch-connect-studio-athlete@tracklab.test', 'Studio Watch Athlete');
    const studioRiderId = `watch-rider-${Date.now()}`;
    const unclaimedStudioRiderId = `watch-unclaimed-rider-${Date.now()}`;
    const now = Date.now();

    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Studio Watch Athlete',
          createdAt: now,
          updatedAt: now,
        }, {
          id: unclaimedStudioRiderId,
          name: 'Unclaimed Tablet Athlete',
          createdAt: now,
          updatedAt: now,
        }],
      }),
    }, owner.cookie);
    expect(rosterSave.status).toBe(200);
    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, owner.cookie);
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as any;
    expect((await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token, fullName: 'Studio Watch Athlete' }),
    }, athlete.cookie)).status).toBe(200);
    const clubState = await (await api('/api/club-connect', {}, athlete.cookie)).json() as any;
    const membership = clubState.memberships.find((candidate: any) => (
      candidate.studioRiderId === studioRiderId
    ));
    expect(membership).toBeTruthy();

    const enrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('studio-enroll'),
        installId: installId('b'),
        scope: 'studio',
        clubId: membership.clubId,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = (await enrollmentResponse.json() as any).enrollment;
    expect(enrollment).toMatchObject({
      scope: 'studio',
      clubId: membership.clubId,
      studioRiderId,
      state: 'trusted',
    });

    const connectedResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('studio-connect'),
        enrollmentId: enrollment.id,
        installId: installId('b'),
      }),
    }, athlete.cookie);
    expect(connectedResponse.status).toBe(201);
    const connected = await connectedResponse.json() as any;
    expect(connected.connection).toMatchObject({
      scope: 'studio',
      clubId: membership.clubId,
      studioRiderId,
      state: 'connecting',
    });
    expect(JSON.stringify(connected.connection)).not.toContain('bike');

    const studioStartedAt = Date.now();
    const studioStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${connected.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: studioStartedAt }),
    });
    expect(studioStreamResponse.status).toBe(201);
    const studioStream = (await studioStreamResponse.json() as any).stream;
    const studioSample = await api(
      `/api/heart-rate/streams/${encodeURIComponent(studioStream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connected.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 0,
            recordedAt: studioStartedAt,
            activeElapsedMs: 0,
            bpm: 152,
          }],
        }),
      },
    );
    expect(studioSample.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const studioEndedAt = Date.now();
    const studioTrainingSessionId = `watch-connect-studio-session-${Date.now()}`;
    const studioSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: membership.clubId,
          studioRiderId,
        },
        session: {
          id: studioTrainingSessionId,
          activityType: 'straight-sprint',
          title: 'Watch Connect studio sharing test',
          startedAt: studioStartedAt,
          endedAt: studioEndedAt,
          durationMs: studioEndedAt - studioStartedAt,
          distanceMeters: 10,
          source: 'live',
          createdAt: studioStartedAt,
          details: {
            summaries: [{ playerId: 1, finishTimeMs: studioEndedAt - studioStartedAt }],
            activeClockSegments: [{
              startedAt: studioStartedAt,
              endedAt: studioEndedAt,
              activeElapsedAtStartMs: 0,
            }],
          },
        },
      }),
    }, athlete.cookie);
    expect(studioSave.status).toBe(201);
    expect((await studioSave.json() as any).heartRate).toMatchObject({ status: 'created' });
    const summariesBeforeDisconnect = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      owner.cookie,
    );
    expect(summariesBeforeDisconnect.status).toBe(200);
    expect((await summariesBeforeDisconnect.json() as any).segments).toHaveLength(1);

    const ownerProjection = await api(
      `/api/heart-rate/watch-connect/studio?clubId=${encodeURIComponent(membership.clubId)}`,
      {},
      owner.cookie,
    );
    expect(ownerProjection.status).toBe(200);
    const ownerProjectionBody = await ownerProjection.json() as any;
    expect(ownerProjectionBody.athletes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        studioRiderId,
        riderName: 'Studio Watch Athlete',
        state: 'connected',
      }),
    ]));
    expect(JSON.stringify(ownerProjectionBody)).not.toMatch(/athleteProfileKey|installId|ingestToken|bikeDeviceId/i);

    const legacyStudioBlocks = await api(
      `/api/heart-rate/studio-blocks?clubId=${encodeURIComponent(membership.clubId)}`,
      {},
      owner.cookie,
    );
    expect(legacyStudioBlocks.status).toBe(200);
    expect((await legacyStudioBlocks.json() as any).blocks).toEqual([]);
    const legacyStudioInvitations = await api(
      '/api/heart-rate/studio-invitations',
      {},
      owner.cookie,
    );
    expect(legacyStudioInvitations.status).toBe(200);
    expect((await legacyStudioInvitations.json() as any).invitations).toEqual([]);
    const legacyStudioStopCannotControlWatch = await api(
      `/api/heart-rate/studio-blocks/${encodeURIComponent(connected.credentials.pairingId)}`,
      { method: 'DELETE' },
      owner.cookie,
    );
    expect(legacyStudioStopCannotControlWatch.status).toBe(404);

    const tabletEnrollment = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Watch Connect Tablet' }),
    }, owner.cookie);
    expect(tabletEnrollment.status).toBe(201);
    const tablet = await tabletEnrollment.json() as any;
    const tabletRoster = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
    });
    expect(tabletRoster.status).toBe(200);
    const tabletRosterBody = await tabletRoster.json() as any;
    const tabletAthlete = tabletRosterBody.athletes.find((candidate: any) => (
      candidate.studioRiderId === studioRiderId
    ));
    expect(tabletAthlete.watchConnect).toMatchObject({
      recognized: true,
      state: 'connected',
      connectedUntil: connected.connection.connectedUntil,
      liveSharingEnabled: true,
    });
    expect(JSON.stringify(tabletAthlete.watchConnect)).not.toMatch(/profile|token|bpm|bike/i);

    const tabletSessionResponse = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'WatchTabletBike1' }),
    });
    expect(tabletSessionResponse.status).toBe(201);
    const tabletSession = await tabletSessionResponse.json() as any;
    const tabletSessionHeaders = {
      'X-TrackLab-Club-Tablet-Session': tabletSession.sessionToken,
    };
    expect((await api('/api/heart-rate/watch-connect/tablet-live')).status).toBe(401);
    expect((await api('/api/heart-rate/live/latest', {
      headers: tabletSessionHeaders,
    })).status).toBe(403);
    expect((await api('/api/heart-rate/live', {
      headers: tabletSessionHeaders,
    })).status).toBe(403);
    const tabletStatus = await api('/api/heart-rate/watch-connect/tablet-status', {
      headers: tabletSessionHeaders,
    });
    expect(tabletStatus.status).toBe(200);
    expect(await tabletStatus.json()).toEqual({
      watchConnect: {
        recognized: true,
        state: 'connected',
        connectedUntil: connected.connection.connectedUntil,
        remainingMs: expect.any(Number),
        liveSharingEnabled: true,
      },
    });
    const tabletLive = await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletSessionHeaders,
    });
    expect(tabletLive.status).toBe(200);
    const tabletLiveText = await tabletLive.text();
    expect(tabletLiveText).not.toMatch(/account|profile|stream|sessionId|pairing|token|samples/i);
    expect(JSON.parse(tabletLiveText)).toMatchObject({
      freshnessMs: 10_000,
      reading: {
        studioRiderId,
        bpm: 152,
        recordedAt: studioStartedAt,
        freshUntil: studioStartedAt + 10_000,
      },
    });
    const tabletSessionAfterReads = await api('/api/club-tablet/sessions', {
      headers: tabletSessionHeaders,
    });
    expect(tabletSessionAfterReads.status).toBe(200);
    expect((await tabletSessionAfterReads.json() as any).session.expiresAt)
      .toBe(tabletSession.session.expiresAt);

    const disableLiveSharing = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('studio-disable-live-sharing'),
        installId: installId('b'),
        scope: 'studio',
        clubId: membership.clubId,
        liveStudioConsent: false,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(disableLiveSharing.status).toBe(200);
    const tabletStatusWithoutLiveConsent = await api('/api/heart-rate/watch-connect/tablet-status', {
      headers: tabletSessionHeaders,
    });
    expect(tabletStatusWithoutLiveConsent.status).toBe(200);
    expect(await tabletStatusWithoutLiveConsent.json()).toMatchObject({
      watchConnect: {
        recognized: true,
        state: 'connected',
        liveSharingEnabled: false,
      },
    });
    const tabletLiveWithoutConsent = await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletSessionHeaders,
    });
    expect(tabletLiveWithoutConsent.status).toBe(200);
    expect(await tabletLiveWithoutConsent.json()).toEqual({
      reading: null,
      freshnessMs: 10_000,
    });

    const wrongOwner = await register(
      'watch-connect-wrong-studio-owner@tracklab.test',
      'Wrong Studio Owner',
    );
    const disconnectPath = `/api/heart-rate/watch-connect/studio/enrollments/${encodeURIComponent(enrollment.id)}`;
    const wrongOwnerDisconnect = await api(
      `${disconnectPath}?clubId=${encodeURIComponent(membership.clubId)}`,
      { method: 'DELETE' },
      wrongOwner.cookie,
    );
    expect(wrongOwnerDisconnect.status).toBe(404);
    expect(await wrongOwnerDisconnect.json()).toEqual({
      error: 'That studio Watch Connect setup was not found.',
    });
    const ownerCookie = await login('watch-connect-owner@tracklab.test');
    const wrongClubDisconnect = await api(
      `${disconnectPath}?clubId=${encodeURIComponent('different-club')}`,
      { method: 'DELETE' },
      ownerCookie,
    );
    expect(wrongClubDisconnect.status).toBe(404);
    expect(await wrongClubDisconnect.json()).toEqual({
      error: 'That studio Watch Connect setup was not found.',
    });
    const wrongEnrollmentDisconnect = await api(
      `/api/heart-rate/watch-connect/studio/enrollments/${encodeURIComponent('missing-enrollment')}?clubId=${encodeURIComponent(membership.clubId)}`,
      { method: 'DELETE' },
      ownerCookie,
    );
    expect(wrongEnrollmentDisconnect.status).toBe(404);
    expect(await wrongEnrollmentDisconnect.json()).toEqual({
      error: 'That studio Watch Connect setup was not found.',
    });

    const ownerDisconnect = await api(
      `${disconnectPath}?clubId=${encodeURIComponent(membership.clubId)}`,
      { method: 'DELETE' },
      ownerCookie,
    );
    expect(ownerDisconnect.status).toBe(200);
    const disconnectedAthlete = (await ownerDisconnect.json() as any).athlete;
    expect(disconnectedAthlete).toMatchObject({
      clubId: membership.clubId,
      studioRiderId,
      state: 'not-set-up',
      enrollment: {
        id: enrollment.id,
        state: 'revoked',
        liveStudioConsent: false,
        sessionStudioConsent: false,
      },
      connection: {
        id: connected.connection.id,
        state: 'revoked',
        liveStudioConsent: false,
        sessionStudioConsent: false,
      },
    });
    expect(JSON.stringify(disconnectedAthlete)).not.toMatch(/profile|token|bpm|bike/i);

    const tabletLiveAfterOwnerRevoke = await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletSessionHeaders,
    });
    expect(tabletLiveAfterOwnerRevoke.status).toBe(200);
    expect(await tabletLiveAfterOwnerRevoke.json()).toEqual({
      reading: null,
      freshnessMs: 10_000,
    });

    const switchedTabletSessionResponse = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
      body: JSON.stringify({
        studioRiderId: unclaimedStudioRiderId,
        bikeDeviceId: 'WatchTabletBike2',
      }),
    });
    expect(switchedTabletSessionResponse.status).toBe(201);
    const switchedTabletSession = await switchedTabletSessionResponse.json() as any;
    expect((await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletSessionHeaders,
    })).status).toBe(401);
    expect((await api('/api/heart-rate/watch-connect/tablet-status', {
      headers: tabletSessionHeaders,
    })).status).toBe(401);
    expect((await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: {
        'X-TrackLab-Club-Tablet-Session': switchedTabletSession.sessionToken,
      },
    })).status).toBe(403);
    const stoppedTabletSession = await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: {
        'X-TrackLab-Club-Tablet-Session': switchedTabletSession.sessionToken,
      },
    });
    expect(stoppedTabletSession.status).toBe(200);
    expect((await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: {
        'X-TrackLab-Club-Tablet-Session': switchedTabletSession.sessionToken,
      },
    })).status).toBe(401);

    const tabletRosterAfterDisconnect = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
    });
    const disconnectedTabletAthlete = (await tabletRosterAfterDisconnect.json() as any).athletes
      .find((candidate: any) => candidate.studioRiderId === studioRiderId);
    expect(disconnectedTabletAthlete.watchConnect).toMatchObject({
      recognized: false,
      state: 'not-set-up',
      remainingMs: 0,
      liveSharingEnabled: false,
    });
    const summariesAfterDisconnect = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      ownerCookie,
    );
    expect(summariesAfterDisconnect.status).toBe(200);
    expect((await summariesAfterDisconnect.json() as any).segments).toEqual([]);

    const privateQueuedSample = await api(
      `/api/heart-rate/streams/${encodeURIComponent(studioStream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connected.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 1,
            recordedAt: studioStartedAt + 1,
            activeElapsedMs: 1,
            bpm: 151,
          }],
        }),
      },
    );
    expect(privateQueuedSample.status).toBe(200);
    expect(await privateQueuedSample.json()).toEqual({ accepted: 1, duplicates: 0 });
    const summariesAfterPrivateDrain = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      ownerCookie,
    );
    expect((await summariesAfterPrivateDrain.json() as any).segments).toEqual([]);
    const cannotRestoreOldConsent = await api(
      `/api/heart-rate/pairings/${encodeURIComponent(connected.credentials.pairingId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ liveStudioConsent: true, sessionStudioConsent: true }),
      },
      athlete.cookie,
    );
    expect(cannotRestoreOldConsent.status).toBe(409);

    const membershipAfterDisconnect = await api('/api/club-connect', {}, athlete.cookie);
    expect((await membershipAfterDisconnect.json() as any).memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({
        clubId: membership.clubId,
        studioRiderId,
      })]),
    );
    const reenrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('studio-reenroll-after-owner-disconnect'),
        installId: installId('b'),
        scope: 'studio',
        clubId: membership.clubId,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    expect(reenrollmentResponse.status).toBe(201);
    const reenrollment = (await reenrollmentResponse.json() as any).enrollment;
    expect(reenrollment).toMatchObject({
      state: 'trusted',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    });
    expect(reenrollment.id).not.toBe(enrollment.id);
    const reconnectAfterOwnerDisconnect = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('studio-reconnect-after-owner-disconnect'),
        enrollmentId: reenrollment.id,
        installId: installId('b'),
      }),
    }, athlete.cookie);
    expect(reconnectAfterOwnerDisconnect.status).toBe(201);
    const reconnected = await reconnectAfterOwnerDisconnect.json() as any;
    expect(reconnected.connection).toMatchObject({ state: 'connecting', scope: 'studio' });
    const tabletRosterAfterReenroll = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
    });
    const reenrolledTabletAthlete = (await tabletRosterAfterReenroll.json() as any).athletes
      .find((candidate: any) => candidate.studioRiderId === studioRiderId);
    expect(reenrolledTabletAthlete.watchConnect).toMatchObject({
      recognized: true,
      state: 'ready',
      liveSharingEnabled: true,
    });

    const deviceRevokeSessionResponse = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'WatchTabletBike3' }),
    });
    expect(deviceRevokeSessionResponse.status).toBe(201);
    const deviceRevokeSession = await deviceRevokeSessionResponse.json() as any;
    const revokeTabletDevice = await api('/api/club-tablet/devices', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: tablet.device.id }),
    }, ownerCookie);
    expect(revokeTabletDevice.status).toBe(200);
    expect((await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: {
        'X-TrackLab-Club-Tablet-Session': deviceRevokeSession.sessionToken,
      },
    })).status).toBe(401);

    const revokeMembership = await api('/api/club-connect/revoke', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, ownerCookie);
    expect(revokeMembership.status).toBe(200);
    const rejectedAfterMembershipEnd = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${reconnected.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: Date.now() }),
    });
    expect(rejectedAfterMembershipEnd.status).toBe(401);
    const athleteStatus = await api('/api/heart-rate/watch-connect', {}, athlete.cookie);
    const athleteStatusBody = await athleteStatus.json() as any;
    expect(athleteStatusBody.enrollments.find((candidate: any) => candidate.id === reenrollment.id).state)
      .toBe('membership-required');
  });

  it('starts a fresh four-hour connection after five hours while the prior upload drains', async () => {
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const profileKey = `user:memory-${suffix}`;
    const enrollment = await persistence.createOrRefreshHeartRateWatchEnrollment({
      id: `memory-enrollment-${suffix}`,
      ownerProfileKey: profileKey,
      requestId: `memory-enrollment-request-${suffix}`,
      installIdHash: `memory-install-${suffix}`,
      scope: 'personal',
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
      now: 1_000_000,
    });
    expect(enrollment.status).toBe('created');
    const first = await persistence.createHeartRateWatchConnection({
      id: `memory-connection-one-${suffix}`,
      enrollmentId: enrollment.enrollment!.id,
      ownerProfileKey: profileKey,
      requestId: `memory-connection-request-one-${suffix}`,
      installIdHash: `memory-install-${suffix}`,
      pairingId: `memory-pairing-one-${suffix}`,
      relaySessionId: `watch-connect:memory-one-${suffix}`,
      riderId: `account:memory-${suffix}`,
      pairCodeHash: `memory-code-one-${suffix}`,
      ingestTokenHash: `memory-token-one-${suffix}`,
      connectedUntil: 1_000_000 + persistence.heartRateWatchConnectDurationMs,
      now: 1_000_000,
    });
    expect(first.status).toBe('created');
    const fiveHoursLater = 1_000_000 + 5 * 60 * 60 * 1000;
    const second = await persistence.createHeartRateWatchConnection({
      id: `memory-connection-two-${suffix}`,
      enrollmentId: enrollment.enrollment!.id,
      ownerProfileKey: profileKey,
      requestId: `memory-connection-request-two-${suffix}`,
      installIdHash: `memory-install-${suffix}`,
      pairingId: `memory-pairing-two-${suffix}`,
      relaySessionId: `watch-connect:memory-two-${suffix}`,
      riderId: `account:memory-${suffix}`,
      pairCodeHash: `memory-code-two-${suffix}`,
      ingestTokenHash: `memory-token-two-${suffix}`,
      connectedUntil: fiveHoursLater + persistence.heartRateWatchConnectDurationMs,
      now: fiveHoursLater,
    });
    expect(second.status).toBe('created');
    expect(second.connection?.connectedUntil - second.connection?.connectedAt)
      .toBe(persistence.heartRateWatchConnectDurationMs);
    expect(await persistence.loadHeartRatePairingByIngestTokenHash(
      `memory-token-one-${suffix}`,
      fiveHoursLater,
    )).not.toBeNull();
    const connections = await persistence.loadHeartRateWatchConnections(profileKey);
    expect(connections).toHaveLength(2);
    expect(connections.find((candidate) => candidate.id === first.connection?.id)?.stoppedReason)
      .toBe('expired');
  });

  it('projects sensor-time freshness at the exact ten-second boundary while retaining private uploads', async () => {
    const base = 40_000_000;
    const setupStream = async (label: string) => {
      const profileKey = `user:live-boundary-${label}`;
      const enrollmentId = `live-boundary-enrollment-${label}`;
      const tokenHash = `live-boundary-token-${label}`;
      const enrollment = await persistence.createOrRefreshHeartRateWatchEnrollment({
        id: enrollmentId,
        ownerProfileKey: profileKey,
        requestId: `live-boundary-enrollment-request-${label}`,
        installIdHash: `live-boundary-install-${label}`,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        liveStudioConsent: false,
        sessionStudioConsent: false,
        now: base,
      });
      expect(enrollment.status).toBe('created');
      const connection = await persistence.createHeartRateWatchConnection({
        id: `live-boundary-connection-${label}`,
        enrollmentId,
        ownerProfileKey: profileKey,
        requestId: `live-boundary-connect-request-${label}`,
        installIdHash: `live-boundary-install-${label}`,
        pairingId: `live-boundary-pairing-${label}`,
        relaySessionId: `watch-connect:live-boundary-${label}`,
        riderId: `account:live-boundary-${label}`,
        pairCodeHash: `live-boundary-code-${label}`,
        ingestTokenHash: tokenHash,
        connectedUntil: base + persistence.heartRateWatchConnectDurationMs,
        now: base,
      });
      expect(connection.status).toBe('created');
      const streamId = `live-boundary-stream-${label}`;
      const stream = await persistence.createHeartRateStream(
        connection.pairing!.id,
        tokenHash,
        streamId,
        base,
        base,
      );
      expect(stream?.id).toBe(streamId);
      return { profileKey, streamId, tokenHash };
    };

    const boundary = await setupStream('fresh');
    const sensorRecordedAt = base + 1_000;
    expect(await persistence.insertHeartRateSamples(boundary.streamId, boundary.tokenHash, [{
      sequence: 0,
      recordedAt: sensorRecordedAt,
      activeElapsedMs: 1_000,
      bpm: 145,
    }], sensorRecordedAt)).toEqual([0]);
    await expect(persistence.loadLatestHeartRateLiveReading(
      boundary.profileKey,
      sensorRecordedAt - 1,
      sensorRecordedAt + 9_999,
    )).resolves.toMatchObject({ bpm: 145, recordedAt: sensorRecordedAt });
    await expect(persistence.loadLatestHeartRateLiveReading(
      boundary.profileKey,
      sensorRecordedAt,
      sensorRecordedAt + 10_000,
    )).resolves.toBeNull();

    const delayed = await setupStream('delayed');
    expect(await persistence.insertHeartRateSamples(delayed.streamId, delayed.tokenHash, [{
      sequence: 0,
      recordedAt: base + 1_000,
      activeElapsedMs: 1_000,
      bpm: 146,
    }], base + 30_000)).toEqual([0]);
    await expect(persistence.loadLatestHeartRateLiveReading(
      delayed.profileKey,
      base + 20_000,
      base + 30_000,
    )).resolves.toBeNull();
    await expect(persistence.loadHeartRateSamples(delayed.streamId)).resolves.toEqual([{
      sequence: 0,
      recordedAt: base + 1_000,
      activeElapsedMs: 1_000,
      bpm: 146,
    }]);

    const future = await setupStream('future');
    expect(await persistence.insertHeartRateSamples(future.streamId, future.tokenHash, [{
      sequence: 0,
      recordedAt: base + 3_001,
      activeElapsedMs: 3_001,
      bpm: 147,
    }], base)).toEqual([0]);
    await expect(persistence.loadLatestHeartRateLiveReading(
      future.profileKey,
      base - 10_000,
      base,
    )).resolves.toBeNull();
    // It must stay non-live even after wall-clock time catches up. Receipt-time
    // validation prevents a future-dated offline batch from becoming a pulse.
    await expect(persistence.loadLatestHeartRateLiveReading(
      future.profileKey,
      base - 6_000,
      base + 4_000,
    )).resolves.toBeNull();
    await expect(persistence.loadHeartRateSamples(future.streamId)).resolves.toHaveLength(1);
  });

  it('projects tablet BPM only from the exact active studio Watch connection pairing', async () => {
    const now = Date.now();
    const suffix = `${now}-${Math.random().toString(16).slice(2)}`;
    const ownerProfileKey = `user:tablet-owner-${suffix}`;
    const athleteProfileKey = `user:tablet-athlete-${suffix}`;
    const clubId = `tablet-club-${suffix}`;
    const studioRiderId = `tablet-rider-${suffix}`;
    const club = await persistence.ensureClub(ownerProfileKey, 'Tablet Test Club', clubId);
    await persistence.ensureClubRosterMember(ownerProfileKey, studioRiderId, 'Tablet Athlete');
    const inviteTokenHash = `tablet-invite-${suffix}`;
    await persistence.saveClubInvite({
      club,
      studioRiderId,
      riderName: 'Tablet Athlete',
      inviteId: `tablet-invite-id-${suffix}`,
      tokenHash: inviteTokenHash,
      expiresAt: now + 60_000,
    });
    await expect(persistence.claimClubInvite(
      inviteTokenHash,
      athleteProfileKey,
      'Tablet Athlete',
    )).resolves.toEqual({ clubId, studioRiderId });

    const enrollmentId = `tablet-enrollment-${suffix}`;
    const enrollment = await persistence.createOrRefreshHeartRateWatchEnrollment({
      id: enrollmentId,
      ownerProfileKey: athleteProfileKey,
      requestId: `tablet-enrollment-request-${suffix}`,
      installIdHash: `tablet-install-${suffix}`,
      scope: 'studio',
      clubId,
      studioRiderId,
      liveStudioConsent: true,
      sessionStudioConsent: false,
      now,
    });
    expect(enrollment.status).toBe('created');
    const connectionId = `tablet-connection-${suffix}`;
    const pairingId = `tablet-pairing-${suffix}`;
    const tokenHash = `tablet-token-${suffix}`;
    const connection = await persistence.createHeartRateWatchConnection({
      id: connectionId,
      enrollmentId,
      ownerProfileKey: athleteProfileKey,
      requestId: `tablet-connect-request-${suffix}`,
      installIdHash: `tablet-install-${suffix}`,
      pairingId,
      relaySessionId: `watch-connect:${connectionId}`,
      riderId: `account:tablet-athlete-${suffix}`,
      pairCodeHash: `tablet-code-${suffix}`,
      ingestTokenHash: tokenHash,
      connectedUntil: now + persistence.heartRateWatchConnectDurationMs,
      now,
    });
    expect(connection.status).toBe('created');
    const streamId = `tablet-stream-${suffix}`;
    expect(await persistence.createHeartRateStream(
      pairingId,
      tokenHash,
      streamId,
      now,
      now,
    )).toMatchObject({ id: streamId, relayScope: 'studio-block' });
    expect(await persistence.insertHeartRateSamples(streamId, tokenHash, [{
      sequence: 0,
      recordedAt: now + 100,
      activeElapsedMs: 100,
      bpm: 154,
    }], now + 100)).toEqual([0]);

    const exact = {
      athleteProfileKey,
      clubId,
      studioRiderId,
      watchConnectionId: connectionId,
      watchEnrollmentId: enrollmentId,
      pairingId,
      freshAfter: now - 9_000,
      now: now + 200,
    };
    await expect(persistence.loadLatestStudioTabletHeartRateReading(exact))
      .resolves.toMatchObject({ studioRiderId, bpm: 154, recordedAt: now + 100 });
    await expect(persistence.loadLatestStudioTabletHeartRateReading({
      ...exact,
      pairingId: `different-pairing-${suffix}`,
    })).resolves.toBeNull();
    await expect(persistence.loadLatestStudioTabletHeartRateReading({
      ...exact,
      watchConnectionId: `different-connection-${suffix}`,
    })).resolves.toBeNull();
    await expect(persistence.loadLatestStudioTabletHeartRateReading({
      ...exact,
      watchEnrollmentId: `different-enrollment-${suffix}`,
    })).resolves.toBeNull();
  });

  it('keeps same-session club heart-rate streams and segments scoped to the exact studio rider', async () => {
    const now = Date.now();
    const suffix = `${now}-${Math.random().toString(16).slice(2)}`;
    const ownerProfileKey = `user:shared-session-owner-${suffix}`;
    const clubId = `shared-session-club-${suffix}`;
    const sessionId = `shared-session-${suffix}`;
    const startedAt = now + 1_000;
    const endedAt = now + 5_000;
    const club = await persistence.ensureClub(ownerProfileKey, 'Shared Session Club', clubId);

    const setupRider = async (label: string, playerId: number, bpm: number) => {
      const athleteProfileKey = `user:shared-session-${label}-${suffix}`;
      const studioRiderId = `shared-session-rider-${label}-${suffix}`;
      await persistence.ensureClubRosterMember(ownerProfileKey, studioRiderId, `Rider ${label}`);
      const inviteTokenHash = `shared-session-invite-${label}-${suffix}`;
      await persistence.saveClubInvite({
        club,
        studioRiderId,
        riderName: `Rider ${label}`,
        inviteId: `shared-session-invite-id-${label}-${suffix}`,
        tokenHash: inviteTokenHash,
        expiresAt: now + 60_000,
      });
      await expect(persistence.claimClubInvite(
        inviteTokenHash,
        athleteProfileKey,
        `Rider ${label}`,
      )).resolves.toEqual({ clubId, studioRiderId });

      const createPairingAndStream = async (relayScope: 'session' | 'studio-block') => {
        const pairingId = `shared-session-${relayScope}-pairing-${label}-${suffix}`;
        const pairCodeHash = `shared-session-${relayScope}-code-${label}-${suffix}`;
        const ingestTokenHash = `shared-session-${relayScope}-token-${label}-${suffix}`;
        expect(await persistence.createHeartRatePairing({
          id: pairingId,
          ownerProfileKey: athleteProfileKey,
          sessionId,
          activityType: relayScope === 'session' ? 'bmx-race' : 'training-block',
          riderId: `account:shared-session-${label}-${suffix}`,
          playerId,
          relayScope,
          clubId,
          studioRiderId,
          pairCodeHash,
          pairCodeExpiresAt: now + 60_000,
          liveStudioConsent: true,
          sessionStudioConsent: true,
          createdAt: now,
        })).toMatchObject({ id: pairingId, studioRiderId, relayScope });
        expect(await persistence.claimHeartRatePairing(
          pairCodeHash,
          ingestTokenHash,
          now + 1,
          now + 60_000,
          now + 60_000,
          athleteProfileKey,
        )).toMatchObject({ id: pairingId });
        const streamId = `shared-session-${relayScope}-stream-${label}-${suffix}`;
        expect(await persistence.createHeartRateStream(
          pairingId,
          ingestTokenHash,
          streamId,
          now,
          now + 2,
        )).toMatchObject({ id: streamId, studioRiderId, relayScope });
        return { streamId, ingestTokenHash };
      };

      const sessionStream = await createPairingAndStream('session');
      const summary = {
        sampleCount: 1,
        coverageMs: 1_000,
        coveragePercent: 25,
        firstSampleElapsedMs: 1_000,
        lastSampleElapsedMs: 1_000,
        minimumBpm: bpm,
        averageBpm: bpm,
        peakBpm: bpm,
      };
      expect(await persistence.finalizeHeartRateStream(
        sessionStream.streamId,
        sessionStream.ingestTokenHash,
        { endedAt, activeDurationMs: 4_000, summary, finalizedAt: endedAt + 1 },
      )).toMatchObject({ id: sessionStream.streamId, summary });

      const blockStream = await createPairingAndStream('studio-block');
      expect(await persistence.insertHeartRateSamples(blockStream.streamId, blockStream.ingestTokenHash, [{
        sequence: 0,
        recordedAt: startedAt + 1_000,
        activeElapsedMs: 2_000,
        bpm,
      }], startedAt + 1_000)).toEqual([0]);
      const segment = await persistence.createHeartRateTrainingSegmentForClubSession({
        athleteProfileKey,
        clubId,
        studioRiderId,
        trainingSessionId: sessionId,
        activityType: 'bmx-race',
        playerId,
        startedAt,
        endedAt,
        zoneWindows: [],
        activeClockSegments: [],
        now: endedAt + 2,
      });
      expect(segment).toMatchObject({
        status: 'created',
        segment: { trainingSessionId: sessionId, studioRiderId, playerId },
      });
      return { studioRiderId, sessionStreamId: sessionStream.streamId, segmentId: segment.segment.id };
    };

    const riderA = await setupRider('a', 1, 151);
    const riderB = await setupRider('b', 2, 171);
    await expect(persistence.loadClubHeartRateStreamSummaries(
      clubId,
      sessionId,
      riderA.studioRiderId,
    )).resolves.toEqual([expect.objectContaining({
      id: riderA.sessionStreamId,
      studioRiderId: riderA.studioRiderId,
    })]);
    await expect(persistence.loadClubHeartRateStreamSummaries(
      clubId,
      sessionId,
      riderB.studioRiderId,
    )).resolves.toEqual([expect.objectContaining({
      id: riderB.sessionStreamId,
      studioRiderId: riderB.studioRiderId,
    })]);
    await expect(persistence.loadClubHeartRateTrainingSegments(
      clubId,
      sessionId,
      riderA.studioRiderId,
    )).resolves.toEqual([expect.objectContaining({
      id: riderA.segmentId,
      studioRiderId: riderA.studioRiderId,
    })]);
    await expect(persistence.loadClubHeartRateTrainingSegments(
      clubId,
      sessionId,
      riderB.studioRiderId,
    )).resolves.toEqual([expect.objectContaining({
      id: riderB.segmentId,
      studioRiderId: riderB.studioRiderId,
    })]);

    const persistenceSource = readFileSync(
      new URL('../../cloud/persistence.mjs', import.meta.url),
      'utf8',
    );
    const streamLoaderSource = persistenceSource.slice(
      persistenceSource.indexOf('export async function loadClubHeartRateStreamSummaries'),
      persistenceSource.indexOf('function heartRateTrainingSegmentId'),
    );
    expect(streamLoaderSource).toContain('streams.studio_rider_id = $3');
    expect(streamLoaderSource).toContain('pairings.studio_rider_id = $3');
    expect(streamLoaderSource).toContain('[clubId, sessionId, studioRiderId]');
    const segmentLoaderSource = persistenceSource.slice(
      persistenceSource.indexOf('export async function loadClubHeartRateTrainingSegments'),
      persistenceSource.indexOf('async function linkHeartRateStreamsToTrainingSession'),
    );
    expect(segmentLoaderSource).toContain('segments.studio_rider_id = $3');
    expect(segmentLoaderSource).toContain('pairings.studio_rider_id = $3');
    expect(segmentLoaderSource.match(/\[clubId, sessionId, studioRiderId\]/g)).toHaveLength(2);
  });

  it('attaches exact private history after a Watch signal freezes without making the stale BPM live', async () => {
    const base = 80_000_000;
    const suffix = `${Date.now()}-${Math.random()}`;
    const profileKey = `user:frozen-history-${suffix}`;
    const otherProfileKey = `user:frozen-history-other-${suffix}`;
    const enrollmentId = `frozen-history-enrollment-${suffix}`;
    const pairingId = `frozen-history-pairing-${suffix}`;
    const streamId = `frozen-history-stream-${suffix}`;
    const tokenHash = `frozen-history-token-${suffix}`;
    const enrollment = await persistence.createOrRefreshHeartRateWatchEnrollment({
      id: enrollmentId,
      ownerProfileKey: profileKey,
      requestId: `frozen-history-enroll-request-${suffix}`,
      installIdHash: `frozen-history-install-${suffix}`,
      scope: 'personal',
      clubId: null,
      studioRiderId: null,
      liveStudioConsent: false,
      sessionStudioConsent: false,
      now: base,
    });
    expect(enrollment.status).toBe('created');
    const connection = await persistence.createHeartRateWatchConnection({
      id: `frozen-history-connection-${suffix}`,
      enrollmentId,
      ownerProfileKey: profileKey,
      requestId: `frozen-history-connect-request-${suffix}`,
      installIdHash: `frozen-history-install-${suffix}`,
      pairingId,
      relaySessionId: `watch-connect:frozen-history-${suffix}`,
      riderId: `account:frozen-history-${suffix}`,
      pairCodeHash: `frozen-history-code-${suffix}`,
      ingestTokenHash: tokenHash,
      connectedUntil: base + persistence.heartRateWatchConnectDurationMs,
      now: base,
    });
    expect(connection.status).toBe('created');
    expect(await persistence.createHeartRateStream(
      pairingId,
      tokenHash,
      streamId,
      base,
      base,
    )).toMatchObject({ id: streamId, relayScope: 'account-block' });
    expect(await persistence.insertHeartRateSamples(streamId, tokenHash, [{
      sequence: 0,
      recordedAt: base + 1_000,
      activeElapsedMs: 1_000,
      bpm: 151,
    }], base + 1_000)).toEqual([0]);

    const frozenAt = base + 40_000;
    await expect(persistence.loadLatestHeartRateLiveReading(
      profileKey,
      frozenAt - 10_000,
      frozenAt,
    )).resolves.toBeNull();
    const attached = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: profileKey,
      trainingSessionId: `get-pulled:frozen-${suffix}`,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: base + 500,
      endedAt: base + 2_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: frozenAt,
    });
    expect(attached).toMatchObject({
      status: 'created',
      segment: {
        ownerProfileKey: profileKey,
        relayScope: 'account-block',
        summary: {
          sampleCount: 1,
          minimumBpm: 151,
          averageBpm: 151,
          peakBpm: 151,
        },
      },
    });

    await expect(persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: otherProfileKey,
      trainingSessionId: `get-pulled:frozen-${suffix}`,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: base + 500,
      endedAt: base + 2_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: frozenAt,
    })).resolves.toEqual({ status: 'no-block', segment: null });
    await expect(persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: profileKey,
      trainingSessionId: `get-pulled:before-stream-${suffix}`,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: base - 2_000,
      endedAt: base - 1_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: frozenAt,
    })).resolves.toEqual({ status: 'no-block', segment: null });

    const zeroSample = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: profileKey,
      trainingSessionId: `get-pulled:no-sample-${suffix}`,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: base + 3_000,
      endedAt: base + 4_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: frozenAt,
    });
    expect(zeroSample).toMatchObject({
      status: 'created',
      segment: {
        // Wall time alone cannot close a continuous Watch stream that can still
        // deliver a delayed sample for this exact result window.
        finalizedAt: null,
        summary: {
          sampleCount: 0,
          minimumBpm: null,
          averageBpm: null,
          peakBpm: null,
        },
      },
    });
  });

  it('selects exact-window reconnect evidence and safely repairs a zero-sample segment', async () => {
    const createReconnectPair = async (
      label: string,
      base: number,
      afterOldStop: ((context: any) => Promise<any>) | null = null,
    ) => {
      const suffix = `${label}-${Date.now()}-${Math.random()}`;
      const profileKey = `user:history-reconnect-${suffix}`;
      const enrollmentId = `history-reconnect-enrollment-${suffix}`;
      const installIdHash = `history-reconnect-install-${suffix}`;
      expect((await persistence.createOrRefreshHeartRateWatchEnrollment({
        id: enrollmentId,
        ownerProfileKey: profileKey,
        requestId: `history-reconnect-enroll-${suffix}`,
        installIdHash,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        liveStudioConsent: false,
        sessionStudioConsent: false,
        now: base,
      })).status).toBe('created');

      const connect = async (generation: string, connectedAt: number) => {
        const connectionId = `history-reconnect-connection-${generation}-${suffix}`;
        const pairingId = `history-reconnect-pairing-${generation}-${suffix}`;
        const streamId = `history-reconnect-stream-${generation}-${suffix}`;
        const tokenHash = `history-reconnect-token-${generation}-${suffix}`;
        const connectedUntil = connectedAt + persistence.heartRateWatchConnectDurationMs;
        const connection = await persistence.createHeartRateWatchConnection({
          id: connectionId,
          enrollmentId,
          ownerProfileKey: profileKey,
          requestId: `history-reconnect-connect-${generation}-${suffix}`,
          installIdHash,
          pairingId,
          relaySessionId: `watch-connect:${connectionId}`,
          riderId: `account:${suffix}`,
          pairCodeHash: `history-reconnect-code-${generation}-${suffix}`,
          ingestTokenHash: tokenHash,
          connectedUntil,
          now: connectedAt,
        });
        expect(connection.status).toBe('created');
        expect(await persistence.createHeartRateStream(
          pairingId,
          tokenHash,
          streamId,
          connectedAt,
          connectedAt,
        )).toMatchObject({ id: streamId, relayScope: 'account-block' });
        return { connectionId, pairingId, streamId, tokenHash, connectedUntil };
      };

      const old = await connect('old', base);
      expect(await persistence.stopHeartRateWatchConnection(
        profileKey,
        old.connectionId,
        base + 5_000,
      )).toMatchObject({ id: old.connectionId, stoppedAt: base + 5_000 });
      const checkpoint = afterOldStop ? await afterOldStop({ profileKey, old }) : null;
      const recent = await connect('new', base + 5_001);
      return { profileKey, old, recent, checkpoint };
    };

    const rankedBase = 120_000_000;
    const ranked = await createReconnectPair('ranked', rankedBase);
    expect(await persistence.insertHeartRateSamples(ranked.old.streamId, ranked.old.tokenHash, [{
      sequence: 0,
      recordedAt: rankedBase + 3_000,
      activeElapsedMs: 3_000,
      bpm: 148,
    }], rankedBase + 6_000)).toEqual([0]);
    // More recent reconnect activity during a paused clock (plus one sample
    // outside the wall window) must not shadow the older stream's one admitted
    // active-clock sample.
    expect(await persistence.insertHeartRateSamples(ranked.recent.streamId, ranked.recent.tokenHash, [{
      sequence: 0,
      recordedAt: rankedBase + 6_000,
      activeElapsedMs: 1_000,
      bpm: 201,
    }, {
      sequence: 1,
      recordedAt: rankedBase + 7_000,
      activeElapsedMs: 2_000,
      bpm: 202,
    }, {
      sequence: 2,
      recordedAt: rankedBase + 10_001,
      activeElapsedMs: 5_001,
      bpm: 203,
    }], rankedBase + 10_002)).toEqual([0, 1, 2]);
    const rankedActiveClockSegments = [{
      startedAt: rankedBase + 1_000,
      endedAt: rankedBase + 4_000,
      activeElapsedAtStartMs: 0,
    }, {
      startedAt: rankedBase + 8_000,
      endedAt: rankedBase + 10_000,
      activeElapsedAtStartMs: 3_000,
    }];
    const rankedSessionId = `get-pulled:history-ranked-${Date.now()}`;
    const rankedSegment = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: ranked.profileKey,
      trainingSessionId: rankedSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: rankedBase + 1_000,
      endedAt: rankedBase + 10_000,
      zoneWindows: [],
      activeClockSegments: rankedActiveClockSegments,
      now: rankedBase + 30_000,
    });
    expect(rankedSegment).toMatchObject({
      status: 'created',
      segment: {
        streamId: ranked.old.streamId,
        pairingId: ranked.old.pairingId,
        finalizedAt: null,
        summary: {
          sampleCount: 1,
          minimumBpm: 148,
          averageBpm: 148,
          peakBpm: 148,
        },
      },
    });
    await expect(persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: `user:wrong-history-owner-${Date.now()}`,
      trainingSessionId: rankedSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: rankedBase + 1_000,
      endedAt: rankedBase + 10_000,
      zoneWindows: [],
      activeClockSegments: rankedActiveClockSegments,
      now: rankedBase + 30_000,
    })).resolves.toEqual({ status: 'no-block', segment: null });

    const tieBase = 130_000_000;
    const tieSessionId = `get-pulled:history-tie-${Date.now()}`;
    const tieOptions = {
      trainingSessionId: tieSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: tieBase + 1_000,
      endedAt: tieBase + 10_000,
      zoneWindows: [],
      activeClockSegments: [],
    } as const;
    const tie = await createReconnectPair('tie', tieBase, async ({ profileKey, old }) => (
      persistence.createHeartRateTrainingSegmentForAccountSession({
        ...tieOptions,
        athleteProfileKey: profileKey,
        // Model an old wall-clock-finalized zero row from the prior release.
        // The explicit clock is then moved back into the authorized drain below
        // to prove equal-zero reconnect selection prefers and reopens this row.
        now: tieBase + 5_000 + persistence.heartRateWatchConnectDrainMs + 1,
      }).then((segment) => ({ segment, old }))
    ));
    expect(tie.checkpoint.segment).toMatchObject({
      status: 'created',
      segment: {
        streamId: tie.old.streamId,
        finalizedAt: tieBase + 5_000 + persistence.heartRateWatchConnectDrainMs + 1,
        summary: { sampleCount: 0 },
      },
    });
    const reopenedTie = await persistence.createHeartRateTrainingSegmentForAccountSession({
      ...tieOptions,
      athleteProfileKey: tie.profileKey,
      now: tieBase + 30_000,
    });
    expect(reopenedTie).toMatchObject({
      status: 'updated',
      segment: {
        id: tie.checkpoint.segment.segment.id,
        streamId: tie.old.streamId,
        finalizedAt: null,
        summary: { sampleCount: 0 },
      },
    });
    expect(await persistence.insertHeartRateSamples(tie.old.streamId, tie.old.tokenHash, [{
      sequence: 0,
      recordedAt: tieBase + 4_000,
      activeElapsedMs: 4_000,
      bpm: 153,
    }], tieBase + 30_001)).toEqual([0]);
    const improvedTie = await persistence.createHeartRateTrainingSegmentForAccountSession({
      ...tieOptions,
      athleteProfileKey: tie.profileKey,
      now: tieBase + 30_002,
    });
    expect(improvedTie).toMatchObject({
      status: 'updated',
      segment: {
        id: tie.checkpoint.segment.segment.id,
        streamId: tie.old.streamId,
        finalizedAt: null,
        summary: { sampleCount: 1, averageBpm: 153 },
      },
    });

    const repairBase = Date.now();
    const repair = await createReconnectPair('repair', repairBase);
    const repairSessionId = `get-pulled:history-repair-${Date.now()}`;
    const zero = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: repair.profileKey,
      trainingSessionId: repairSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: repairBase + 1_000,
      endedAt: repairBase + 10_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: repairBase + 30_000,
    });
    expect(zero).toMatchObject({
      status: 'created',
      segment: {
        streamId: repair.recent.streamId,
        finalizedAt: null,
        summary: { sampleCount: 0 },
      },
    });
    const stableSegmentId = zero.segment!.id;
    expect(await persistence.insertHeartRateSamples(repair.old.streamId, repair.old.tokenHash, [{
      sequence: 0,
      // This delayed upload was recorded before the old connection stopped and
      // improves the exact result window without weakening the stop boundary.
      recordedAt: repairBase + 4_000,
      activeElapsedMs: 4_000,
      bpm: 155,
    }], repairBase + 30_001)).toEqual([0]);
    expect(await persistence.finalizeHeartRateStream(
      repair.old.streamId,
      repair.old.tokenHash,
      {
        endedAt: repairBase + 5_000,
        activeDurationMs: 5_000,
        summary: {},
        zoneSummaries: [],
        finalizedAt: repairBase + 30_001,
      },
    )).toMatchObject({ id: repair.old.streamId, finalizedAt: repairBase + 30_001 });
    const repaired = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: repair.profileKey,
      trainingSessionId: repairSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: repairBase + 1_000,
      endedAt: repairBase + 10_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: repairBase + 30_002,
    });
    expect(repaired).toMatchObject({
      status: 'updated',
      segment: {
        id: stableSegmentId,
        streamId: repair.old.streamId,
        pairingId: repair.old.pairingId,
        // The newer overlapping reconnect is still ingest-open, so the best
        // current summary remains retryable until every candidate is settled.
        finalizedAt: null,
        summary: {
          sampleCount: 1,
          minimumBpm: 155,
          averageBpm: 155,
          peakBpm: 155,
        },
      },
    });
    const loadedWhileReconnectOpen = await persistence.loadHeartRateTrainingSegments(
      repair.profileKey,
      repairSessionId,
    );
    expect(loadedWhileReconnectOpen).toEqual([
      expect.objectContaining({
        id: stableSegmentId,
        streamId: repair.old.streamId,
        finalizedAt: null,
        summary: expect.objectContaining({ sampleCount: 1, averageBpm: 155 }),
      }),
    ]);
    const repairRelayDeadline = repair.recent.connectedUntil
      + persistence.heartRateWatchConnectDrainMs;
    const settledRepair = await persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: repair.profileKey,
      trainingSessionId: repairSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: repairBase + 1_000,
      endedAt: repairBase + 10_000,
      zoneWindows: [],
      activeClockSegments: [],
      now: repairRelayDeadline + 1,
    });
    expect(settledRepair).toMatchObject({
      status: 'updated',
      segment: {
        id: stableSegmentId,
        streamId: repair.old.streamId,
        finalizedAt: repairRelayDeadline + 1,
        summary: { sampleCount: 1, averageBpm: 155 },
      },
    });
    await expect(persistence.createHeartRateTrainingSegmentForAccountSession({
      athleteProfileKey: repair.profileKey,
      trainingSessionId: repairSessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: repairBase + 1_000,
      endedAt: repairBase + 10_000,
      zoneWindows: [],
      activeClockSegments: [{
        startedAt: repairBase + 1_000,
        endedAt: repairBase + 10_000,
        activeElapsedAtStartMs: 0,
      }],
      now: repairBase + 30_003,
    })).resolves.toEqual({ status: 'conflict', segment: null });

    const expirySessionId = `get-pulled:history-expiry-${Date.now()}`;
    const expiryOptions = {
      athleteProfileKey: repair.profileKey,
      trainingSessionId: expirySessionId,
      activityType: 'get-pulled',
      playerId: 1,
      startedAt: repairBase + 11_000,
      endedAt: repairBase + 12_000,
      zoneWindows: [],
      activeClockSegments: [],
    } as const;
    const beforeExpiry = await persistence.createHeartRateTrainingSegmentForAccountSession({
      ...expiryOptions,
      now: repairBase + 30_004,
    });
    expect(beforeExpiry).toMatchObject({
      status: 'created',
      segment: { streamId: repair.recent.streamId, finalizedAt: null, summary: { sampleCount: 0 } },
    });
    const relayDeadline = repair.recent.connectedUntil + persistence.heartRateWatchConnectDrainMs;
    const afterExpiry = await persistence.createHeartRateTrainingSegmentForAccountSession({
      ...expiryOptions,
      now: relayDeadline + 1,
    });
    expect(afterExpiry).toMatchObject({
      status: 'updated',
      segment: {
        id: beforeExpiry.segment!.id,
        streamId: repair.recent.streamId,
        finalizedAt: relayDeadline + 1,
        summary: { sampleCount: 0 },
      },
    });
    await expect(persistence.createHeartRateTrainingSegmentForAccountSession({
      ...expiryOptions,
      trainingSessionId: `get-pulled:post-expiry-${Date.now()}`,
      startedAt: relayDeadline + 1,
      endedAt: relayDeadline + 2,
      now: relayDeadline + 3,
    })).resolves.toEqual({ status: 'no-block', segment: null });
  });

  it('keeps an old zero-sample result syncing until a late exact end sample is saved', async () => {
    const athlete = await register(
      `watch-connect-late-result-${Date.now()}@tracklab.test`,
      'Watch Late Result',
      '198.51.100.242',
    );
    const trustedInstall = installId('c');
    const enrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('late-result-enroll'),
        installId: trustedInstall,
        scope: 'personal',
      }),
    }, athlete.cookie);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = await enrollmentResponse.json() as any;
    const connectionResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('late-result-connect'),
        enrollmentId: enrollment.enrollment.id,
        installId: trustedInstall,
      }),
    }, athlete.cookie);
    expect(connectionResponse.status).toBe(201);
    const connection = await connectionResponse.json() as any;
    const endedAt = Date.now() - 20_000;
    const startedAt = endedAt - 6_000;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: startedAt - 1 }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;
    const trainingSessionId = `watch-connect-late-result-${Date.now()}`;
    const savedResponse = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: trainingSessionId,
          activityType: 'get-pulled',
          title: 'Late Watch result',
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          distanceMeters: 10,
          source: 'live',
          createdAt: startedAt,
          details: {},
        },
      }),
    }, athlete.cookie);
    expect(savedResponse.status).toBe(201);
    expect((await savedResponse.json() as any).heartRate).toMatchObject({
      status: 'created',
      segment: { finalizedAt: null, summary: { sampleCount: 0 } },
    });
    const pendingResponse = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(pendingResponse.status).toBe(200);
    expect(await pendingResponse.json()).toMatchObject({
      attachment: { status: 'syncing' },
      segments: [{ finalizedAt: null, summary: { sampleCount: 0 } }],
    });

    const sampleResponse = await api(
      `/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 0,
            recordedAt: endedAt,
            activeElapsedMs: endedAt - startedAt,
            bpm: 157,
          }],
        }),
      },
    );
    expect(sampleResponse.status).toBe(200);
    expect(await sampleResponse.json()).toEqual({ accepted: 1, duplicates: 0 });
    const savedHistoryResponse = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(savedHistoryResponse.status).toBe(200);
    expect(await savedHistoryResponse.json()).toMatchObject({
      attachment: { status: 'saved' },
      segments: [{
        streamId: stream.id,
        summary: {
          sampleCount: 1,
          minimumBpm: 157,
          averageBpm: 157,
          peakBpm: 157,
        },
      }],
    });
  });

  it('keeps PostgreSQL history association independent from stream freshness', () => {
    const source = readFileSync(new URL('../../cloud/persistence.mjs', import.meta.url), 'utf8');
    const associationSource = source.slice(
      source.indexOf('async function upsertHeartRateTrainingSegmentWithClient'),
      source.indexOf('async function createHeartRateTrainingSegmentForBlockWithClient'),
    );

    const selectionSource = associationSource.slice(0, associationSource.indexOf('const streamRow'));
    expect(associationSource).not.toContain('streams.updated_at >=');
    expect(selectionSource.match(/FROM \$\{schema\}\.heart_rate_samples AS ranked_samples/g))
      .toHaveLength(2);
    expect(selectionSource.match(/ranked_samples\.recorded_at >=/g)).toHaveLength(4);
    expect(selectionSource.match(/ranked_samples\.recorded_at <=/g)).toHaveLength(2);
    expect(selectionSource).toContain(
      '[athleteProfileKey, startedAt, endedAt, json(activeClockSegments), trainingSessionId]',
    );
    expect(selectionSource).toMatch(
      /athleteProfileKey,\s+clubId,\s+studioRiderId,\s+startedAt,\s+endedAt,\s+json\(activeClockSegments\),\s+trainingSessionId/,
    );
    expect(selectionSource).not.toContain('[athleteProfileKey, startedAt, endedAt, now]');
    expect(selectionSource).not.toContain('[athleteProfileKey, clubId, studioRiderId, startedAt, endedAt, now]');
    expect(selectionSource.match(/jsonb_array_elements\(\$[46]::jsonb\)/g)).toHaveLength(2);
    expect(selectionSource.match(/existing_segment\.training_session_id = \$[57]/g)).toHaveLength(2);
    expect(associationSource.match(/streams\.owner_profile_key = \$1/g)).toHaveLength(2);
    expect(associationSource.match(/streams\.started_at <=/g)).toHaveLength(2);
    expect(associationSource).toContain('SET stream_id = EXCLUDED.stream_id');
    expect(associationSource).toContain("jsonb_typeof(EXCLUDED.summary -> 'sampleCount') = 'number'");
    expect(associationSource).toContain('heart_rate_training_segments.active_clock_segments = EXCLUDED.active_clock_segments');
    expect(associationSource).not.toContain('endedAt + 15_000');

    const memorySelectionSource = source.slice(
      source.indexOf('function eligibleMemoryStudioBlockStream'),
      source.indexOf('function memoryHeartRateAccountBlockPairingAvailable'),
    );
    expect(memorySelectionSource.match(/compareMemoryHeartRateStreamsForTrainingWindow/g))
      .toHaveLength(2);
    expect(memorySelectionSource.match(/relayExpiresAt \?\? 0\) > startedAt/g))
      .toHaveLength(2);
    const settlementSource = source.slice(
      source.indexOf('export async function refreshHeartRateTrainingSegmentsForStream'),
      source.indexOf('async function linkHeartRateStreamsToTrainingSession'),
    );
    expect(settlementSource).not.toContain("interval '15 seconds'");
    expect(settlementSource.match(/openHeartRateTrainingSegmentCandidateSql/g)).toHaveLength(4);
    expect(settlementSource.match(/candidate_closing_samples\.recorded_at >= segments\.ended_at/g))
      .toHaveLength(1);
    expect(settlementSource.match(/AND NOT EXISTS \(\$\{openHeartRateTrainingSegmentCandidateSql\}\)/g))
      .toHaveLength(2);
  });

  it('admits same-account multi-device Watch polling, coalesces status loads, and caps pre-auth work', async () => {
    const metricValue = async (name: string, labels = '') => {
      const response = await api('/api/metrics', {
        headers: { 'X-TrackLab-Metrics-Token': metricsToken },
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedLabels = labels.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return Number(body.match(new RegExp(`${escapedName}${escapedLabels}\\s+(\\d+)`))?.[1] ?? 0);
    };

    const floodAccount = await register(
      'watch-connect-status-flood@tracklab.test',
      'Watch Status Flood',
      '198.51.100.238',
    );
    const statusLoadsBefore = await metricValue('tracklab_heart_rate_watch_status_loads_total');
    const validResponses = await Promise.all(
      ['iPhone', 'iPad', 'Web'].flatMap((surface) => (
        Array.from({ length: 20 }, () => api('/api/heart-rate/watch-connect', {
          headers: {
            'User-Agent': `TrackLab-${surface}`,
            'X-Forwarded-For': '198.51.100.239',
          },
        }, floodAccount.cookie))
      )),
    );
    const validOverflow = await api('/api/heart-rate/watch-connect', {
      headers: {
        'User-Agent': 'TrackLab-iPhone',
        'X-Forwarded-For': '198.51.100.239',
      },
    }, floodAccount.cookie);

    expect(validResponses).toHaveLength(60);
    expect(validResponses.every((response) => response.status === 200)).toBe(true);
    expect(validOverflow.status).toBe(429);
    expect(validOverflow.headers.get('ratelimit-limit')).toBe('60');
    // One load represents the two bounded persistence reads (enrollments and
    // connections); the other admitted requests share its in-flight promise.
    expect(await metricValue('tracklab_heart_rate_watch_status_loads_total'))
      .toBe(statusLoadsBefore + 1);

    const invalidCookie = 'tracklab_session=watch-status-overload-regression-token';
    const lookupsBefore = await metricValue(
      'tracklab_auth_session_lookups_total',
      '{backend="memory"}',
    );
    const responses: Response[] = [];
    for (let index = 0; index < 61; index += 1) {
      responses.push(await api('/api/heart-rate/watch-connect', {
        headers: { 'X-Forwarded-For': '198.51.100.240' },
      }, invalidCookie));
    }

    expect(responses.slice(0, 60).every((response) => response.status === 401)).toBe(true);
    expect(responses[60].status).toBe(429);
    expect(responses[60].headers.get('ratelimit-limit')).toBe('60');
    expect(responses[60].headers.get('retry-after')).toMatch(/^\d+$/);
    // Malformed session tokens are rejected before persistence; the anonymous
    // per-IP admission budget still caps the flood at 60 requests.
    expect(await metricValue('tracklab_auth_session_lookups_total', '{backend="memory"}'))
      .toBe(lookupsBefore);
  });
});
