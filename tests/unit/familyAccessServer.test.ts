import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: ChildProcess;
let base = '';
let output = '';
let sequence = 0;
let registrationIp = 0;
type Account = { cookie: string; user: { id: string; profileKey: string; name: string } };
async function api(path: string, account?: Account, body?: unknown, method = body === undefined ? 'GET' : 'POST', headers = {}) {
  return fetch(base + path, { method, headers: { Origin: base, ...(account ? { Cookie: account.cookie } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function register(name: string, email = `family-${++sequence}@tracklab.test`) {
  const response = await api('/api/auth/register', undefined, { email, name, password: 'tracklab-family-test-password' },
    'POST', { 'X-Forwarded-For': `198.51.100.${++registrationIp}` });
  expect(response.status).toBe(201);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0], user: (await response.json()).user } as Account;
}
async function managed(parent: Account, name: string) {
  const response = await api('/api/family/children', parent, { name });
  expect(response.status).toBe(201);
  return (await response.json()).child;
}
async function invitation(parent: Account) {
  const response = await api('/api/family/link-invites', parent, {});
  expect(response.status).toBe(201);
  const payload = await response.json();
  return { ...payload, token: new URLSearchParams(new URL(payload.claimUrl).hash.slice(1)).get('familyInvite') };
}

beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer(); socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const address = socket.address();
      socket.close(() => resolve(typeof address === 'object' && address ? address.port : 0)); });
  });
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['cloud/server.mjs'], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: '', OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'family-club@tracklab.test', TRACKLAB_APPLE_IAP_ENABLED: '0', TRACKLAB_APPLE_ONLY_CUTOVER: '0' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await api('/api/health')).ok) return; } catch { /* Server startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Family server did not start: ${output}`);
}, 25000);
afterAll(async () => {
  if (server?.exitCode == null) {
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 2000);
      server.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
});

describe('personal family access API', () => {
  it('requires personal authentication, rejects IDOR, and keeps parent identity unchanged across siblings', async () => {
    expect((await api('/api/family')).status).toBe(401);
    const [parent, stranger] = await Promise.all([register('Parent'), register('Stranger')]);
    expect((await api('/api/family', parent, undefined, 'GET', { 'X-TrackLab-Club-Tablet-Session': 'forged' })).status).toBe(403);
    const [a, b] = await Promise.all([managed(parent, 'Alex'), managed(parent, 'Alex')]);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ kind: 'managed', permissions: { activity: true, health: false } });
    for (const id of [a.id, b.id]) {
      expect((await api(`/api/family/children/${id}/profile`, stranger)).status).toBe(404);
      expect((await api(`/api/family/children/${id}/training-sessions`, stranger)).status).toBe(404);
      const response = await api(`/api/family/children/${id}/profile`, parent);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ child: { id }, accountProfile: {}, healthAvailable: false });
    }
    expect((await (await api('/api/auth/me', parent)).json()).user).toMatchObject(parent.user);
    expect((await api(`/api/family/children/${a.id}`, parent, undefined, 'DELETE')).status).toBe(200);
    expect((await api(`/api/family/children/${a.id}/profile`, parent)).status).toBe(404);
    expect((await (await api('/api/family', parent)).json()).archivedChildren).toEqual(expect.arrayContaining([expect.objectContaining({ id: a.id })]));
    expect((await api(`/api/family/children/${a.id}/restore`, stranger, {})).status).toBe(404);
    expect((await api(`/api/family/children/${a.id}/restore`, parent, {})).status).toBe(200);
  });

  it('requires existing-child approval, strips health, preserves power, and supports either party revoking', async () => {
    const [parent, child, outsider] = await Promise.all([register('Parent of existing'), register('Existing child'), register('Outsider')]);
    const pending = await invitation(parent);
    expect((await api('/api/family/link-invites/accept', parent, { token: pending.token, activityConsent: true })).status).toBe(409);
    expect((await api('/api/family/link-invites/accept', child, { token: pending.token })).status).toBe(400);
    expect((await api('/api/family/link-invites/accept', child, { token: pending.token, activityConsent: true, healthConsent: true })).status).toBe(400);
    const preview = await api(`/api/family/link-invites/preview?token=${pending.token}`, child);
    expect(await preview.json()).toMatchObject({ parentName: parent.user.name, canAccept: true });
    expect(output).not.toContain(pending.token);
    const accept = await api('/api/family/link-invites/accept', child, { token: pending.token, activityConsent: true });
    expect(accept.status).toBe(200);
    expect((await api('/api/family/link-invites/accept', outsider, { token: pending.token, activityConsent: true })).status).toBe(409);
    const linked = (await (await api('/api/family', parent)).json()).children[0];
    const now = Date.now();
    expect((await api('/api/user-data', child, { accountProfile: {
      personalRecords: { reactionTestBestMs: 100, reactionTestBestAt: now, getPulledMaxWatts: 900 }, updatedAt: now,
    } }, 'PATCH')).status).toBe(200);
    expect((await api('/api/training-sessions', child, { session: { id: 'family-private-session', activityType: 'bmx-race',
      title: 'Private child ride', startedAt: now - 10000, endedAt: now, durationMs: 10000, distanceMeters: 50,
      details: { summaries: [{ playerId: 1, averageWatts: 300, topWatts: 900 }], appleWatch: { bpm: 170 },
        heartRate: { samples: [170] }, privateHeartRate: { averageBpm: 170 } } } })).status).toBe(201);
    const history = await (await api(`/api/family/children/${linked.id}/training-sessions?from=0`, parent)).json();
    expect(history.totals).toMatchObject({ sessions: 1, bmxRaces: 1, distanceMeters: 50, durationMs: 10000 });
    expect(history.sessions[0].details.summaries[0]).toMatchObject({ averageWatts: 300, topWatts: 900 });
    expect(JSON.stringify(history)).not.toMatch(/heartRate|appleWatch|averageBpm/);
    expect((await (await api(`/api/family/children/${linked.id}/profile`, parent)).json()).accountProfile.personalRecords)
      .toMatchObject({ reactionTestBestMs: 100, getPulledMaxWatts: 900 });
    expect((await api(`/api/family/shared-with/${linked.id}`, outsider, undefined, 'DELETE')).status).toBe(404);
    expect((await api(`/api/family/shared-with/${linked.id}`, child, undefined, 'DELETE')).status).toBe(200);
    expect((await api(`/api/family/children/${linked.id}/training-sessions`, parent)).status).toBe(404);
    expect((await (await api('/api/training-sessions?from=0', child)).json()).sessions).toHaveLength(1);
    const second = await invitation(parent);
    expect((await api('/api/family/link-invites/accept', child, { token: second.token, activityConsent: true })).status).toBe(200);
    expect((await api(`/api/family/children/${linked.id}`, parent, undefined, 'DELETE')).status).toBe(200);
    expect((await api(`/api/family/children/${linked.id}/restore`, parent, {})).status).toBe(404);
  });

  it('claims a managed child club record and keeps completed tablet activities separate from a sibling', async () => {
    const owner = await register('Family Club', 'family-club@tracklab.test');
    const parent = await register('Parent unchanged');
    const [a, b] = await Promise.all([managed(parent, 'Child A'), managed(parent, 'Child B')]);
    const now = Date.now();
    const roster = [{ id: 'family-roster-a', name: 'Child A', createdAt: now, updatedAt: now,
      personalRecords: { reactionTestBestMs: 110, reactionTestBestAt: now } },
    { id: 'family-roster-b', name: 'Child B', createdAt: now, updatedAt: now,
      personalRecords: { reactionTestBestMs: 220, reactionTestBestAt: now } }];
    expect((await api('/api/user-data', owner, { studioRiders: roster }, 'PATCH')).status).toBe(200);
    for (const [child, rider] of [[a, roster[0]], [b, roster[1]]]) {
      const clubInvite = await (await api('/api/club-connect/invites', owner, { studioRiderId: rider.id })).json();
      const response = await api(`/api/family/children/${child.id}/club-claim`, parent, { token: clubInvite.token });
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload.accountProfile.personalRecords.reactionTestBestMs).toBe(rider.personalRecords.reactionTestBestMs);
      expect((await api(`/api/family/children/${child.id}/club-claim`, parent, { token: clubInvite.token })).status).toBe(409);
    }
    expect((await (await api('/api/auth/me', parent)).json()).user.name).toBe('Parent unchanged');
    const deviceResponse = await api('/api/club-tablet/devices', owner, { name: 'Family child tablet' });
    expect(deviceResponse.status).toBe(201);
    const device = await deviceResponse.json();
    const tabletResponse = await api('/api/club-tablet/sessions', undefined,
      { studioRiderId: roster[0].id, bikeDeviceId: 'FamilyWattbike701' }, 'POST', { Authorization: `Bearer ${device.deviceToken}` });
    expect(tabletResponse.status).toBe(201);
    const tablet = await tabletResponse.json();
    const reactionHeaders = { 'X-TrackLab-Club-Tablet-Session': tablet.sessionToken };
    const measuredReaction = { id: 'family-measured-reaction', startedAt: 1000, recordedAt: 1090,
      startedAtEpoch: now - 1000, recordedAtEpoch: now - 910, reactionTimeMs: 90,
      stage: 'red', rating: 'excellent', valid: true, late: false, falseStart: false, cadenceDelayMs: 1200 };
    expect(await (await api('/api/reaction-test', undefined, undefined, 'GET', reactionHeaders)).json())
      .toMatchObject({ personalBestMs: 110, canJoinLeaderboard: false });
    for (const result of [measuredReaction, { ...measuredReaction, id: 'family-slower-reaction',
      recordedAt: 1100, recordedAtEpoch: now - 900, reactionTimeMs: 100 }]) {
      const response = await api('/api/reaction-test/result', undefined, { result }, 'POST', reactionHeaders);
      const payload = await response.json();
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({ personalBestMs: 90, leaderboard: { joined: false, hidden: false, displayName: '' }, canJoinLeaderboard: false });
    }
    expect((await (await api(`/api/family/children/${a.id}/profile`, parent)).json()).accountProfile.personalRecords.reactionTestBestMs).toBe(90);
    expect((await (await api(`/api/family/children/${b.id}/profile`, parent)).json()).accountProfile.personalRecords.reactionTestBestMs).toBe(220);
    expect(await (await api('/api/reaction-test/leaderboard')).json()).toEqual({ entries: [] });
    expect((await (await api('/api/user-data', parent)).json()).accountProfile.personalRecords?.reactionTestBestMs).toBeUndefined();
    for (const activityType of ['get-pulled', 'explore', 'bmx-race', 'straight-sprint']) {
      const detailKey = ['get-pulled', 'explore'].includes(activityType) ? 'riders' : 'summaries';
      const metrics = { playerId: 1, riderId: 'forged', studioRiderId: 'forged', name: 'forged', riderName: 'forged',
        averageWatts: 300, peakWatts: 900, topWatts: 900, averageCadence: 90, peakCadence: 110, topCadence: 110,
        averageSpeedKph: 20, peakSpeedKph: 30, topSpeedKph: 30, distanceMeters: 50, finishTimeMs: 6000, rank: 1 };
      const response = await api('/api/club-tablet/training-sessions', undefined, { localPlayerId: 1,
        session: { id: `family-tablet-${activityType}`, activityType, title: activityType, startedAt: now - 6000,
          endedAt: now, durationMs: 6000, distanceMeters: 50, trackId: 'family-track', trackName: 'Family track',
          details: { durationSeconds: 6, airSetting: 7, [detailKey]: [metrics,
            { ...metrics, playerId: 2, riderId: roster[1].id, name: 'SIBLING SECRET', averageWatts: 600 }] } } },
      'POST', { 'X-TrackLab-Club-Tablet-Session': tablet.sessionToken });
      const saved = await response.json();
      expect(response.status, JSON.stringify(saved)).toBe(201);
      expect(saved.session.details[detailKey]).toHaveLength(1);
    }
    const aHistory = await (await api(`/api/family/children/${a.id}/training-sessions?from=0`, parent)).json();
    const bHistory = await (await api(`/api/family/children/${b.id}/training-sessions?from=0`, parent)).json();
    expect(aHistory.sessions).toHaveLength(4);
    expect(aHistory.rangeComplete).toBe(true);
    const cappedHistory = await (await api(`/api/family/children/${a.id}/training-sessions?from=0&limit=1`, parent)).json();
    expect(cappedHistory.sessions).toHaveLength(1);
    expect(cappedHistory.rangeComplete).toBe(false);
    expect(bHistory.sessions).toHaveLength(0);
    expect(JSON.stringify(aHistory)).not.toContain('SIBLING SECRET');
    expect(aHistory.sessions.filter((entry: any) => entry.activityType !== 'explore')
      .every((entry: any) => JSON.stringify(entry).includes('900'))).toBe(true);
    expect(aHistory.sessions.find((entry: any) => entry.activityType === 'explore').details.riders)
      .toEqual([expect.objectContaining({ studioRiderId: roster[0].id, distanceMeters: 50 })]);
    expect((await (await api(`/api/family/children/${a.id}/profile`, parent)).json()).accountProfile.personalRecords.getPulledMaxWatts).toBe(900);

    // Club owner data is an authority of its own. Delegating that account must
    // not delegate its roster, while a group record still projects one child.
    const login = await api('/api/auth/login', undefined, { email: 'family-club@tracklab.test', password: 'tracklab-family-test-password' });
    expect(login.status).toBe(200);
    owner.cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await (await api('/api/user-data', owner)).json()).studioRiders)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: roster[0].id,
        personalRecords: expect.objectContaining({ reactionTestBestMs: 90 }) })]));
    expect((await api('/api/training-sessions', owner, { session: {
      id: 'family-group-record', activityType: 'bmx-race', title: 'Group record', startedAt: now - 6000,
      endedAt: now, durationMs: 6000, distanceMeters: 50,
      details: { summaries: [{ playerId: 1, riderId: roster[0].id, riderName: 'Child A', topWatts: 901 },
        { playerId: 2, riderId: roster[1].id, riderName: 'Child B', topWatts: 602 }] },
    } })).status).toBe(201);
    for (const [child, watts] of [[a, 901], [b, 602]]) {
      const history = await (await api(`/api/family/children/${child.id}/training-sessions?from=0`, parent)).json();
      const group = history.sessions.find((entry: any) => entry.id.endsWith('family-group-record'));
      expect(group.details.summaries).toEqual([expect.objectContaining({ topWatts: watts })]);
    }
    const ownerLink = await invitation(parent);
    expect((await api('/api/family/link-invites/accept', owner, { token: ownerLink.token, activityConsent: true })).status).toBe(200);
    const ownerSubject = (await (await api('/api/family', parent)).json()).children.find((entry: any) => entry.kind === 'linked');
    const ownerFamilyHistory = await (await api(`/api/family/children/${ownerSubject.id}/training-sessions?from=0`, parent)).json();
    expect(ownerFamilyHistory.sessions).toHaveLength(0);

    const c = await managed(parent, 'Child C');
    const thirdRider = { id: 'family-roster-c', name: 'Child C', createdAt: now, updatedAt: now };
    expect((await api('/api/user-data', owner, { studioRiders: [...roster, thirdRider] }, 'PATCH')).status).toBe(200);
    const unclaimedInvite = await (await api('/api/club-connect/invites', owner, { studioRiderId: thirdRider.id })).json();
    const secondDeviceResponse = await api('/api/club-tablet/devices', owner, { name: 'Pre-claim family tablet' });
    expect(secondDeviceResponse.status).toBe(201);
    const secondDevice = await secondDeviceResponse.json();
    const unclaimedTabletResponse = await api('/api/club-tablet/sessions', undefined,
      { studioRiderId: thirdRider.id, bikeDeviceId: 'FamilyWattbike702' }, 'POST', { Authorization: `Bearer ${secondDevice.deviceToken}` });
    expect(unclaimedTabletResponse.status).toBe(201);
    const unclaimedTablet = await unclaimedTabletResponse.json();
    const unclaimedSave = await api('/api/club-tablet/training-sessions', undefined, { localPlayerId: 1,
      session: { id: 'family-preclaim', activityType: 'bmx-race', title: 'Before claiming', startedAt: now - 6000,
        endedAt: now, durationMs: 6000, distanceMeters: 50, trackId: 'family-track', trackName: 'Family track',
        details: { summaries: [{ playerId: 1, riderName: 'Child C', finishTimeMs: 6000, distanceMeters: 50,
          topWatts: 700, averageWatts: 400, topCadence: 100, averageCadence: 80, topSpeedKph: 25, averageSpeedKph: 20 }] } } },
    'POST', { 'X-TrackLab-Club-Tablet-Session': unclaimedTablet.sessionToken });
    expect(unclaimedSave.status, await unclaimedSave.text()).toBe(201);
    expect((await api(`/api/family/children/${c.id}/club-claim`, parent, { token: unclaimedInvite.token })).status).toBe(200);
    const preclaimHistory = await (await api(`/api/family/children/${c.id}/training-sessions?from=0`, parent)).json();
    expect(preclaimHistory.sessions).toHaveLength(1);
    expect(preclaimHistory.totals).toMatchObject({ sessions: 1, durationMs: 6000, distanceMeters: 50 });
  });
});

it('assigns only the selected managed child and replaces only this parent session', async () => {
  const email = `device-parent-${Date.now()}@tracklab.test`;
  const parent = await register('Device Parent', email);
  const otherParent = await register('Other Parent');
  const first = await managed(parent, 'First Sibling');
  const second = await managed(parent, 'Second Sibling');
  const login = await api('/api/auth/login', undefined, { email, password: 'tracklab-family-test-password' });
  expect(login.status).toBe(200);
  const anotherPhone = { cookie: login.headers.get('set-cookie')!.split(';')[0], user: parent.user };
  const endpoint = `/api/family/children/${second.id}/assign-device`;
  expect((await api(endpoint, undefined, { confirm: true })).status).toBe(401);
  expect((await api(endpoint, otherParent, { confirm: true })).status).toBe(404);
  expect((await api(endpoint, parent, { confirm: false })).status).toBe(400);
  const response = await api(endpoint, parent, { confirm: true });
  expect(response.status, await response.clone().text()).toBe(200);
  const user = (await response.json()).user;
  expect(user).toMatchObject({ name: 'Second Sibling', managedChild: true, profileKey: `family-child:${second.id}` });
  const child = { cookie: response.headers.get('set-cookie')!.split(';')[0], user };
  expect((await api('/api/family', child)).status).toBe(403);
  expect((await api(`/api/family/children/${first.id}/profile`, child)).status).toBe(403);
  expect((await api('/api/family', parent)).status).toBe(401);
  expect((await api('/api/family', anotherPhone)).status).toBe(200);
});
