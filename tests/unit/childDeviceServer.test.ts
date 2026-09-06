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
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATABASE_URL: process.env.TRACKLAB_CHILD_TEST_DATABASE_URL || '', OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'child-device-club@tracklab.test', TRACKLAB_APPLE_IAP_ENABLED: '0', TRACKLAB_APPLE_ONLY_CUTOVER: '0' },
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

async function phoneLink(parent: Account, childId: string) {
  const response = await api(`/api/family/children/${childId}/device-invite`, parent, {});
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return new URLSearchParams(new URL(body.url).hash.slice(1)).get('childDevice');
}
async function setupPhone(token: string | null, headers = {}) {
  const response = await api('/api/auth/child-device/accept', undefined, { token, confirm: true }, 'POST', headers);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', user: body.user, token: body.nativeSessionToken };
}

describe('parent-approved child phones', () => {
  it('records as the existing child profile and syncs to the parent without crossing siblings', async () => {
    const parent = await register('Guardian');
    const [first, second] = await Promise.all([managed(parent, 'Avery'), managed(parent, 'Elliot')]);
    const token = await phoneLink(parent, first.id);
    expect((await api('/api/auth/child-device/accept', parent, { token, confirm: true })).status).toBe(409);
    expect((await api('/api/auth/child-device/accept', undefined, { token })).status).toBe(400);
    const phone = await setupPhone(token);
    expect(phone.user).toMatchObject({ name: 'Avery', profileKey: `family-child:${first.id}`, email: '', managedChild: true, admin: false });
    expect((await api('/api/auth/child-device/accept', undefined, { token, confirm: true })).status).toBe(409);
    expect((await api('/api/family', phone)).status).toBe(403);
    const now = Date.now();
    expect((await api('/api/user-data', phone, { accountProfile: { personalRecords: { reactionTestBestMs: 105 }, updatedAt: now } }, 'PATCH')).status).toBe(200);
    const saved = await api('/api/training-sessions', phone, { session: { id: 'child-phone-home-ride', activityType: 'explore', title: 'Avery home ride', startedAt: now - 10000, endedAt: now, durationMs: 10000, distanceMeters: 80, details: {} } });
    expect(saved.status, await saved.text()).toBe(201);
    expect((await (await api(`/api/family/children/${first.id}/training-sessions?from=0`, parent)).json()).sessions.map((item: any) => item.id)).toContain('child-phone-home-ride');
    expect((await (await api(`/api/family/children/${second.id}/training-sessions?from=0`, parent)).json()).sessions).toHaveLength(0);
    expect((await (await api('/api/training-sessions?from=0', parent)).json()).sessions).toHaveLength(0);
    expect((await (await api('/api/auth/me', parent)).json()).user.name).toBe('Guardian');
    expect((await (await api('/api/auth/me', phone)).json()).user.profileKey).toBe(`family-child:${first.id}`);
    const anotherPhone = await setupPhone(await phoneLink(parent, first.id));
    expect((await (await api('/api/training-sessions?from=0', anotherPhone)).json()).sessions).toHaveLength(1);
    expect((await api(`/api/family/children/${first.id}/devices`, parent, undefined, 'DELETE')).status).toBe(200);
    for (const device of [phone, anotherPhone]) expect((await (await api('/api/auth/me', device)).json()).user).toBeNull();
    expect((await (await api(`/api/family/children/${first.id}/training-sessions?from=0`, parent)).json()).sessions).toHaveLength(1);
  });

  it('claims old studio invitations as parent or adult without replacing any other account', async () => {
    const owner = await register('Child Studio', 'child-device-club@tracklab.test');
    const parent = await register('Studio parent');
    const adult = await register('Adult athlete');
    const now = Date.now();
    const roster = [{ id: 'child-claim-roster', name: 'Club child', createdAt: now, updatedAt: now, personalRecords: { reactionTestBestMs: 119 } },
      { id: 'adult-claim-roster', name: 'Adult athlete', createdAt: now, updatedAt: now }];
    expect((await api('/api/user-data', owner, { studioRiders: roster }, 'PATCH')).status).toBe(200);
    const childInvite = await (await api('/api/club-connect/invites', owner, { studioRiderId: roster[0].id })).json();
    const before = (await (await api('/api/family', parent)).json()).children.length;
    expect((await api('/api/family/club-claim', parent, { token: childInvite.token, name: 'Club child' })).status).toBe(400);
    const claimed = await api('/api/family/club-claim', parent, { token: childInvite.token, name: 'Club child', guardianConsent: true });
    expect(claimed.status, JSON.stringify(await claimed.clone().json())).toBe(201);
    const child = (await claimed.json()).child;
    const phone = await setupPhone(await phoneLink(parent, child.id));
    expect((await (await api('/api/club-connect', phone)).json()).memberships).toEqual(expect.arrayContaining([expect.objectContaining({ studioRiderId: roster[0].id })]));
    expect((await (await api(`/api/family/children/${child.id}/profile`, parent)).json()).accountProfile.personalRecords.reactionTestBestMs).toBe(119);
    expect((await api('/api/family/club-claim', parent, { token: childInvite.token, name: 'Duplicate', guardianConsent: true })).status).toBe(409);
    expect((await (await api('/api/family', parent)).json()).children).toHaveLength(before + 1);
    const adultInvite = await (await api('/api/club-connect/invites', owner, { studioRiderId: roster[1].id })).json();
    expect((await api('/api/club-connect/claim', adult, { token: adultInvite.token, fullName: 'Adult athlete' })).status).toBe(200);
    expect((await (await api('/api/auth/me', parent)).json()).user.name).toBe('Studio parent');
    expect((await (await api('/api/club-connect', owner)).json()).ownedClub.members).toEqual(expect.arrayContaining([expect.objectContaining({ studioRiderId: roster[0].id, status: 'claimed' }), expect.objectContaining({ studioRiderId: roster[1].id, status: 'claimed' })]));
    await verifyChildWatchStudio(owner, parent, phone, roster[0].id, roster[1].id);
  });

  it('invalidates replaced, archived and canceled invitations and rejects another parent', async () => {
    const parent = await register('Device parent');
    const stranger = await register('Unrelated adult');
    const child = await managed(parent, 'Protected child');
    expect((await api(`/api/family/children/${child.id}/device-invite`, stranger, {})).status).toBe(404);
    const old = await phoneLink(parent, child.id);
    const current = await phoneLink(parent, child.id);
    expect((await api('/api/auth/child-device/preview', undefined, { token: old })).status).toBe(409);
    const phone = await setupPhone(current);
    const pending = await phoneLink(parent, child.id);
    expect((await api(`/api/family/children/${child.id}`, parent, undefined, 'DELETE')).status).toBe(200);
    expect((await (await api('/api/auth/me', phone)).json()).user).toBeNull();
    expect((await api(`/api/family/children/${child.id}/restore`, parent, {})).status).toBe(200);
    expect((await (await api('/api/auth/me', phone)).json()).user).toBeNull();
    expect((await api('/api/auth/child-device/preview', undefined, { token: pending })).status).toBe(409);
  });

  it('returns a child-only native credential without setting a parent/browser cookie', async () => {
    const parent = await register('Native parent');
    const child = await managed(parent, 'Native child');
    const phone = await setupPhone(await phoneLink(parent, child.id), { Origin: 'capacitor://localhost', 'X-TrackLab-Native-Session': '1' });
    expect(phone.cookie).toBe('');
    expect(phone.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const result = await api('/api/auth/me', undefined, undefined, 'GET', { Origin: 'capacitor://localhost', 'X-TrackLab-Native-Session': '1', Authorization: `Bearer ${phone.token}` });
    expect((await result.json()).user).toMatchObject({ managedChild: true, name: 'Native child' });
  });
});

async function verifyChildWatchStudio(owner: Account, parent: Account, phone: Account, studioRiderId: string, otherRiderId: string) {
  const membership = (await (await api('/api/club-connect', phone)).json()).memberships[0];
  const installId = `wci_${'b'.repeat(64)}`;
  const enrolled = await api('/api/heart-rate/watch-connect/enrollments', phone, {
    requestId: `child-studio-enroll_${'x'.repeat(32)}`, installId, scope: 'studio', clubId: membership.clubId,
    liveStudioConsent: true, sessionStudioConsent: true,
  });
  expect(enrolled.status, await enrolled.clone().text()).toBe(201);
  const enrollment = (await enrolled.json()).enrollment;
  expect(enrollment.studioRiderId).toBe(studioRiderId);
  const connectedResponse = await api('/api/heart-rate/watch-connect/connections', phone, {
    requestId: `child-studio-connect_${'x'.repeat(32)}`, enrollmentId: enrollment.id, installId,
  });
  expect(connectedResponse.status, await connectedResponse.clone().text()).toBe(201);
  const connected = await connectedResponse.json();
  const watchHeaders = { Authorization: `Bearer ${connected.credentials.ingestToken}` };
  const now = Date.now();
  const streamResponse = await api('/api/heart-rate/streams', undefined, { startedAt: now }, 'POST', watchHeaders);
  expect(streamResponse.status, await streamResponse.clone().text()).toBe(201);
  const stream = (await streamResponse.json()).stream;
  expect((await api(`/api/heart-rate/streams/${stream.id}/samples`, undefined, { samples: [{ sequence: 0, recordedAt: now, activeElapsedMs: 0, bpm: 152 }] }, 'POST', watchHeaders)).status).toBe(200);
  const device = await (await api('/api/club-tablet/devices', owner, { name: 'Child Watch tablet' })).json();
  const tabletResponse = await api('/api/club-tablet/sessions', undefined, { studioRiderId, bikeDeviceId: 'ChildWatchBike1' }, 'POST', { Authorization: `Bearer ${device.deviceToken}` });
  expect(tabletResponse.status, await tabletResponse.clone().text()).toBe(201);
  const tablet = await tabletResponse.json();
  const headers = { 'X-TrackLab-Club-Tablet-Session': tablet.sessionToken };
  const live = await api('/api/heart-rate/watch-connect/tablet-live', undefined, undefined, 'GET', headers);
  expect(live.status, await live.clone().text()).toBe(200);
  expect(await live.json()).toMatchObject({ reading: { studioRiderId, bpm: 152 } });
  expect((await (await api('/api/heart-rate/watch-connect', parent)).json()).enrollments).toHaveLength(0);
  const otherResponse = await api('/api/club-tablet/sessions', undefined, { studioRiderId: otherRiderId, bikeDeviceId: 'ChildWatchBike1' }, 'POST', { Authorization: `Bearer ${device.deviceToken}` });
  expect(otherResponse.status, await otherResponse.clone().text()).toBe(201);
  const other = await otherResponse.json();
  expect((await (await api('/api/heart-rate/watch-connect/tablet-live', undefined, undefined, 'GET', { 'X-TrackLab-Club-Tablet-Session': other.sessionToken })).json()).reading).toBeNull();
  expect((await api('/api/heart-rate/watch-connect/tablet-live', undefined, undefined, 'GET', headers)).status).toBe(401);
  const endedAt = Date.now();
  const saved = await api('/api/training-sessions', phone, {
    clubSession: { clubId: membership.clubId, studioRiderId },
    session: { id: 'child-watch-studio-workout', activityType: 'straight-sprint', title: 'Child studio workout',
      startedAt: now, endedAt, durationMs: endedAt - now, distanceMeters: 10, source: 'live', createdAt: now,
      details: { summaries: [{ playerId: 1, finishTimeMs: endedAt - now }], activeClockSegments: [{ startedAt: now, endedAt, activeElapsedAtStartMs: 0 }] } },
  });
  expect(saved.status, await saved.clone().text()).toBe(201);
  expect((await saved.json()).heartRate).toMatchObject({ status: 'created' });
  // Enrolling a shared tablet intentionally ends its owner-browser session.
  const ownerLogin = await api('/api/auth/login', undefined, { email: 'child-device-club@tracklab.test', password: 'tracklab-family-test-password' });
  expect(ownerLogin.status).toBe(200);
  const currentOwner = { ...owner, cookie: ownerLogin.headers.get('set-cookie')!.split(';')[0] };
  const studioHistory = await api(`/api/heart-rate/club-streams?clubId=${membership.clubId}&sessionId=child-watch-studio-workout&studioRiderId=${studioRiderId}`, currentOwner);
  expect(studioHistory.status).toBe(200);
  expect((await studioHistory.json()).segments).toHaveLength(1);
  const erased = await api('/api/auth/account', parent, { confirmation: 'DELETE', password: 'tracklab-family-test-password' }, 'DELETE');
  expect(erased.status, await erased.clone().text()).toBe(200);
  expect((await (await api('/api/auth/me', phone)).json()).user).toBeNull();
  expect((await api(`/api/heart-rate/streams/${stream.id}/samples`, undefined, { samples: [{ sequence: 1, recordedAt: Date.now(), activeElapsedMs: 1000, bpm: 151 }] }, 'POST', watchHeaders)).status).toBe(401);
}
