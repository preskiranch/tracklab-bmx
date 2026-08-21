import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as persistence from '../../cloud/persistence.mjs';

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

async function register(email: string, name: string) {
  const response = await api('/api/auth/register', {
    method: 'POST',
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
          endedAt: reconnectStartedAt + 1_000,
          activeDurationMs: 1_000,
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
    const allModesStreamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${allModesConnection.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: allModesStartedAt }),
    });
    expect(allModesStreamResponse.status).toBe(201);
    const allModesStream = (await allModesStreamResponse.json() as any).stream;
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
      expect((await save.json() as any).heartRate.status).toBe('created');
    }
    const allModesSamples = await api(
      `/api/heart-rate/streams/${encodeURIComponent(allModesStream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${allModesConnection.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 0,
            recordedAt: allModesStartedAt,
            activeElapsedMs: 0,
            bpm: 146,
          }],
        }),
      },
    );
    expect(allModesSamples.status).toBe(200);
    for (let index = 0; index < allModeSessionIds.length; index += 1) {
      const history = await api(
        `/api/heart-rate/streams?sessionId=${encodeURIComponent(allModeSessionIds[index])}`,
        {},
        athlete.cookie,
      );
      expect(history.status).toBe(200);
      const historyBody = await history.json() as any;
      expect(historyBody.segments).toEqual([
        expect.objectContaining({
          activityType: activityTypes[index],
          relayScope: 'account-block',
          trainingSessionId: allModeSessionIds[index],
        }),
      ]);
    }

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
    const now = Date.now();

    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Studio Watch Athlete',
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
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}`,
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
    });
    expect(JSON.stringify(tabletAthlete.watchConnect)).not.toMatch(/profile|token|bpm|bike/i);

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

    const tabletRosterAfterDisconnect = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${tablet.deviceToken}` },
    });
    const disconnectedTabletAthlete = (await tabletRosterAfterDisconnect.json() as any).athletes
      .find((candidate: any) => candidate.studioRiderId === studioRiderId);
    expect(disconnectedTabletAthlete.watchConnect).toMatchObject({
      recognized: false,
      state: 'not-set-up',
      remainingMs: 0,
    });
    const summariesAfterDisconnect = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}`,
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
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(studioTrainingSessionId)}`,
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
    });

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
});
