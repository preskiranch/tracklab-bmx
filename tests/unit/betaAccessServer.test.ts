import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
let admin = '';
let rider = '';
let other = '';
let riderUser: { id: string; profileKey: string };
const sockets = new Set<WebSocket>();

async function request(path: string, cookie = '', body?: unknown) {
  return fetch(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: baseUrl, ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function register(email: string) {
  const response = await request('/api/auth/register', '', { email, name: 'Beta test rider', password: 'beta-test-long-password' });
  expect(response.status).toBe(201);
  return { cookie: String(response.headers.get('set-cookie')).split(';')[0], user: (await response.json()).user };
}

beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address && typeof address === 'object' ? address.port : 0));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], { cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', OPENAI_API_KEY: '',
      TRACKLAB_APPLE_IAP_ENABLED: '0', TRACKLAB_APPLE_ONLY_CUTOVER: '0',
      TRACKLAB_ADMIN_EMAILS: 'beta-admin@tracklab.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await request('/api/health')).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  admin = (await register('beta-admin@tracklab.test')).cookie;
  const registered = await register('beta-rider@tracklab.test');
  rider = registered.cookie;
  riderUser = registered.user;
  other = (await register('beta-other@tracklab.test')).cookie;
}, 25000);

afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
});

describe('admin-issued beta access API', () => {
  it('requires authentication and administrator privilege without exposing invitation details', async () => {
    for (const path of ['/api/beta-access', '/api/admin/beta-access']) expect((await request(path)).status).toBe(401);
    expect((await request('/api/beta-access/accept', '', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await request('/api/admin/beta-access', rider)).status).toBe(403);
    expect((await request('/api/admin/beta-access/invites', rider, { email: 'beta-rider@tracklab.test' })).status).toBe(403);
    expect((await request('/api/admin/beta-access/revoke', rider, { grantId: 'forged' })).status).toBe(403);
    await expect((await request('/api/beta-access', rider)).json()).resolves.toEqual({ beta: null });
    for (const body of [
      { email: 'invalid' }, { email: 'beta-rider@tracklab.test', bikeSeats: 5 },
      { email: 'beta-rider@tracklab.test', durationDays: -1 }, { email: 'beta-rider@tracklab.test', durationDays: '90' },
    ]) expect((await request('/api/admin/beta-access/invites', admin, body)).status).toBe(400);
  });

  it('keeps records/ghosts online and grants bounded Wattbike capacity without a paid subscription', async () => {
    expect((await request('/api/ghosts', rider, { ghost: {} })).status).toBe(403);
    expect((await request('/api/race-results', rider, {})).status).toBe(403);
    const created = await request('/api/admin/beta-access/invites', admin, { email: ' BETA-RIDER@tracklab.test ' });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const invitation = await created.json();
    expect(invitation.invite).toMatchObject({ email: 'beta-rider@tracklab.test', bikeSeats: 4, durationDays: 90 });
    expect(new URL(invitation.claimUrl).search).toBe('');
    expect(new URL(invitation.claimUrl).hash).toBe(`#betaInvite=${invitation.token}`);
    const list = await (await request('/api/admin/beta-access', admin)).text();
    expect(list).not.toContain(invitation.token);
    expect(list).not.toMatch(/tokenHash|token_hash/);
    expect((await request('/api/beta-access/accept', other, { token: invitation.token })).status).toBe(409);
    const accepted = await request('/api/beta-access/accept', rider, { token: invitation.token });
    expect(accepted.status).toBe(200);
    const claimed = await accepted.json();
    expect(claimed).toMatchObject({ beta: { active: true, bikeSeats: 4 }, user: { admin: false, membership: { tier: 'racer', bikeSeats: 4 } } });
    expect(claimed.beta.expiresAt - claimed.beta.claimedAt).toBe(90 * 86400000);
    expect((await request('/api/beta-access/accept', rider, { token: invitation.token })).status).toBe(409);
    await expect((await request('/api/auth/me', rider)).json()).resolves.toMatchObject({ user: { membership: { tier: 'racer', bikeSeats: 4 } } });

    const socket = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/multiplayer`, { headers: { Cookie: rider, Origin: baseUrl } });
    sockets.add(socket);
    const messages: any[] = [];
    socket.on('message', (data) => { messages.push(JSON.parse(data.toString())); });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    const waitFor = async (predicate: (message: any) => boolean) => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const result = messages.find(predicate);
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Capacity message missing: ${JSON.stringify(messages)}`);
    };
    expect(await waitFor((message) => message.type === 'wattbike-capacity' && message.grantedConnections === 4))
      .toMatchObject({ grantedConnections: 4 });

    const now = Date.now();
    const trackId = 'beta-private-test-track';
    const summary = { playerId: 1, riderName: 'Beta Rider', rank: 1, finishTimeMs: 10000,
      distanceMeters: 30, topSpeedKph: 20, averageSpeedKph: 10, topCadence: 100, averageCadence: 80, topWatts: 500, averageWatts: 300 };
    const ghost = { id: `beta-ghost-${now}`, trackId, trackName: 'Beta Track', riderName: 'Beta Rider',
      ownerKey: 'user:forged', finishTimeMs: 10000, raceSource: 'live', savedAt: now, analyticsPublic: false,
      summary, points: [{ elapsedMs: 0, distanceMeters: 0, velocityMps: 0 }, { elapsedMs: 10000, distanceMeters: 30, velocityMps: 0 }] };
    expect((await request('/api/user-data', rider, { bikeProfiles: [{ deviceId: 12345, name: 'Tester bike' }] })).status).toBe(200);
    expect((await request('/api/race-results', rider, { sessionId: `beta-race-${now}`, trackId, trackName: 'Beta Track', summaries: [summary] })).status).toBe(201);
    expect((await request('/api/ghosts', rider, { ghost })).status).toBe(200);
    expect((await request('/api/training-sessions', rider, { session: { id: `beta-training-${now}`, activityType: 'bmx-race',
      title: 'Beta Race', startedAt: now-10000, endedAt: now, durationMs: 10000, distanceMeters: 30,
      trackId, trackName: 'Beta Track', details: { summaries: [summary] } } })).status).toBe(201);
    const saved = await (await request(`/api/ghosts?trackId=${trackId}`, rider)).json();
    expect(saved.ghosts).toEqual(expect.arrayContaining([expect.objectContaining({ id: ghost.id, ownerKey: riderUser.profileKey })]));
    expect((await request('/api/multiplayer/leaderboards?trackId='+trackId)).status).toBe(200);

    expect((await request('/api/admin/beta-access/revoke', admin, { inviteId: invitation.invite.id })).status).toBe(404);
    expect((await request('/api/admin/beta-access/revoke', admin, { grantId: claimed.beta.id })).status).toBe(200);
    await waitFor((message) => message.type === 'wattbike-capacity' && message.grantedConnections === 0);
    expect((await request('/api/ghosts', rider, { ghost })).status).toBe(403);
    expect((await request('/api/race-results', rider, {})).status).toBe(403);
    await expect((await request('/api/beta-access', rider)).json()).resolves.toMatchObject({ beta: { active: false } });
    expect((await request('/api/user-data', rider)).status).toBe(200);
    const history = await (await request(`/api/training-sessions?from=${now-20000}&to=${now+1000}`, rider)).json();
    expect(history.sessions.some((session: any) => session.id === `beta-training-${now}`)).toBe(true);
    const preserved = await (await request(`/api/ghosts?trackId=${trackId}`, rider)).json();
    expect(preserved.ghosts.some((savedGhost: any) => savedGhost.id === ghost.id)).toBe(true);
  });

  it('revokes pending invitations and permits a smaller grant without admin privileges', async () => {
    const issued = await (await request('/api/admin/beta-access/invites', admin, { email: 'beta-other@tracklab.test', bikeSeats: 1, durationDays: 30 })).json();
    expect((await request('/api/admin/beta-access/revoke', admin, { inviteId: issued.invite.id })).status).toBe(200);
    expect((await request('/api/beta-access/accept', other, { token: issued.token })).status).toBe(409);
    const again = await (await request('/api/admin/beta-access/invites', admin, { email: 'beta-other@tracklab.test', bikeSeats: 1, durationDays: 30 })).json();
    const accepted = await (await request('/api/beta-access/accept', other, { token: again.token })).json();
    expect(accepted).toMatchObject({ beta: { bikeSeats: 1, active: true }, user: { admin: false, membership: { tier: 'racer', bikeSeats: 1 } } });
    expect((await request('/api/admin/beta-access', other)).status).toBe(403);
  });
});
