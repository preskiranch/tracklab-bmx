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
      // The isolated memory server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Club Tablet Recovery Alert test server did not become healthy.\n${serverOutput}`);
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
      TRACKLAB_ADMIN_EMAILS: 'club-tablet-recovery-owner@tracklab.test',
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

describe('claimed Club Tablet recovery alerts', () => {
  it('writes each finish to only the current claimed athlete and rejects stale or unclaimed tablet sessions', async () => {
    const ownerEmail = 'club-tablet-recovery-owner@tracklab.test';
    const owner = await register(ownerEmail, 'Recovery Test Club');
    const athleteA = await register('club-tablet-recovery-a@tracklab.test', 'Athlete A');
    const athleteB = await register('club-tablet-recovery-b@tracklab.test', 'Athlete B');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const riderA = `recovery-athlete-a-${suffix}`;
    const riderB = `recovery-athlete-b-${suffix}`;
    const riderUnclaimed = `recovery-unclaimed-${suffix}`;
    const rosterAt = Date.now();

    const roster = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: riderA, name: 'Athlete A', createdAt: rosterAt, updatedAt: rosterAt },
          { id: riderB, name: 'Athlete B', createdAt: rosterAt, updatedAt: rosterAt },
          { id: riderUnclaimed, name: 'Unclaimed Athlete', createdAt: rosterAt, updatedAt: rosterAt },
        ],
      }),
    }, owner.cookie);
    expect(roster.status).toBe(200);

    for (const [riderId, athlete, fullName] of [
      [riderA, athleteA, 'Athlete A'],
      [riderB, athleteB, 'Athlete B'],
    ] as const) {
      const inviteResponse = await api('/api/club-connect/invites', {
        method: 'POST', body: JSON.stringify({ studioRiderId: riderId }),
      }, owner.cookie);
      expect(inviteResponse.status).toBe(201);
      const invite = await inviteResponse.json() as any;
      const claimResponse = await api('/api/club-connect/claim', {
        method: 'POST', body: JSON.stringify({ token: invite.token, fullName }),
      }, athlete.cookie);
      expect(claimResponse.status).toBe(200);
    }

    for (const [athlete, timerSeconds] of [[athleteA, 120], [athleteB, 300]] as const) {
      const saved = await api('/api/recovery-alert/preferences', {
        method: 'PATCH',
        body: JSON.stringify({
          mode: 'timer', timerSeconds, targetBpm: 120, minimumSeconds: 60, maximumSeconds: 600,
        }),
      }, athlete.cookie);
      expect(saved.status).toBe(200);
    }

    // Device enrollment rotates the owner cookie, so restore a clean owner
    // browser session before checking that the owner never receives an alert.
    const deviceResponse = await api('/api/club-tablet/devices', {
      method: 'POST', body: JSON.stringify({ name: 'Recovery Tablet' }),
    }, owner.cookie);
    expect(deviceResponse.status).toBe(201);
    const device = await deviceResponse.json() as any;
    const ownerCookie = await login(ownerEmail);

    const startTabletSession = async (studioRiderId: string) => {
      const response = await api('/api/club-tablet/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${device.deviceToken}` },
        body: JSON.stringify({ studioRiderId, bikeDeviceId: 'Wattbike701' }),
      });
      expect(response.status).toBe(201);
      return await response.json() as any;
    };
    const finish = (label: string, finishedAt = Date.now()) => ({
      requestId: requestId(label),
      activityType: 'bmx-race',
      sessionId: `club-race-${label}`,
      repetitionId: `club-race-${label}-player-1`,
      finishedAt,
      effortSummary: { finishTimeMs: 12_000, peakPowerWatts: 900 },
    });

    const sessionA = await startTabletSession(riderA);
    const headersA = { 'X-TrackLab-Club-Tablet-Session': sessionA.sessionToken };
    const firstFinish = finish(`a-${suffix}`);
    const firstResponse = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST', headers: headersA, body: JSON.stringify(firstFinish),
    });
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as any;
    expect(first).toEqual({
      accountId: expect.stringMatching(/^recacct_[a-f0-9]{32}$/),
      replayed: false,
    });
    expect(JSON.stringify(first)).not.toContain(athleteA.user.id);
    expect(JSON.stringify(first)).not.toContain(owner.user.id);
    expect(JSON.stringify(first)).not.toMatch(/episode|targetBpm|sessionId|repetitionId/iu);

    const replay = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST', headers: headersA, body: JSON.stringify(firstFinish),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ accountId: first.accountId, replayed: true });

    const forgedTarget = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...finish(`forged-${suffix}`), studioRiderId: riderB }),
    });
    expect(forgedTarget.status).toBe(400);

    const athleteAActive = await api('/api/recovery-alert/episodes/active', {}, athleteA.cookie);
    expect(athleteAActive.status).toBe(200);
    const athleteAActivePayload = await athleteAActive.json() as any;
    expect(athleteAActivePayload).toMatchObject({
      accountId: first.accountId,
      episode: {
        mode: 'timer',
        repetitionId: firstFinish.repetitionId,
        plannedReadyAt: firstFinish.finishedAt + 120_000,
      },
    });
    for (const cookie of [athleteB.cookie, ownerCookie]) {
      const response = await api('/api/recovery-alert/episodes/active', {}, cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ episode: null });
    }

    // Ending Athlete A's interactive session must not drop an already
    // finished effort. The device-bound result credential is scoped to A and
    // remains valid after the short-lived tablet bearer has been revoked.
    const endedA = await api('/api/club-tablet/sessions', {
      method: 'DELETE', headers: headersA,
    });
    expect(endedA.status).toBe(200);
    const durableFinish = finish(`a-after-end-${suffix}`);
    const durableHeadersA = {
      Authorization: `Bearer ${device.deviceToken}`,
      'X-TrackLab-Club-Tablet-Session': sessionA.sessionToken,
      'X-TrackLab-Club-Tablet-Result-Token': sessionA.resultUploadToken,
    };
    const durableResponse = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST', headers: durableHeadersA, body: JSON.stringify(durableFinish),
    });
    expect(durableResponse.status).toBe(201);
    expect(await durableResponse.json()).toEqual({
      accountId: first.accountId,
      replayed: false,
    });
    const athleteAAfterEnd = await api('/api/recovery-alert/episodes/active', {}, athleteA.cookie);
    const athleteAAfterEndPayload = await athleteAAfterEnd.json() as any;
    expect(athleteAAfterEndPayload).toMatchObject({
      accountId: first.accountId,
      episode: {
        repetitionId: durableFinish.repetitionId,
        plannedReadyAt: durableFinish.finishedAt + 120_000,
      },
    });

    // A new session on the same iPad invalidates the previous bearer. The
    // stale Athlete A token must not create/replace Athlete B's recovery.
    const sessionB = await startTabletSession(riderB);
    const stale = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST', headers: headersA, body: JSON.stringify(finish(`stale-${suffix}`)),
    });
    expect(stale.status).toBe(401);

    // Even after Athlete B is selected on the same iPad, an A result token
    // cannot be combined with B's bearer or redirected to B.
    const mismatchedResultToken = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${device.deviceToken}`,
        'X-TrackLab-Club-Tablet-Session': sessionB.sessionToken,
        'X-TrackLab-Club-Tablet-Result-Token': sessionA.resultUploadToken,
      },
      body: JSON.stringify(finish(`mismatched-${suffix}`)),
    });
    expect(mismatchedResultToken.status).toBe(401);

    const headersB = { 'X-TrackLab-Club-Tablet-Session': sessionB.sessionToken };
    const secondFinish = finish(`b-${suffix}`);
    const secondResponse = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST', headers: headersB, body: JSON.stringify(secondFinish),
    });
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as any;
    expect(second).toEqual({
      accountId: expect.stringMatching(/^recacct_[a-f0-9]{32}$/),
      replayed: false,
    });

    const athleteAAfterSwitch = await api('/api/recovery-alert/episodes/active', {}, athleteA.cookie);
    expect(await athleteAAfterSwitch.json()).toMatchObject({
      episode: { id: athleteAAfterEndPayload.episode.id },
    });
    const athleteBActive = await api('/api/recovery-alert/episodes/active', {}, athleteB.cookie);
    expect(await athleteBActive.json()).toMatchObject({
      accountId: second.accountId,
      episode: {
        mode: 'timer',
        repetitionId: secondFinish.repetitionId,
        plannedReadyAt: secondFinish.finishedAt + 300_000,
      },
    });

    const unclaimedSession = await startTabletSession(riderUnclaimed);
    const unclaimed = await api('/api/club-tablet/recovery-alert/episodes', {
      method: 'POST',
      headers: { 'X-TrackLab-Club-Tablet-Session': unclaimedSession.sessionToken },
      body: JSON.stringify(finish(`unclaimed-${suffix}`)),
    });
    expect(unclaimed.status).toBe(403);
  });
});
