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
      // The isolated memory server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Club Tablet Get Pulled test server did not become healthy.\n${serverOutput}`);
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
  return {
    cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0],
    user: (await response.json() as any).user,
  };
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
      TRACKLAB_ADMIN_EMAILS: 'club-tablet-pull-owner@tracklab.test',
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

describe('claimed Club Tablet Get Pulled result', () => {
  it('keeps full bike metrics in athlete and owner history and shares the consented Watch summary', async () => {
    const ownerEmail = 'club-tablet-pull-owner@tracklab.test';
    const owner = await register(ownerEmail, 'Get Pulled Test Club');
    const athlete = await register(
      'club-tablet-pull-athlete@tracklab.test',
      'Rasheen Test Athlete',
    );
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const studioRiderId = `get-pulled-rider-${suffix}`;
    const rosterAt = Date.now();

    const rosterResponse = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Rasheen Test Athlete',
          createdAt: rosterAt,
          updatedAt: rosterAt,
        }],
      }),
    }, owner.cookie);
    expect(rosterResponse.status).toBe(200);

    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, owner.cookie);
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as any;
    const claimResponse = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token, fullName: 'Rasheen Test Athlete' }),
    }, athlete.cookie);
    expect(claimResponse.status).toBe(200);

    const athleteClubResponse = await api('/api/club-connect', {}, athlete.cookie);
    expect(athleteClubResponse.status).toBe(200);
    const athleteClub = await athleteClubResponse.json() as any;
    const membership = athleteClub.memberships.find((candidate: any) => (
      candidate.studioRiderId === studioRiderId
    ));
    expect(membership).toMatchObject({ studioRiderId, riderName: 'Rasheen Test Athlete' });

    // Enrolling the browser as a shared tablet intentionally retires the
    // administrator cookie. Sign back in below for the separate owner view.
    const deviceResponse = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Get Pulled Test Tablet' }),
    }, owner.cookie);
    expect(deviceResponse.status).toBe(201);
    const device = await deviceResponse.json() as any;
    const ownerMonitorCookie = await login(ownerEmail);

    // The phone keeps one private Watch connection. Studio sharing is a
    // separate, exact claimed-athlete consent record; it must not require a
    // second Watch connection or bind the Watch to the Wattbike.
    const trustedInstallId = installId('f');
    const studioEnrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('get-pulled-studio'),
        installId: trustedInstallId,
        scope: 'studio',
        clubId: membership.clubId,
        liveStudioConsent: true,
        sessionStudioConsent: true,
      }),
    }, athlete.cookie);
    const studioEnrollmentBody = await studioEnrollmentResponse.json() as any;
    expect(studioEnrollmentResponse.status, JSON.stringify(studioEnrollmentBody)).toBe(201);
    const studioEnrollment = studioEnrollmentBody.enrollment;
    expect(studioEnrollment).toMatchObject({
      scope: 'studio',
      clubId: membership.clubId,
      studioRiderId,
      liveStudioConsent: true,
      sessionStudioConsent: true,
    });

    const personalEnrollmentResponse = await api('/api/heart-rate/watch-connect/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('get-pulled-personal'),
        installId: trustedInstallId,
        scope: 'personal',
      }),
    }, athlete.cookie);
    expect(personalEnrollmentResponse.status).toBe(201);
    const personalEnrollment = (await personalEnrollmentResponse.json() as any).enrollment;

    const connectionResponse = await api('/api/heart-rate/watch-connect/connections', {
      method: 'POST',
      body: JSON.stringify({
        requestId: requestId('get-pulled-connect'),
        enrollmentId: personalEnrollment.id,
        installId: trustedInstallId,
      }),
    }, athlete.cookie);
    expect(connectionResponse.status).toBe(201);
    const connection = await connectionResponse.json() as any;
    expect(connection.connection).toMatchObject({ scope: 'personal', state: 'connecting' });

    const timelineEnd = Date.now();
    const streamStartedAt = timelineEnd - 7_000;
    const trainingStartedAt = timelineEnd - 6_000;
    const trainingEndedAt = timelineEnd;
    const streamResponse = await api('/api/heart-rate/streams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
      body: JSON.stringify({ startedAt: streamStartedAt }),
    });
    expect(streamResponse.status).toBe(201);
    const stream = (await streamResponse.json() as any).stream;
    expect(stream).toMatchObject({ relayScope: 'account-block' });

    const sampleResponse = await api(
      `/api/heart-rate/streams/${encodeURIComponent(stream.id)}/samples`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${connection.credentials.ingestToken}` },
        body: JSON.stringify({
          samples: [{
            sequence: 0,
            recordedAt: trainingStartedAt + 1_000,
            activeElapsedMs: 2_000,
            bpm: 148,
          }, {
            sequence: 1,
            recordedAt: trainingEndedAt - 1_000,
            activeElapsedMs: 6_000,
            bpm: 164,
          }],
        }),
      },
    );
    expect(sampleResponse.status).toBe(200);
    expect(await sampleResponse.json()).toEqual({ accepted: 2, duplicates: 0 });

    const tabletSessionResponse = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${device.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'WattbikeTest701' }),
    });
    expect(tabletSessionResponse.status).toBe(201);
    const tabletSession = await tabletSessionResponse.json() as any;
    const tabletHeaders = {
      'X-TrackLab-Club-Tablet-Session': tabletSession.sessionToken,
    };

    const liveResponse = await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletHeaders,
    });
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({
      reading: { studioRiderId, bpm: 164 },
    });

    const trainingSessionId = `get-pulled:club-tablet-${suffix}`;
    const expectedRiderMetrics = {
      playerId: 1,
      riderId: studioRiderId,
      studioRiderId,
      name: 'Rasheen Test Athlete',
      riderName: 'Rasheen Test Athlete',
      distanceMeters: 35.36,
      averageWatts: 179,
      peakWatts: 229,
      averageCadence: 80,
      peakCadence: 105,
      averageSpeedKph: 21.08,
      peakSpeedKph: 29.4,
    };
    const trainingRequest = {
      localPlayerId: 1,
      session: {
        id: trainingSessionId,
        activityType: 'get-pulled',
        title: '6s Get Pulled · Air 7',
        startedAt: trainingStartedAt,
        endedAt: trainingEndedAt,
        durationMs: 6_000,
        distanceMeters: 35.36,
        trackId: 'preski-ranch-pull-lane',
        trackName: 'Preski Ranch Pull Lane',
        details: {
          durationSeconds: 6,
          airSetting: 7,
          riders: [{
            ...expectedRiderMetrics,
            riderId: 'forged-rider',
            studioRiderId: 'forged-rider',
            name: 'Forged Name',
            riderName: 'Forged Name',
          }],
        },
      },
    };
    const trainingResponse = await api('/api/club-tablet/training-sessions', {
      method: 'POST',
      headers: tabletHeaders,
      body: JSON.stringify(trainingRequest),
    });
    expect(trainingResponse.status).toBe(201);
    const saved = await trainingResponse.json() as any;
    expect(saved.session).toMatchObject({
      id: trainingSessionId,
      activityType: 'get-pulled',
      durationMs: 6_000,
      distanceMeters: 35.36,
      club: { id: membership.clubId, studioRiderId, role: 'athlete' },
      details: {
        durationSeconds: 6,
        airSetting: 7,
        recordKey: '6s-air-7',
        riders: [expectedRiderMetrics],
      },
    });
    expect(saved.heartRate).toMatchObject({
      status: 'created',
      segment: {
        trainingSessionId,
        studioRiderId,
        summary: {
          sampleCount: 2,
          minimumBpm: 148,
          peakBpm: 164,
        },
      },
    });
    expect(saved.heartRate.segment.summary.averageBpm).toBeGreaterThan(148);
    expect(saved.heartRate.segment.summary.averageBpm).toBeLessThan(164);

    const athleteUserDataResponse = await api('/api/user-data', {}, athlete.cookie);
    expect(athleteUserDataResponse.status).toBe(200);
    await expect(athleteUserDataResponse.json()).resolves.toMatchObject({
      accountProfile: {
        personalRecords: {
          getPulledMaxWatts: 229,
          getPulledMaxWattsSource: 'recorded',
        },
      },
    });

    const ownerUserDataResponse = await api('/api/user-data', {}, ownerMonitorCookie);
    expect(ownerUserDataResponse.status).toBe(200);
    await expect(ownerUserDataResponse.json()).resolves.toMatchObject({
      studioRiders: [expect.objectContaining({
        id: studioRiderId,
        personalRecords: expect.objectContaining({
          getPulledMaxWatts: 229,
          getPulledMaxWattsSource: 'recorded',
        }),
      })],
    });

    // A stale browser or photo/roster update that does not know about the
    // new field must not erase the durable max-watts record.
    const staleRosterPatch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Rasheen Test Athlete',
          createdAt: rosterAt,
          updatedAt: rosterAt + 1,
        }],
      }),
    }, ownerMonitorCookie);
    expect(staleRosterPatch.status).toBe(200);
    await expect(staleRosterPatch.json()).resolves.toMatchObject({
      studioRiders: [expect.objectContaining({
        id: studioRiderId,
        personalRecords: expect.objectContaining({ getPulledMaxWatts: 229 }),
      })],
    });

    const athleteHistoryResponse = await api('/api/training-sessions?from=0', {}, athlete.cookie);
    expect(athleteHistoryResponse.status).toBe(200);
    const athleteHistory = await athleteHistoryResponse.json() as any;
    const athleteResult = athleteHistory.sessions.find((candidate: any) => (
      candidate.id === trainingSessionId
    ));
    expect(athleteResult).toMatchObject({
      club: { id: membership.clubId, studioRiderId, role: 'athlete' },
      details: {
        durationSeconds: 6,
        airSetting: 7,
        riders: [expectedRiderMetrics],
      },
    });

    const athleteHeartRateResponse = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(athleteHeartRateResponse.status).toBe(200);
    expect(await athleteHeartRateResponse.json()).toMatchObject({
      // Watch Connect is continuous across repetitions. Until that source
      // advances beyond this result or stops, its exact result summary remains
      // readable while late in-window samples are still allowed to reconcile.
      attachment: { status: 'syncing' },
      segments: [{
        trainingSessionId,
        summary: { sampleCount: 2, minimumBpm: 148, peakBpm: 164 },
      }],
    });

    const ownerHistoryResponse = await api('/api/training-sessions?from=0', {}, ownerMonitorCookie);
    expect(ownerHistoryResponse.status).toBe(200);
    const ownerHistory = await ownerHistoryResponse.json() as any;
    const ownerResult = ownerHistory.sessions.find((candidate: any) => (
      candidate.id.endsWith(`:${trainingSessionId}`)
    ));
    expect(ownerResult).toMatchObject({
      club: { id: membership.clubId, studioRiderId, role: 'owner' },
      details: {
        durationSeconds: 6,
        airSetting: 7,
        riders: [expectedRiderMetrics],
      },
    });

    const ownerHeartRateResponse = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(trainingSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      ownerMonitorCookie,
    );
    expect(ownerHeartRateResponse.status).toBe(200);
    const ownerHeartRate = await ownerHeartRateResponse.json() as any;
    expect(ownerHeartRate).toMatchObject({
      segments: [{
        trainingSessionId,
        studioRiderId,
        summary: { sampleCount: 2, minimumBpm: 148, peakBpm: 164 },
      }],
    });
    expect(JSON.stringify(ownerHeartRate)).not.toMatch(
      /"(id|streamId|pairingId|relayScope)"|profileKey|account:/i,
    );

    const replayResponse = await api('/api/club-tablet/training-sessions', {
      method: 'POST',
      headers: tabletHeaders,
      body: JSON.stringify(trainingRequest),
    });
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({
      replayed: true,
      session: { id: trainingSessionId },
    });

    const athleteReplayHistory = await api('/api/training-sessions?from=0', {}, athlete.cookie);
    expect((await athleteReplayHistory.json() as any).sessions.filter((candidate: any) => (
      candidate.id === trainingSessionId
    ))).toHaveLength(1);
    const ownerReplayHistory = await api('/api/training-sessions?from=0', {}, ownerMonitorCookie);
    expect((await ownerReplayHistory.json() as any).sessions.filter((candidate: any) => (
      candidate.id.endsWith(`:${trainingSessionId}`)
    ))).toHaveLength(1);

    // Revoking only the studio-sharing grant must immediately remove both
    // shared-tablet live BPM and the owner's summary projection. The athlete's
    // private Watch result and both parties' non-health bike result remain.
    const revokeStudioSharing = await api(
      `/api/heart-rate/watch-connect/enrollments/${encodeURIComponent(studioEnrollment.id)}`,
      { method: 'DELETE' },
      athlete.cookie,
    );
    expect(revokeStudioSharing.status).toBe(200);
    expect(await revokeStudioSharing.json()).toMatchObject({
      enrollment: { id: studioEnrollment.id, state: 'revoked' },
    });
    const tabletLiveAfterRevocation = await api('/api/heart-rate/watch-connect/tablet-live', {
      headers: tabletHeaders,
    });
    expect(tabletLiveAfterRevocation.status).toBe(200);
    expect(await tabletLiveAfterRevocation.json()).toMatchObject({ reading: null });

    const ownerHeartRateAfterRevocation = await api(
      `/api/heart-rate/club-streams?clubId=${encodeURIComponent(membership.clubId)}&sessionId=${encodeURIComponent(trainingSessionId)}&studioRiderId=${encodeURIComponent(studioRiderId)}`,
      {},
      ownerMonitorCookie,
    );
    expect(ownerHeartRateAfterRevocation.status).toBe(200);
    expect(await ownerHeartRateAfterRevocation.json()).toMatchObject({ segments: [] });

    const athleteHeartRateAfterRevocation = await api(
      `/api/heart-rate/streams?sessionId=${encodeURIComponent(trainingSessionId)}`,
      {},
      athlete.cookie,
    );
    expect(athleteHeartRateAfterRevocation.status).toBe(200);
    expect(await athleteHeartRateAfterRevocation.json()).toMatchObject({
      segments: [{
        trainingSessionId,
        summary: { sampleCount: 2, minimumBpm: 148, peakBpm: 164 },
      }],
    });
    const ownerBikeHistoryAfterRevocation = await api(
      '/api/training-sessions?from=0',
      {},
      ownerMonitorCookie,
    );
    expect((await ownerBikeHistoryAfterRevocation.json() as any).sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: expect.stringContaining(trainingSessionId),
        details: expect.objectContaining({
          airSetting: 7,
          riders: [expect.objectContaining({ averageWatts: 179, peakWatts: 229 })],
        }),
      })]),
    );
  }, 40_000);
});
