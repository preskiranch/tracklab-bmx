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
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Expiry cloud test server did not become healthy.\n${serverOutput}`);
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
  return { cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0] };
}

async function waitUntil(timestamp: number) {
  while (Date.now() <= timestamp) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
      TRACKLAB_ADMIN_EMAILS: 'v22-expiry-owner@tracklab.test',
      TRACKLAB_TEST_GROUP_SPRINT_TTL_MS: '250',
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

describe('owner group expiry boundaries', () => {
  it('allows exact activated completion after lease expiry but denies recovery and activation', async () => {
    const owner = await register('v22-expiry-owner@tracklab.test', 'Expiry Club');
    const athlete = await register('v22-expiry-athlete@tracklab.test', 'Expiry Athlete');
    const stamp = Date.now();
    const studioRiderId = `v22-expiry-rider-${stamp}`;
    const roster = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Expiry Athlete',
          createdAt: stamp,
          updatedAt: stamp,
        }],
      }),
    }, owner.cookie);
    expect(roster.status).toBe(200);
    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, owner.cookie);
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as any;
    const claim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token, fullName: 'Expiry Athlete' }),
    }, athlete.cookie);
    expect(claim.status).toBe(200);
    const clubState = await api('/api/club-connect', {}, owner.cookie);
    const clubId = (await clubState.json() as any).ownedClub.id as string;

    let sequence = 0;
    const arm = async () => {
      sequence += 1;
      const now = Date.now();
      const binding = {
        requestId: `v22-expiry-request-${stamp}-${sequence}-secure`,
        clubId,
        sessionId: `v22-expiry-session-${stamp}-${sequence}`,
        activityType: 'straight-sprint',
        armedAt: now - 20,
        assignments: [{ studioRiderId, bikeDeviceId: 900 + sequence, playerId: 1 }],
      };
      const response = await api('/api/club-live/training-authorizations', {
        method: 'POST',
        body: JSON.stringify(binding),
      }, owner.cookie);
      expect(response.status).toBe(201);
      return { binding, credential: await response.json() as any };
    };

    const completable = await arm();
    const assignment = completable.credential.authorization.assignments[0];
    const startedAt = completable.binding.armedAt + 10;
    const activate = await api(
      `/api/club-live/training-authorizations/${completable.credential.authorization.id}/assignments/${assignment.id}/activate`,
      {
        method: 'POST',
        headers: {
          'X-TrackLab-Group-Completion-Token': completable.credential.completionToken,
        },
        body: JSON.stringify({ startedAt }),
      },
      owner.cookie,
    );
    expect(activate.status).toBe(200);
    await waitUntil(completable.credential.authorization.expiresAt + 5);
    const completion = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: {
        'X-TrackLab-Group-Completion-Token': completable.credential.completionToken,
      },
      body: JSON.stringify({
        authorizationId: completable.credential.authorization.id,
        session: {
          id: completable.binding.sessionId,
          activityType: 'straight-sprint',
          title: 'Offline exact completion',
          startedAt,
          endedAt: startedAt + 20,
          durationMs: 20,
          distanceMeters: 44.196,
          trackId: 'expiry-track',
          trackName: 'Expiry Track',
          details: {
            summaries: [{
              playerId: 1,
              rank: 1,
              finishTimeMs: 20,
              distanceMeters: 44.196,
              topSpeedKph: 50,
              averageSpeedKph: 40,
              topCadence: 200,
              averageCadence: 160,
              topWatts: 1_300,
              averageWatts: 800,
            }],
            zoneResults: [],
            reactionTimesByPlayer: { 1: 10 },
            sprintDistanceFeet: 145,
            sprintAirSetting: 3,
          },
        },
        riderWindows: [{
          assignmentId: assignment.id,
          status: 'finished',
          endedAt: startedAt + 20,
        }],
      }),
    }, owner.cookie);
    expect(completion.status, `${await completion.clone().text()}\n${serverOutput}`).toBe(201);

    const expired = await arm();
    const beforeStartDropout = await api('/api/club-live/assigned-training-sessions', {
      method: 'POST',
      headers: {
        'X-TrackLab-Group-Completion-Token': expired.credential.completionToken,
      },
      body: JSON.stringify({
        authorizationId: expired.credential.authorization.id,
        session: {
          id: expired.binding.sessionId,
          activityType: 'straight-sprint',
          title: 'Unstarted dropout must not save',
          startedAt: expired.binding.armedAt,
          endedAt: expired.binding.armedAt + 10,
          durationMs: 10,
          distanceMeters: 0,
          details: {
            summaries: [{
              playerId: 1,
              rank: 1,
              finishTimeMs: null,
              distanceMeters: 0,
              topSpeedKph: 0,
              averageSpeedKph: 0,
              topCadence: 0,
              averageCadence: 0,
              topWatts: 0,
              averageWatts: 0,
            }],
            zoneResults: [],
          },
        },
        riderWindows: [{
          assignmentId: expired.credential.authorization.assignments[0].id,
          status: 'dnf',
          endedAt: expired.binding.armedAt + 10,
        }],
      }),
    }, owner.cookie);
    expect(beforeStartDropout.status).toBe(400);
    await waitUntil(expired.credential.authorization.expiresAt + 5);
    const recover = await api(
      `/api/club-live/training-authorizations/${expired.credential.authorization.id}/recover`,
      { method: 'POST', body: JSON.stringify(expired.binding) },
      owner.cookie,
    );
    expect(recover.status).toBe(410);
    const expiredActivation = await api(
      `/api/club-live/training-authorizations/${expired.credential.authorization.id}/assignments/${expired.credential.authorization.assignments[0].id}/activate`,
      {
        method: 'POST',
        headers: {
          'X-TrackLab-Group-Completion-Token': expired.credential.completionToken,
        },
        body: JSON.stringify({ startedAt: expired.binding.armedAt + 10 }),
      },
      owner.cookie,
    );
    expect(expiredActivation.status).toBe(410);
  }, 20_000);
});
