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
      TRACKLAB_ADMIN_EMAILS: 'reaction-roster-owner@tracklab.test,reaction-unclaimed-owner@tracklab.test',
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
    const history = await api('/api/training-sessions', {}, cookie);
    await expect(history.json()).resolves.toMatchObject({ sessions: [], totals: { sessions: 0, bmxRaces: 0 } });
  });

  it('keeps claimed tablet results private until a personal run joins, then updates the athlete leaderboard entry', async () => {
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

    const selection = await api('/api/club-tablet/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${device.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'ReactionTabletBike' }),
    });
    expect(selection.status).toBe(201);
    const tabletSession = await selection.json() as { sessionToken: string; resultUploadToken: string };
    const tabletHeaders = { 'X-TrackLab-Club-Tablet-Session': tabletSession.sessionToken };
    await expect((await api('/api/reaction-test', { headers: tabletHeaders }, athleteCookie)).json()).resolves.toEqual({
      personalBestMs: 350, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    const result = {
      id: 'tablet-reaction-result', startedAt: 1000, recordedAt: 1100,
      startedAtEpoch: Date.now() - 1000, recordedAtEpoch: Date.now() - 900,
      reactionTimeMs: 100, stage: 'red', rating: 'excellent', valid: true,
      late: false, falseStart: false, cadenceDelayMs: 1200,
    };
    const tabletSave = await api('/api/reaction-test/result', {
      method: 'POST', headers: tabletHeaders, body: JSON.stringify({ result }),
    }, athleteCookie);
    expect(tabletSave.status).toBe(200);
    await expect(tabletSave.json()).resolves.toEqual({
      personalBestMs: 100, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    await expect((await api('/api/user-data', {}, athleteCookie)).json()).resolves.toMatchObject({
      accountProfile: { personalRecords: { reactionTestBestMs: 100 } },
    });
    // Enrollment retires the owner's ambient session; inspect from a fresh personal login.
    const ownerLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: 'reaction-roster-owner@tracklab.test', password: 'tracklab-test-password',
    }) });
    expect(ownerLogin.status).toBe(200);
    const freshOwnerCookie = (ownerLogin.headers.get('set-cookie') || '').split(';', 1)[0];
    await expect((await api('/api/user-data', {}, freshOwnerCookie)).json()).resolves.toMatchObject({
      studioRiders: [expect.objectContaining({ id: studioRiderId, personalRecords: expect.objectContaining({ reactionTestBestMs: 100 }) })],
    });
    expect((await api('/api/reaction-test/leaderboard', {
      method: 'PATCH', headers: tabletHeaders, body: JSON.stringify({ joined: true, displayName: 'Public Tablet' }),
    }, athleteCookie)).status).toBe(403);
    expect((await api('/api/reaction-test', {
      headers: { 'X-TrackLab-Club-Tablet-Session': 'invalid-tablet-token' },
    }, athleteCookie)).status).toBe(401);
    await expect((await api('/api/reaction-test', {}, athleteCookie)).json()).resolves.toEqual({
      personalBestMs: 100,
      leaderboard: { joined: false, hidden: false, displayName: 'Claimed Reaction Rider' },
      canJoinLeaderboard: true,
    });
    await expect((await api('/api/reaction-test', {}, freshOwnerCookie)).json()).resolves.toEqual({
      personalBestMs: null,
      leaderboard: { joined: false, hidden: false, displayName: 'Reaction Test Club' },
      canJoinLeaderboard: true,
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });
    const personalRun = await api('/api/reaction-test/result', {
      method: 'POST', body: JSON.stringify({ result: {
        ...result, id: 'personal-slower-reaction-result', reactionTimeMs: 200,
        recordedAt: result.startedAt + 200, recordedAtEpoch: result.startedAtEpoch + 200,
      } }),
    }, athleteCookie);
    expect(personalRun.status).toBe(200);
    await expect(personalRun.json()).resolves.toEqual({
      personalBestMs: 100,
      leaderboard: { joined: true, hidden: false, displayName: 'Claimed Reaction Rider' },
      canJoinLeaderboard: true,
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [
      { rank: 1, displayName: 'Claimed Reaction Rider', reactionTimeMs: 100, isYou: false },
    ] });
    await expect((await api('/api/reaction-test', { headers: tabletHeaders })).json()).resolves.toEqual({
      personalBestMs: 100, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    expect((await api('/api/reaction-test/leaderboard', {
      method: 'PATCH', headers: tabletHeaders, body: JSON.stringify({ joined: false, displayName: '' }),
    }, athleteCookie)).status).toBe(403);
    const joinedAthleteTabletSave = await api('/api/reaction-test/result', {
      method: 'POST', headers: tabletHeaders, body: JSON.stringify({ result: {
        ...result, id: 'tablet-joined-athlete-result', reactionTimeMs: 90,
        recordedAt: result.startedAt + 90, recordedAtEpoch: result.startedAtEpoch + 90,
      } }),
    }, freshOwnerCookie);
    expect(joinedAthleteTabletSave.status).toBe(200);
    await expect(joinedAthleteTabletSave.json()).resolves.toEqual({
      personalBestMs: 90, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [
      { rank: 1, displayName: 'Claimed Reaction Rider', reactionTimeMs: 90, isYou: false },
    ] });
    await expect((await api('/api/training-sessions', {}, athleteCookie)).json()).resolves.toMatchObject({ sessions: [] });

    const completedAt = Date.now() - 1;
    const pendingResult = { ...result, id: 'offline-tablet-best', reactionTimeMs: 75, recordedAt: 1075,
      startedAtEpoch: completedAt - 75, recordedAtEpoch: completedAt };
    expect((await api('/api/club-tablet/sessions', { method: 'DELETE', headers: tabletHeaders })).status).toBe(200);
    expect((await api('/api/reaction-test', { headers: tabletHeaders })).status).toBe(401);
    expect((await api('/api/reaction-test/result', {
      method: 'POST', headers: tabletHeaders, body: JSON.stringify({ result: pendingResult }),
    })).status).toBe(401);
    const completionHeaders = {
      ...tabletHeaders,
      Authorization: `Bearer ${device.deviceToken}`,
      'X-TrackLab-Club-Tablet-Result-Token': tabletSession.resultUploadToken,
    };
    expect((await api('/api/reaction-test', { headers: completionHeaders }, athleteCookie)).status).toBe(403);
    expect((await api('/api/reaction-test/leaderboard', {
      method: 'PATCH', headers: completionHeaders, body: JSON.stringify({ joined: false, displayName: '' }),
    }, athleteCookie)).status).toBe(403);
    const completedUpload = await api('/api/reaction-test/result', {
      method: 'POST', headers: completionHeaders, body: JSON.stringify({ result: pendingResult }),
    });
    expect(completedUpload.status).toBe(200);
    await expect(completedUpload.json()).resolves.toEqual({
      personalBestMs: 75, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [
      { rank: 1, displayName: 'Claimed Reaction Rider', reactionTimeMs: 75, isYou: false },
    ] });
    const afterExpiry = Date.now() + 1000;
    expect((await api('/api/reaction-test/result', {
      method: 'POST', headers: completionHeaders,
      body: JSON.stringify({ result: { ...pendingResult, recordedAtEpoch: afterExpiry, startedAtEpoch: afterExpiry - 75 } }),
    })).status).toBe(400);
    const nextSelection = await api('/api/club-tablet/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${device.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'ReactionTabletBike' }),
    });
    expect(nextSelection.status).toBe(201);
    const nextSession = await nextSelection.json() as { sessionToken: string };
    expect((await api('/api/reaction-test/result', {
      method: 'POST', headers: { ...completionHeaders, 'X-TrackLab-Club-Tablet-Session': nextSession.sessionToken },
      body: JSON.stringify({ result: pendingResult }),
    })).status).toBe(401);
    // The original immutable credential can still drain its already-recorded
    // best, without being replaced by the newly selected interactive session.
    expect((await api('/api/reaction-test/result', {
      method: 'POST', headers: completionHeaders, body: JSON.stringify({ result: pendingResult }),
    })).status).toBe(200);
    await expect((await api('/api/training-sessions', {}, athleteCookie)).json()).resolves.toMatchObject({ sessions: [] });

    const hiddenPreference = await api('/api/reaction-test/leaderboard', {
      method: 'PATCH', body: JSON.stringify({ joined: false, displayName: 'Claimed Reaction Rider' }),
    }, athleteCookie);
    expect(hiddenPreference.status).toBe(200);
    const hiddenAthleteTabletSave = await api('/api/reaction-test/result', {
      method: 'POST', headers: { 'X-TrackLab-Club-Tablet-Session': nextSession.sessionToken },
      body: JSON.stringify({ result: {
        ...result, id: 'tablet-hidden-athlete-result', reactionTimeMs: 50,
        recordedAt: result.startedAt + 50, recordedAtEpoch: result.startedAtEpoch + 50,
      } }),
    }, freshOwnerCookie);
    expect(hiddenAthleteTabletSave.status).toBe(200);
    await expect(hiddenAthleteTabletSave.json()).resolves.toEqual({
      personalBestMs: 50, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    await expect((await api('/api/reaction-test', {}, athleteCookie)).json()).resolves.toEqual({
      personalBestMs: 50,
      leaderboard: { joined: false, hidden: true, displayName: 'Claimed Reaction Rider' },
      canJoinLeaderboard: true,
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });
  });

  it('never joins or changes the owner account when an unclaimed tablet athlete records a result', async () => {
    const registration = await api('/api/auth/register', {
      method: 'POST', body: JSON.stringify({
        email: 'reaction-unclaimed-owner@tracklab.test',
        name: 'Unclaimed Reaction Club', password: 'tracklab-test-password',
      }),
    });
    expect(registration.status).toBe(201);
    const ownerCookie = (registration.headers.get('set-cookie') || '').split(';', 1)[0];
    const studioRiderId = `reaction-unclaimed-${Date.now()}`;
    const now = Date.now();
    const rosterSave = await api('/api/user-data', {
      method: 'PATCH', body: JSON.stringify({
        accountProfile: {
          personalRecords: { reactionTestBestMs: 700, reactionTestBestUpdatedAt: now },
          updatedAt: now,
        },
        studioRiders: [{
          id: studioRiderId, name: 'Unclaimed Reaction Rider',
          personalRecords: { reactionTestBestMs: 600, reactionTestBestUpdatedAt: now },
          createdAt: now, updatedAt: now,
        }],
      }),
    }, ownerCookie);
    expect(rosterSave.status).toBe(200);
    const deviceResponse = await api('/api/club-tablet/devices', {
      method: 'POST', body: JSON.stringify({ name: 'Unclaimed Reaction Tablet' }),
    }, ownerCookie);
    expect(deviceResponse.status).toBe(201);
    const device = await deviceResponse.json() as { deviceToken: string };
    const ownerLogin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({
        email: 'reaction-unclaimed-owner@tracklab.test', password: 'tracklab-test-password',
      }),
    });
    expect(ownerLogin.status).toBe(200);
    const freshOwnerCookie = (ownerLogin.headers.get('set-cookie') || '').split(';', 1)[0];
    const selection = await api('/api/club-tablet/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${device.deviceToken}` },
      body: JSON.stringify({ studioRiderId, bikeDeviceId: 'UnclaimedReactionBike' }),
    });
    expect(selection.status).toBe(201);
    const tabletSession = await selection.json() as { sessionToken: string };
    const tabletHeaders = { 'X-TrackLab-Club-Tablet-Session': tabletSession.sessionToken };
    const boardBefore = await (await api('/api/reaction-test/leaderboard')).json();
    await expect((await api('/api/reaction-test', { headers: tabletHeaders }, freshOwnerCookie)).json()).resolves.toEqual({
      personalBestMs: 600, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    const result = {
      id: 'unclaimed-tablet-reaction-result', startedAt: 1000, recordedAt: 1090,
      startedAtEpoch: Date.now() - 1000, recordedAtEpoch: Date.now() - 910,
      reactionTimeMs: 90, stage: 'red', rating: 'excellent', valid: true,
      late: false, falseStart: false, cadenceDelayMs: 1200,
    };
    const tabletSave = await api('/api/reaction-test/result', {
      method: 'POST', headers: tabletHeaders, body: JSON.stringify({ result }),
    }, freshOwnerCookie);
    expect(tabletSave.status).toBe(200);
    await expect(tabletSave.json()).resolves.toEqual({
      personalBestMs: 90, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false,
    });
    await expect((await api('/api/reaction-test', {}, freshOwnerCookie)).json()).resolves.toEqual({
      personalBestMs: 700,
      leaderboard: { joined: false, hidden: false, displayName: 'Unclaimed Reaction Club' },
      canJoinLeaderboard: true,
    });
    await expect((await api('/api/user-data', {}, freshOwnerCookie)).json()).resolves.toMatchObject({
      accountProfile: { personalRecords: { reactionTestBestMs: 700 } },
      studioRiders: [expect.objectContaining({
        id: studioRiderId, personalRecords: expect.objectContaining({ reactionTestBestMs: 90 }),
      })],
    });
    await expect((await api('/api/reaction-test/leaderboard', { headers: tabletHeaders }, freshOwnerCookie)).json())
      .resolves.toEqual(boardBefore);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual(boardBefore);
  });
});
