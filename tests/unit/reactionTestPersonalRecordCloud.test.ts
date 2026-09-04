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
  throw new Error(`Reaction Test personal-record server did not become healthy.\n${serverOutput}`);
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

async function saveReaction(cookie: string, id: string, reactionTimeMs: number, valid = true) {
  const startedAt = Date.now() - 5_000;
  return api('/api/training-sessions', {
    method: 'POST',
    body: JSON.stringify({
      session: {
        id,
        activityType: 'bmx-race',
        title: valid ? 'Reaction Test · EXCELLENT' : 'Reaction Test · False start',
        startedAt,
        endedAt: startedAt + Math.ceil(reactionTimeMs),
        durationMs: reactionTimeMs,
        distanceMeters: 0,
        details: {
          reactionTest: {
            version: 1,
            reactionTimeMs,
            rating: valid ? 'excellent' : 'false-start',
            stage: valid ? 'red' : 'pre-start',
            valid,
            late: false,
            falseStart: !valid,
            cadenceDelayMs: 1_200,
            recordedAt: startedAt + Math.ceil(reactionTimeMs),
          },
        },
      },
    }),
  }, cookie);
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
      TRACKLAB_ADMIN_EMAILS: 'reaction-roster-owner@tracklab.test',
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

describe('Reaction Test personal-record cloud durability', () => {
  it('merges watts and reaction records independently and promotes only valid faster reactions', async () => {
    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `reaction-record-${Date.now()}@tracklab.test`,
        name: 'Reaction Record Rider',
        password: 'tracklab-test-password',
      }),
    });
    expect(registration.status).toBe(201);
    const cookie = (registration.headers.get('set-cookie') || '').split(';', 1)[0];

    const initial = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          personalRecords: {
            getPulledMaxWatts: 900,
            getPulledMaxWattsSource: 'manual',
            getPulledMaxWattsUpdatedAt: 100,
            reactionTestBestMs: 450.9874,
            reactionTestBestUpdatedAt: 100,
          },
          updatedAt: 100,
        },
      }),
    }, cookie);
    expect(initial.status).toBe(200);

    // These two disciplines have opposite "better" directions. One cloud
    // patch may improve watts while carrying a stale, slower reaction time.
    const mixedPatch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          personalRecords: {
            getPulledMaxWatts: 1_100,
            getPulledMaxWattsSource: 'recorded',
            getPulledMaxWattsUpdatedAt: 300,
            reactionTestBestMs: 700,
            reactionTestBestUpdatedAt: 300,
          },
          updatedAt: 300,
        },
      }),
    }, cookie);
    expect(mixedPatch.status).toBe(200);
    await expect(mixedPatch.json()).resolves.toMatchObject({
      accountProfile: {
        personalRecords: {
          getPulledMaxWatts: 1_100,
          getPulledMaxWattsSource: 'recorded',
          getPulledMaxWattsUpdatedAt: 300,
          reactionTestBestMs: 450.987,
          reactionTestBestUpdatedAt: 100,
        },
      },
    });

    const validResult = await saveReaction(
      cookie,
      `reaction-valid-${Date.now()}`,
      420.1234,
    );
    expect(validResult.status).toBe(201);

    const falseStart = await saveReaction(
      cookie,
      `reaction-false-start-${Date.now()}`,
      100,
      false,
    );
    expect(falseStart.status).toBe(201);

    const slowerResult = await saveReaction(
      cookie,
      `reaction-slower-${Date.now()}`,
      800,
    );
    expect(slowerResult.status).toBe(201);

    const stored = await api('/api/user-data', {}, cookie);
    expect(stored.status).toBe(200);
    await expect(stored.json()).resolves.toMatchObject({
      accountProfile: {
        personalRecords: {
          getPulledMaxWatts: 1_100,
          getPulledMaxWattsSource: 'recorded',
          reactionTestBestMs: 420.123,
        },
      },
    });

    // An older client that omits the new record fields must not erase them.
    const stalePatch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ accountProfile: { updatedAt: 400 } }),
    }, cookie);
    expect(stalePatch.status).toBe(200);
    await expect(stalePatch.json()).resolves.toMatchObject({
      accountProfile: {
        personalRecords: {
          getPulledMaxWatts: 1_100,
          reactionTestBestMs: 420.123,
        },
      },
    });
  });

  it('builds a claimed Club Tablet roster from the best field on either profile', async () => {
    const ownerRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'reaction-roster-owner@tracklab.test',
        name: 'Reaction Test Club',
        password: 'tracklab-test-password',
      }),
    });
    expect(ownerRegistration.status).toBe(201);
    const ownerCookie = (ownerRegistration.headers.get('set-cookie') || '').split(';', 1)[0];

    const athleteRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: `reaction-roster-athlete-${Date.now()}@tracklab.test`,
        name: 'Claimed Reaction Rider',
        password: 'tracklab-test-password',
      }),
    });
    expect(athleteRegistration.status).toBe(201);
    const athleteCookie = (athleteRegistration.headers.get('set-cookie') || '').split(';', 1)[0];
    const studioRiderId = `reaction-roster-${Date.now()}`;
    const now = Date.now();

    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: studioRiderId,
          name: 'Claimed Reaction Rider',
          personalRecords: {
            getPulledMaxWatts: 200,
            getPulledMaxWattsSource: 'manual',
            getPulledMaxWattsUpdatedAt: 10,
            reactionTestBestMs: 350,
            reactionTestBestUpdatedAt: 20,
          },
          createdAt: now,
          updatedAt: now,
        }],
      }),
    }, ownerCookie);
    expect(rosterSave.status).toBe(200);

    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId }),
    }, ownerCookie);
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json() as { token: string };
    const claimResponse = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token, fullName: 'Claimed Reaction Rider' }),
    }, athleteCookie);
    expect(claimResponse.status).toBe(200);

    const athleteRecords = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          personalRecords: {
            getPulledMaxWatts: 300,
            getPulledMaxWattsSource: 'recorded',
            getPulledMaxWattsUpdatedAt: 30,
            reactionTestBestMs: 500,
            reactionTestBestUpdatedAt: 30,
          },
          updatedAt: now,
        },
      }),
    }, athleteCookie);
    expect(athleteRecords.status).toBe(200);

    const deviceResponse = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Reaction Test Tablet' }),
    }, ownerCookie);
    expect(deviceResponse.status).toBe(201);
    const device = await deviceResponse.json() as { deviceToken: string };

    const rosterResponse = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${device.deviceToken}` },
    });
    expect(rosterResponse.status).toBe(200);
    await expect(rosterResponse.json()).resolves.toMatchObject({
      athletes: [expect.objectContaining({
        studioRiderId,
        personalRecords: {
          // Higher is better for Get Pulled, so this comes from the account.
          getPulledMaxWatts: 300,
          getPulledMaxWattsSource: 'recorded',
          getPulledMaxWattsUpdatedAt: 30,
          // Lower is better for Reaction Test, so this comes from the roster.
          reactionTestBestMs: 350,
          reactionTestBestUpdatedAt: 20,
        },
      })],
    });
  });
});
