import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';
let serverOutput = '';
let accountSequence = 0;

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

async function register(options: { name?: string; email?: string } = {}) {
  accountSequence += 1;
  const email = options.email || `reaction-board-${accountSequence}@tracklab.test`;
  const name = options.name || `Account Rider ${accountSequence}`;
  const response = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, password: 'tracklab-test-password' }),
  });
  expect(response.status).toBe(201);
  const { user } = await response.json() as { user: { id: string } };
  return { cookie: (response.headers.get('set-cookie') || '').split(';', 1)[0], email, name, id: user.id };
}

function measuredResult(reactionTimeMs: number, overrides: Record<string, unknown> = {}) {
  const startedAtEpoch = Date.now() - 2_000;
  return {
    id: `reaction-${startedAtEpoch}-${reactionTimeMs}`,
    startedAt: 1_000,
    startedAtEpoch,
    recordedAt: 1_000 + reactionTimeMs,
    recordedAtEpoch: startedAtEpoch + reactionTimeMs,
    reactionTimeMs,
    rating: 'excellent',
    stage: 'red',
    cadenceDelayMs: 100,
    valid: true,
    late: false,
    falseStart: false,
    ...overrides,
  };
}

function saveResult(cookie: string, reactionTimeMs: number, overrides: Record<string, unknown> = {}) {
  return api('/api/reaction-test/result', {
    method: 'POST',
    body: JSON.stringify({ result: measuredResult(reactionTimeMs, overrides) }),
  }, cookie);
}

function setPreference(cookie: string, joined: boolean, displayName = '') {
  return api('/api/reaction-test/leaderboard', {
    method: 'PATCH',
    body: JSON.stringify({ joined, displayName }),
  }, cookie);
}

beforeEach(async () => {
  serverOutput = '';
  baseUrl = `http://127.0.0.1:${await availablePort()}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: new URL(baseUrl).port,
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'reaction-paid-racer@tracklab.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await api('/api/health')).ok) return;
    } catch {
      // The isolated memory server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Reaction leaderboard server did not become healthy.\n${serverOutput}`);
}, 25_000);

afterEach(async () => {
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

describe('Reaction Test leaderboard API', () => {
  it('requires authentication for private records and settings while keeping ranks public', async () => {
    expect((await api('/api/reaction-test')).status).toBe(401);
    expect((await saveResult('', 200)).status).toBe(401);
    expect((await setPreference('', true, 'Anonymous Rider')).status).toBe(401);
    const board = await api('/api/reaction-test/leaderboard');
    expect(board.status).toBe(200);
    await expect(board.json()).resolves.toEqual({ entries: [] });
  });

  it('rejects false starts and incomplete or inconsistent measurements without creating history', async () => {
    const account = await register();
    const initial = await api('/api/reaction-test', {}, account.cookie);
    await expect(initial.json()).resolves.toEqual({
      personalBestMs: null,
      leaderboard: { joined: false, hidden: false, displayName: account.name },
      canJoinLeaderboard: true,
    });
    const invalidMeasurements = [
      { falseStart: true, valid: false, reactionTimeMs: null, stage: 'too-early', rating: 'false-start' },
      { startedAt: null },
      { recordedAt: 1_100 },
      { startedAtEpoch: 0 },
      { recordedAtEpoch: Date.now() + 120_000 },
      { cadenceDelayMs: 99 },
      { stage: 'green', rating: 'excellent' },
      { reactionTimeMs: -1 },
    ];
    for (const invalid of invalidMeasurements) {
      expect((await saveResult(account.cookie, 200, invalid)).status, JSON.stringify(invalid)).toBe(400);
    }
    const mismatchedAccount = await api('/api/reaction-test/result', {
      method: 'POST',
      body: JSON.stringify({ result: measuredResult(200), expectedAccountId: 'another-account' }),
    }, account.cookie);
    expect(mismatchedAccount.status).toBe(409);
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({ personalBestMs: null });
    const matchingAccount = await api('/api/reaction-test/result', {
      method: 'POST',
      body: JSON.stringify({ result: measuredResult(200), expectedAccountId: account.id, displayName: 'Forged Name' }),
    }, account.cookie);
    expect(matchingAccount.status).toBe(200);
    await expect(matchingAccount.json()).resolves.toMatchObject({ personalBestMs: 200 });
    const mismatchedRead = await api('/api/reaction-test?expectedAccountId=another-account', {}, account.cookie);
    expect(mismatchedRead.status).toBe(409);
    expect(await mismatchedRead.json()).not.toHaveProperty('personalBestMs');
    const matchingRead = await api(`/api/reaction-test?expectedAccountId=${account.id}`, {}, account.cookie);
    expect(matchingRead.status).toBe(200);
    await expect(matchingRead.json()).resolves.toMatchObject({ personalBestMs: 200 });
    const mismatchedSettings = await api('/api/reaction-test/leaderboard', {
      method: 'PATCH', body: JSON.stringify({ expectedAccountId: 'another-account', joined: true, displayName: 'Wrong Account' }),
    }, account.cookie);
    expect(mismatchedSettings.status).toBe(409);
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
      leaderboard: { joined: true, hidden: false, displayName: account.name },
    });
    await expect((await api('/api/training-sessions', {}, account.cookie)).json()).resolves.toMatchObject({ sessions: [] });
    expect((await setPreference(account.cookie, false)).status).toBe(200);
  });

  it('automatically ranks measured account bests without accepting editable profile scores', async () => {
    const account = await register();
    const patch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          personalRecords: { reactionTestBestMs: 1, reactionTestBestUpdatedAt: Date.now() },
          updatedAt: Date.now(),
        },
      }),
    }, account.cookie);
    expect(patch.status).toBe(200);
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
      personalBestMs: 1, leaderboard: { joined: false, hidden: false, displayName: account.name },
    });
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });

    const first = await saveResult(account.cookie, 210.125);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      personalBestMs: 1,
      leaderboard: { joined: true, hidden: false, displayName: account.name },
    });
    const board = await api('/api/reaction-test/leaderboard', {}, account.cookie);
    expect(board.headers.get('cache-control')).toContain('no-store');
    await expect(board.json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 210.125, isYou: true,
    }] });
    await expect((await api('/api/reaction-test/leaderboard?expectedAccountId=another-account', {}, account.cookie)).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 210.125, isYou: false,
    }] });
    for (const header of ['X-TrackLab-Club-Tablet-Session', 'X-TrackLab-Club-Tablet-Result-Token']) {
      await expect((await api('/api/reaction-test/leaderboard', {
        headers: { [header]: 'tablet-credential' },
      }, account.cookie)).json()).resolves.toEqual({ entries: [{
        rank: 1, displayName: account.name, reactionTimeMs: 210.125, isYou: false,
      }] });
      expect((await api('/api/reaction-test', {
        headers: { [header]: 'invalid-tablet-credential' },
      }, account.cookie)).status).toBe(header.endsWith('Result-Token') ? 403 : 401);
      expect((await api('/api/reaction-test/result', {
        method: 'POST', headers: { [header]: 'invalid-tablet-credential' },
        body: JSON.stringify({ result: measuredResult(20) }),
      }, account.cookie)).status).toBe(401);
    }
    expect((await saveResult(account.cookie, 300)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 210.125, isYou: false,
    }] });
    expect((await saveResult(account.cookie, 190)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 190, isYou: false,
    }] });
    await expect((await api('/api/training-sessions', {}, account.cookie)).json()).resolves.toMatchObject({ sessions: [] });
    expect((await setPreference(account.cookie, false)).status).toBe(200);
  });

  it('preserves explicit public renaming and hiding while later measurements improve the private PR', async () => {
    const account = await register();
    expect((await saveResult(account.cookie, 200)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 200, isYou: false,
    }] });
    for (const name of ['', 'A', account.email, 'x'.repeat(33)]) {
      expect((await setPreference(account.cookie, true, name)).status, name).toBe(400);
    }
    expect((await setPreference(account.cookie, true, 'Gate Flyer')).status).toBe(200);
    const board = await api('/api/reaction-test/leaderboard');
    const body = await board.json();
    expect(body).toEqual({ entries: [{ rank: 1, displayName: 'Gate Flyer', reactionTimeMs: 200, isYou: false }] });
    expect(JSON.stringify(body)).not.toContain(account.name);
    expect(JSON.stringify(body)).not.toContain(account.email);

    expect((await setPreference(account.cookie, true, 'Renamed Rider')).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: 'Renamed Rider', reactionTimeMs: 200, isYou: false,
    }] });
    expect((await setPreference(account.cookie, false)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
      personalBestMs: 200, leaderboard: { joined: false, hidden: true, displayName: account.name },
    });
    expect((await saveResult(account.cookie, 150)).status).toBe(200);
    expect((await saveResult(account.cookie, 350)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
      personalBestMs: 150, leaderboard: { joined: false, hidden: true },
    });
    expect((await setPreference(account.cookie, true, account.name)).status).toBe(200);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 150, isYou: false,
    }] });
    await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
      leaderboard: { joined: true, hidden: false },
    });
    expect((await setPreference(account.cookie, false)).status).toBe(200);
  });

  it('recognizes existing Racer and free accounts and uses their names without an enrollment request', async () => {
    for (const [email, tier] of [
      ['reaction-paid-racer@tracklab.test', 'racer'],
      ['reaction-free-rider@tracklab.test', 'spectator'],
    ]) {
      const account = await register({ email });
      await expect((await api('/api/auth/me', {}, account.cookie)).json()).resolves.toMatchObject({
        user: { id: account.id, name: account.name, membership: { tier } },
      });
      await expect((await saveResult(account.cookie, 220)).json()).resolves.toMatchObject({
        personalBestMs: 220, leaderboard: { joined: true, hidden: false, displayName: account.name },
      });
      await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
        rank: 1, displayName: account.name, reactionTimeMs: 220, isYou: false,
      }] });
      expect((await setPreference(account.cookie, false)).status).toBe(200);
    }
  });

  it('keeps existing measurements unpublished during reads, then uses the prior best on a slower new run', async () => {
    const account = await register();
    const result = measuredResult(170);
    const seed = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({ session: {
        id: 'reaction-test-existing-best', activityType: 'bmx-race', title: 'Reaction Test · EXCELLENT',
        startedAt: result.startedAtEpoch, endedAt: result.recordedAtEpoch, durationMs: 170,
        distanceMeters: 0, source: 'live', details: { reactionTest: result },
      } }),
    }, account.cookie);
    expect(seed.status).toBe(201);
    for (let read = 0; read < 2; read += 1) {
      await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
        personalBestMs: 170, leaderboard: { joined: false, hidden: false, displayName: account.name },
      });
      await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [] });
    }
    await expect((await saveResult(account.cookie, 250)).json()).resolves.toMatchObject({
      personalBestMs: 170, leaderboard: { joined: true, hidden: false, displayName: account.name },
    });
    const responses = await Promise.all([250, 140, 180, 140, 300].map((time) => saveResult(account.cookie, time)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    await expect((await api('/api/reaction-test/leaderboard')).json()).resolves.toEqual({ entries: [{
      rank: 1, displayName: account.name, reactionTimeMs: 140, isYou: false,
    }] });
    expect((await setPreference(account.cookie, false)).status).toBe(200);
  });

  it('shortens account names safely and never falls back to the account email', async () => {
    for (const [name, publicName] of [
      ['A long account name that exceeds thirty two characters', 'A long account name that exceeds'],
      ['unsafe-name@tracklab.test', 'TrackLab rider'],
      ['<Rider>', 'TrackLab rider'],
      ['A', 'TrackLab rider'],
    ]) {
      const account = await register({ name });
      await expect((await api('/api/reaction-test', {}, account.cookie)).json()).resolves.toMatchObject({
        leaderboard: { joined: false, hidden: false, displayName: publicName },
      });
      await expect((await saveResult(account.cookie, 230)).json()).resolves.toMatchObject({
        leaderboard: { joined: true, hidden: false, displayName: publicName },
      });
      const entries = await (await api('/api/reaction-test/leaderboard')).json();
      expect(entries).toEqual({ entries: [{ rank: 1, displayName: publicName, reactionTimeMs: 230, isYou: false }] });
      expect(JSON.stringify(entries)).not.toContain(account.email);
      expect((await setPreference(account.cookie, false)).status).toBe(200);
    }
  });

  it('sorts faster reactions first and accepts only Top 5, 10, 25, and 50 limits', async () => {
    for (const [index, time] of [260, 180].entries()) {
      const account = await register();
      expect((await saveResult(account.cookie, time)).status).toBe(200);
      expect((await setPreference(account.cookie, true, `Ranked Rider ${index}`)).status).toBe(200);
    }
    for (const limit of [5, 10, 25, 50]) {
      const response = await api(`/api/reaction-test/leaderboard?limit=${limit}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { entries: Array<{ rank: number; reactionTimeMs: number }> };
      expect(body.entries.map(({ rank, reactionTimeMs }) => ({ rank, reactionTimeMs }))).toEqual([
        { rank: 1, reactionTimeMs: 180 },
        { rank: 2, reactionTimeMs: 260 },
      ]);
      expect(body.entries.length).toBeLessThanOrEqual(limit);
    }
    for (const limit of ['1', '6', '51', '100', '-5', 'NaN']) {
      expect((await api(`/api/reaction-test/leaderboard?limit=${limit}`)).status).toBe(400);
    }
  });
});
