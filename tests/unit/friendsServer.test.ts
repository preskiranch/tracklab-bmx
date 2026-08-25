import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
const officialBootstrapToken = 'friends-test-official-bootstrap-token-0001';
const testEventStreams = new Set<AbortController>();
const testSockets = new Set<WebSocket>();

type TestEventStream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

type TestSocket = {
  socket: WebSocket;
  messages: Array<Record<string, any>>;
};

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
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Friends test server did not become healthy.');
}

async function request(
  pathname: string,
  options: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Origin: baseUrl,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function register(email: string, name: string, forwardedFor = '') {
  const official = ['preskiranch@gmail.com', 'rasheen25@gmail.com'].includes(email.toLowerCase());
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { email, name, password: 'friends-test-password' },
    ...((official || forwardedFor) ? { headers: {
      ...(official ? { 'X-TrackLab-Official-Bootstrap-Token': officialBootstrapToken } : {}),
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
    } } : {}),
  });
  expect(response.status).toBe(201);
  const cookie = String(response.headers.get('set-cookie')).split(';')[0];
  const body = await response.json() as { user: { id: string; username: string } };
  return { cookie, user: body.user };
}

async function login(email: string) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'friends-test-password' },
  });
  expect(response.status).toBe(200);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function openFriendEventStream(authCookie: string): Promise<TestEventStream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/friends/events`, {
    headers: { Cookie: authCookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-accel-buffering')).toBe('no');
  if (!response.body) throw new Error('Friend event stream did not include a body.');
  testEventStreams.add(controller);
  return { controller, reader: response.body.getReader(), decoder: new TextDecoder(), buffer: '' };
}

async function waitForFriendGraphEvent(stream: TestEventStream, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.*)$/m)?.[1]?.trim();
      if (event === 'graph-invalidated') {
        return { block, data: data ? JSON.parse(data) : null };
      }
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for graph-invalidated.')), remaining);
      }),
    ]);
    if (chunk.done) throw new Error('Friend event stream ended before graph-invalidated.');
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
  throw new Error('Timed out waiting for graph-invalidated.');
}

async function expectNoFriendGraphEvent(stream: TestEventStream, timeoutMs = 250) {
  await expect(waitForFriendGraphEvent(stream, timeoutMs)).rejects.toThrow(
    /Timed out waiting for graph-invalidated/,
  );
}

function closeFriendEventStream(stream: TestEventStream) {
  stream.controller.abort();
  testEventStreams.delete(stream.controller);
}

async function openTestSocket(authCookie: string): Promise<TestSocket> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/multiplayer`, {
    headers: { Cookie: authCookie, Origin: baseUrl },
  });
  const state: TestSocket = { socket, messages: [] };
  testSockets.add(socket);
  socket.on('message', (data) => {
    try {
      state.messages.push(JSON.parse(data.toString()));
    } catch {
      // Ignore non-JSON test frames.
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return state;
}

async function waitForSocketMessage(
  state: TestSocket,
  predicate: (message: Record<string, any>) => boolean,
  startAt = 0,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = state.messages.slice(startAt).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for WebSocket message. Seen: ${JSON.stringify(state.messages.slice(startAt))}`);
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TRACKLAB_ADMIN_EMAILS: 'preskiranch@gmail.com,rasheen25@gmail.com',
      TRACKLAB_OFFICIAL_ACCOUNT_BOOTSTRAP_TOKEN: officialBootstrapToken,
      TRACKLAB_FRIEND_PRESENCE_LEASE_MS: '2000',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  testEventStreams.forEach((controller) => controller.abort());
  testEventStreams.clear();
  testSockets.forEach((socket) => socket.terminate());
  testSockets.clear();
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('authenticated Friends API', () => {
  it('supports private discovery, offline requests, official defaults, safe invitations, and moderation', async () => {
    expect((await request('/api/friends')).status).toBe(401);

    const alice = await register('alice-friends@tracklab.test', 'Alice Rider');
    const alicePrivacy = await json(await request('/api/friends/privacy', { cookie: alice.cookie }));
    expect(alicePrivacy).toEqual({
      privacy: {
        discoverable: false,
        profile: {
          id: alice.user.id,
          handle: alice.user.username,
          displayName: 'Alice Rider',
        },
      },
    });
    const emptyFriends = await json(await request('/api/friends?limit=20', { cookie: alice.cookie }));
    expect(emptyFriends).toEqual({ items: [], nextCursor: null, total: 0, onlineTotal: 0 });

    const bob = await register('bob-friends@tracklab.test', 'Bob Rider');
    let response = await request('/api/friends/requests', {
      cookie: alice.cookie,
      method: 'POST',
      body: { profileId: bob.user.id, clientRequestId: '00000000-0000-4000-8000-000000000001' },
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('ratelimit-limit')).toBe('20');
    expect((await json(await request('/api/friends/requests?direction=outgoing', { cookie: alice.cookie }))).total).toBe(0);
    response = await request('/api/friends/search?q=bob&limit=20', { cookie: alice.cookie });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ items: [], total: 0 });

    response = await request('/api/friends/privacy', {
      cookie: bob.cookie,
      method: 'PATCH',
      body: { discoverable: true },
    });
    expect(response.status).toBe(200);
    expect(await json(await request('/api/friends/privacy', { cookie: bob.cookie }))).toMatchObject({
      privacy: { discoverable: true, profile: { id: bob.user.id } },
    });

    response = await request(`/api/friends/search?q=${encodeURIComponent(`@${bob.user.username}`)}&limit=20`, { cookie: alice.cookie });
    const search = await json(response);
    expect(search.items).toEqual([expect.objectContaining({
      id: bob.user.id,
      handle: bob.user.username,
      displayName: 'Bob Rider',
      relationship: 'none',
    })]);
    expect(JSON.stringify(search)).not.toContain('bob-friends@tracklab.test');
    expect(search.items[0]).not.toHaveProperty('email');

    const offlineRequestId = '11111111-1111-4111-8111-111111111111';
    response = await request('/api/friends/requests', {
      cookie: alice.cookie,
      method: 'POST',
      body: { profileId: bob.user.id, clientRequestId: offlineRequestId },
    });
    expect(response.status).toBe(201);
    expect((await json(response)).request).toMatchObject({
      id: offlineRequestId,
      direction: 'outgoing',
      profile: { id: bob.user.id, relationship: 'outgoing-request' },
    });
    // Offline replay uses the client request id instead of creating duplicates.
    expect((await request('/api/friends/requests', {
      cookie: alice.cookie,
      method: 'POST',
      body: { profileId: bob.user.id, clientRequestId: offlineRequestId },
    })).status).toBe(201);

    const incoming = await json(await request('/api/friends/requests?direction=incoming&limit=1', { cookie: bob.cookie }));
    expect(incoming).toMatchObject({
      total: 1,
      nextCursor: null,
      items: [{
        id: offlineRequestId,
        direction: 'incoming',
        profile: expect.objectContaining({ id: alice.user.id, relationship: 'incoming-request' }),
      }],
    });
    expect((await json(await request('/api/friends/requests?direction=incoming&q=Alice', { cookie: bob.cookie }))).total).toBe(1);
    expect((await request(`/api/friends/requests/${offlineRequestId}/accept`, {
      cookie: bob.cookie,
      method: 'POST',
    })).status).toBe(200);
    expect((await request('/api/user-data', {
      cookie: bob.cookie,
      method: 'PATCH',
      body: { accountProfile: { photoUrl: 'data:image/png;base64,QUJDRA==', updatedAt: 100 } },
    })).status).toBe(200);
    expect((await request('/api/user-data', {
      cookie: alice.cookie,
      method: 'PATCH',
      body: { accountProfile: { photoUrl: 'data:image/png;base64,RUZHSA==', updatedAt: 100 } },
    })).status).toBe(200);

    expect((await request('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.44' },
      body: { email: 'preskiranch@gmail.com', name: 'Impostor', password: 'friends-test-password' },
    })).status).toBe(403);
    const club = await register('preskiranch@gmail.com', 'Preski Ranch BMX Club');
    const initialFriendsResponse = await request('/api/friends?limit=20', { cookie: alice.cookie });
    expect(initialFriendsResponse.headers.get('server-timing')).toMatch(
      /^auth;dur=\d+\.\d, friends;dur=\d+\.\d$/,
    );
    let aliceFriends = await json(initialFriendsResponse);
    expect(aliceFriends.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: bob.user.id,
        relationship: 'friend',
        photoUrl: 'data:image/png;base64,QUJDRA==',
      }),
      expect.objectContaining({
        id: club.user.id,
        officialKind: 'club',
        online: false,
        available: false,
        hasGhost: false,
      }),
    ]));
    const clubFriends = await json(await request('/api/friends?limit=20', { cookie: club.cookie }));
    const officialDefaultAlice = clubFriends.items.find((friend: any) => friend.id === alice.user.id);
    expect(officialDefaultAlice).toMatchObject({ online: false, available: false, hasGhost: false });
    expect(officialDefaultAlice).not.toHaveProperty('photoUrl');
    expect(JSON.stringify(aliceFriends)).not.toContain('preskiranch@gmail.com');
    expect((await json(await request('/api/friends?q=Bob', { cookie: alice.cookie }))).items)
      .toEqual([expect.objectContaining({ id: bob.user.id })]);

    const privateTrackId = 'official-private-ghost-track';
    response = await request('/api/ghosts', {
      cookie: club.cookie,
      method: 'POST',
      body: {
        ghost: {
          id: 'official-private-ghost',
          trackId: privateTrackId,
          trackName: 'Private Official Track',
          riderName: 'Official Club Rider',
          raceSource: 'live',
          finishTimeMs: 10_000,
          analyticsPublic: false,
          points: [
            { elapsedMs: 0, distanceMeters: 0 },
            { elapsedMs: 10_000, distanceMeters: 100 },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    const officialGhosts = await json(await request(`/api/ghosts?trackId=${privateTrackId}`, { cookie: alice.cookie }));
    const anonymousOfficialGhosts = await json(await request(`/api/ghosts?trackId=${privateTrackId}`));
    expect(officialGhosts.ghosts).toEqual(anonymousOfficialGhosts.ghosts);
    expect(officialGhosts.ghosts).toEqual([
      expect.objectContaining({ source: 'top', summary: null, zoneResults: [] }),
    ]);
    const explicitClubInvite = await json(await request('/api/friends/invites', {
      cookie: club.cookie,
      method: 'POST',
    }));
    const explicitClubInviteToken = new URL(explicitClubInvite.invite.inviteUrl).searchParams.get('friendInvite');
    expect((await request('/api/friends/invites/claim', {
      cookie: alice.cookie,
      method: 'POST',
      body: { token: explicitClubInviteToken },
    })).status).toBe(200);
    const explicitOfficialGhosts = await json(await request(`/api/ghosts?trackId=${privateTrackId}`, {
      cookie: alice.cookie,
    }));
    expect(explicitOfficialGhosts.ghosts).toEqual([
      expect.objectContaining({ source: 'friend', summary: null, zoneResults: [] }),
    ]);

    const recentGhostTrackId = 'recent-official-friend-ghost-track';
    expect((await request('/api/ghosts', {
      cookie: club.cookie,
      method: 'POST',
      body: {
        ghost: {
          id: 'recent-official-friend-ghost',
          trackId: recentGhostTrackId,
          trackName: 'Recent Friend Sprint',
          riderName: 'Official Club Rider',
          raceSource: 'live',
          sprintDistanceFeet: 500,
          sprintAirSetting: 5,
          finishTimeMs: 20_000,
          savedAt: 4_000_000_000_000,
          summary: { averageWatts: 999, sprintDistanceFeet: 500, sprintAirSetting: 5 },
          zoneResults: [{ zoneId: 'private-zone', riders: [] }],
          points: [
            { elapsedMs: 0, distanceMeters: 0 },
            { elapsedMs: 20_000, distanceMeters: 152.4 },
          ],
        },
      },
    })).status).toBe(200);
    aliceFriends = await json(await request('/api/friends?limit=20', { cookie: alice.cookie }));
    const explicitClubFriend = aliceFriends.items.find((friend: any) => friend.id === club.user.id);
    expect(explicitClubFriend).toMatchObject({
      hasGhost: true,
      ghostPreview: {
        id: 'recent-official-friend-ghost',
        trackId: recentGhostTrackId,
        trackName: 'Recent Friend Sprint',
        lapCount: 1,
        sprintDistanceFeet: 500,
        sprintAirSetting: 5,
        finishTimeMs: 20_000,
      },
    });
    expect(explicitClubFriend.ghostPreview).not.toHaveProperty('summary');
    expect(explicitClubFriend.ghostPreview).not.toHaveProperty('zoneResults');
    expect(explicitClubFriend.ghostPreview).not.toHaveProperty('points');

    const officialReconciliationStream = await openFriendEventStream(alice.cookie);
    const founder = await register('rasheen25@gmail.com', 'Rasheen Hicks');
    expect(await waitForFriendGraphEvent(officialReconciliationStream)).toEqual({
      block: 'event: graph-invalidated\ndata: {}',
      data: {},
    });
    closeFriendEventStream(officialReconciliationStream);
    const founderInvite = await json(await request('/api/friends/invites', {
      cookie: founder.cookie,
      method: 'POST',
    }));
    const founderInviteToken = new URL(founderInvite.invite.inviteUrl).searchParams.get('friendInvite');
    expect((await request('/api/friends/invites/claim', {
      cookie: alice.cookie,
      method: 'POST',
      body: { token: founderInviteToken },
    })).status).toBe(200);

    const focusedTrackId = 'friend-ghost-beyond-world-top';
    expect((await request('/api/ghosts', {
      cookie: founder.cookie,
      method: 'POST',
      body: {
        ghost: {
          id: 'focused-slower-friend-ghost',
          trackId: focusedTrackId,
          trackName: 'Focused Friend Track',
          riderName: 'Founder Rider',
          raceSource: 'live',
          finishTimeMs: 90_000,
          points: [
            { elapsedMs: 0, distanceMeters: 0 },
            { elapsedMs: 90_000, distanceMeters: 300 },
          ],
        },
      },
    })).status).toBe(200);
    const fasterGlobalSaves = await Promise.all(Array.from({ length: 50 }, (_, index) => request('/api/ghosts', {
      cookie: club.cookie,
      method: 'POST',
      body: {
        ghost: {
          id: `faster-global-ghost-${index}`,
          trackId: focusedTrackId,
          trackName: 'Focused Friend Track',
          riderName: `Faster Global Rider ${index}`,
          raceSource: 'live',
          finishTimeMs: 10_000 + index,
          points: [
            { elapsedMs: 0, distanceMeters: 0 },
            { elapsedMs: 10_000 + index, distanceMeters: 300 },
          ],
        },
      },
    })));
    expect(fasterGlobalSaves.every((save) => save.status === 200)).toBe(true);

    const defaultOfficialView = await json(await request(`/api/ghosts?trackId=${focusedTrackId}`, {
      cookie: bob.cookie,
    }));
    expect(defaultOfficialView.ghosts).toHaveLength(50);
    expect(defaultOfficialView.ghosts.some((ghost: any) => ghost.id === 'focused-slower-friend-ghost')).toBe(false);
    const focusedFriendView = await json(await request(
      `/api/ghosts?trackId=${focusedTrackId}&friendGhostId=focused-slower-friend-ghost&friendProfileId=${encodeURIComponent(founder.user.id)}`,
      { cookie: alice.cookie },
    ));
    expect(focusedFriendView.ghosts).toHaveLength(51);
    expect(focusedFriendView.ghosts).toContainEqual(expect.objectContaining({
      id: 'focused-slower-friend-ghost',
      ownerKey: `user:${founder.user.id}`,
      source: 'friend',
      summary: null,
      zoneResults: [],
    }));

    aliceFriends = await json(await request('/api/friends?limit=1', { cookie: alice.cookie }));
    expect(aliceFriends.total).toBe(3);
    expect(aliceFriends.items).toHaveLength(1);
    expect(aliceFriends.nextCursor).toEqual(expect.any(String));
    const secondPage = await json(await request(`/api/friends?limit=1&cursor=${encodeURIComponent(aliceFriends.nextCursor)}`, {
      cookie: alice.cookie,
    }));
    expect(secondPage.items).toHaveLength(1);
    const outOfRangeCursor = Buffer.from(JSON.stringify({ version: 1, offset: 999 }), 'utf8').toString('base64url');
    const outOfRangePage = await json(await request(
      `/api/friends?limit=1&cursor=${encodeURIComponent(outOfRangeCursor)}`,
      { cookie: alice.cookie },
    ));
    expect(outOfRangePage).toEqual({ items: [], nextCursor: null, total: 3, onlineTotal: 0 });

    expect((await request(`/api/friends/${club.user.id}`, {
      cookie: alice.cookie,
      method: 'DELETE',
    })).status).toBe(200);
    let aliceCookie = await login('alice-friends@tracklab.test');
    aliceFriends = await json(await request('/api/friends?limit=20', { cookie: aliceCookie }));
    expect(aliceFriends.items.some((friend: any) => friend.id === club.user.id)).toBe(false);

    expect((await request('/api/friends/blocks', {
      cookie: aliceCookie,
      method: 'POST',
      body: { profileId: founder.user.id },
    })).status).toBe(201);
    let blocked = await json(await request('/api/friends/blocks', { cookie: aliceCookie }));
    expect(blocked.items).toEqual([expect.objectContaining({ id: founder.user.id, relationship: 'blocked' })]);
    expect((await request(`/api/friends/blocks/${founder.user.id}`, {
      cookie: aliceCookie,
      method: 'DELETE',
    })).status).toBe(200);
    aliceCookie = await login('alice-friends@tracklab.test');
    aliceFriends = await json(await request('/api/friends?limit=20', { cookie: aliceCookie }));
    expect(aliceFriends.items.some((friend: any) => friend.id === founder.user.id)).toBe(false);

    const charlie = await register('charlie-friends@tracklab.test', 'Charlie Rider');
    await request('/api/friends/privacy', {
      cookie: charlie.cookie,
      method: 'PATCH',
      body: { discoverable: true },
    });

    response = await request('/api/friends/invites', { cookie: bob.cookie, method: 'POST' });
    expect(response.status).toBe(201);
    const inviteEnvelope = await json(response);
    expect(inviteEnvelope.invite).toMatchObject({
      inviteUrl: expect.stringContaining('/?friendInvite='),
      qrCodeUrl: expect.stringContaining('/api/friends/invites/'),
      expiresAt: expect.any(String),
    });
    const inviteToken = new URL(inviteEnvelope.invite.inviteUrl).searchParams.get('friendInvite');
    expect(inviteToken).toMatch(/^[a-zA-Z0-9_-]{32,96}$/);

    const qrResponse = await fetch(inviteEnvelope.invite.qrCodeUrl);
    expect(qrResponse.status).toBe(200);
    expect(qrResponse.headers.get('content-type')).toContain('image/svg+xml');
    expect(await qrResponse.text()).toContain('TrackLab friend invitation QR code');

    expect((await request('/api/friends/invites/claim', {
      cookie: charlie.cookie,
      method: 'POST',
      body: { token: inviteToken },
    })).status).toBe(200);
    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(String(inviteToken))}`)).status).toBe(404);
    expect((await fetch(inviteEnvelope.invite.qrCodeUrl)).status).toBe(404);
    expect((await request('/api/friends/invites/claim', {
      cookie: aliceCookie,
      method: 'POST',
      body: { token: inviteToken },
    })).status).toBe(409);
    const selfInvite = await json(await request('/api/friends/invites', {
      cookie: bob.cookie,
      method: 'POST',
    }));
    const selfInviteToken = new URL(selfInvite.invite.inviteUrl).searchParams.get('friendInvite');
    const rotatedInvite = await json(await request('/api/friends/invites', {
      cookie: bob.cookie,
      method: 'POST',
    }));
    const rotatedInviteToken = new URL(rotatedInvite.invite.inviteUrl).searchParams.get('friendInvite');
    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(String(selfInviteToken))}`)).status).toBe(200);
    for (let inviteIndex = 0; inviteIndex < 4; inviteIndex += 1) {
      expect((await request('/api/friends/invites', { cookie: bob.cookie, method: 'POST' })).status).toBe(201);
    }
    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(String(selfInviteToken))}`)).status).toBe(404);
    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(String(rotatedInviteToken))}`)).status).toBe(200);
    expect((await request('/api/friends/invites/claim', {
      cookie: bob.cookie,
      method: 'POST',
      body: { token: rotatedInviteToken },
    })).status).toBe(409);

    const suggestions = await json(await request('/api/friends/suggestions?limit=20', { cookie: aliceCookie }));
    expect(suggestions.items).toEqual(expect.arrayContaining([
      {
        profile: expect.objectContaining({ id: charlie.user.id, relationship: 'none' }),
        reason: 'mutual-friends',
      },
    ]));

    const cancelId = '22222222-2222-4222-8222-222222222222';
    expect((await request('/api/friends/requests', {
      cookie: aliceCookie,
      method: 'POST',
      body: { profileId: charlie.user.id, clientRequestId: cancelId },
    })).status).toBe(201);
    expect((await request(`/api/friends/requests/${cancelId}/cancel`, {
      cookie: aliceCookie,
      method: 'POST',
    })).status).toBe(200);
    response = await request('/api/friends/requests', {
      cookie: aliceCookie,
      method: 'POST',
      body: {
        profileId: charlie.user.id,
        clientRequestId: '22222222-2222-4222-8222-222222222223',
      },
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      code: 'cancelled-cooldown',
      retryAt: expect.any(String),
    });

    expect((await request('/api/friends/privacy', {
      cookie: aliceCookie,
      method: 'PATCH',
      body: { discoverable: true },
    })).status).toBe(200);
    const declineId = '33333333-3333-4333-8333-333333333333';
    expect((await request('/api/friends/requests', {
      cookie: charlie.cookie,
      method: 'POST',
      body: { profileId: alice.user.id, clientRequestId: declineId },
    })).status).toBe(201);
    expect((await request(`/api/friends/requests/${declineId}/decline`, {
      cookie: aliceCookie,
      method: 'POST',
    })).status).toBe(200);
    response = await request('/api/friends/requests', {
      cookie: charlie.cookie,
      method: 'POST',
      body: {
        profileId: alice.user.id,
        clientRequestId: '33333333-3333-4333-8333-333333333334',
      },
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      code: 'declined-cooldown',
      retryAt: expect.any(String),
    });

    expect((await request('/api/friends/reports', {
      cookie: aliceCookie,
      method: 'POST',
      body: { profileId: charlie.user.id, reason: 'unsafe-behavior' },
    })).status).toBe(201);
    const blockedPendingId = '44444444-4444-4444-8444-444444444444';
    expect((await request(`/api/friends/${bob.user.id}`, {
      cookie: aliceCookie,
      method: 'DELETE',
    })).status).toBe(200);
    expect((await request('/api/friends/requests', {
      cookie: bob.cookie,
      method: 'POST',
      body: { profileId: alice.user.id, clientRequestId: blockedPendingId },
    })).status).toBe(201);
    expect((await request('/api/friends/blocks', {
      cookie: aliceCookie,
      method: 'POST',
      body: { profileId: bob.user.id },
    })).status).toBe(201);
    expect((await request(`/api/friends/requests/${blockedPendingId}/accept`, {
      cookie: aliceCookie,
      method: 'POST',
    })).status).toBe(404);
    expect((await request('/api/friends/blocks', {
      cookie: aliceCookie,
      method: 'POST',
      body: { profileId: charlie.user.id },
    })).status).toBe(201);
    response = await request('/api/friends/search?q=charlie', { cookie: aliceCookie });
    expect(await json(response)).toMatchObject({ items: [], total: 0 });

    // A shared-tablet credential must not borrow an owner cookie for social writes.
    response = await request('/api/friends/requests', {
      cookie: aliceCookie,
      method: 'POST',
      headers: { 'X-TrackLab-Club-Tablet-Session': 'stale-shared-tablet-session' },
      body: { profileId: bob.user.id },
    });
    expect(response.status).toBe(403);

    blocked = await json(await request('/api/friends/blocks', { cookie: aliceCookie }));
    expect(blocked.items.some((profile: any) => profile.id === charlie.user.id)).toBe(true);
    expect(JSON.stringify(blocked)).not.toMatch(/@gmail\.com|@tracklab\.test/);
  }, 30_000);

  it('publishes privacy-safe official presence with exact totals and first/last-stream invalidations', async () => {
    const rider = await register(
      'official-presence-rider@tracklab.test',
      'Official Presence Rider',
      '198.51.100.81',
    );
    const clubCookie = await login('preskiranch@gmail.com');
    const riderEvents = await openFriendEventStream(rider.cookie);

    const initiallyOffline = await json(await request('/api/friends?limit=1', { cookie: rider.cookie }));
    expect(initiallyOffline.onlineTotal).toBe(0);
    expect(initiallyOffline.items).toHaveLength(1);
    expect(initiallyOffline.items[0]).toMatchObject({
      officialKind: expect.stringMatching(/club|founder/),
      online: false,
    });

    const clubEventsA = await openFriendEventStream(clubCookie);
    expect(await waitForFriendGraphEvent(riderEvents)).toEqual({
      block: 'event: graph-invalidated\ndata: {}',
      data: {},
    });

    const clubOnline = await json(await request('/api/friends?limit=20', { cookie: rider.cookie }));
    expect(clubOnline.onlineTotal).toBe(1);
    expect(clubOnline.items).toContainEqual(expect.objectContaining({
      officialKind: 'club',
      online: true,
    }));

    // Presence on an auto-added official edge is intentionally asymmetric:
    // the public club may be visible, but it cannot monitor an ordinary rider.
    const clubView = await json(await request('/api/friends?limit=50', { cookie: clubCookie }));
    expect(clubView.items).toContainEqual(expect.objectContaining({
      id: rider.user.id,
      online: false,
      available: false,
    }));
    expect(clubView.onlineTotal).toBe(0);

    // Opening a second tab for the already-online club must not cause a second
    // presence transition or inflate the account-level total.
    const noSecondConnectEvent = await openFriendEventStream(rider.cookie);
    const clubEventsB = await openFriendEventStream(clubCookie);
    await expectNoFriendGraphEvent(noSecondConnectEvent);
    closeFriendEventStream(noSecondConnectEvent);
    expect((await json(await request('/api/friends?limit=20', { cookie: rider.cookie }))).onlineTotal).toBe(1);

    const noFirstCloseEvent = await openFriendEventStream(rider.cookie);
    closeFriendEventStream(clubEventsA);
    await expectNoFriendGraphEvent(noFirstCloseEvent);
    closeFriendEventStream(noFirstCloseEvent);
    expect((await json(await request('/api/friends?limit=20', { cookie: rider.cookie }))).onlineTotal).toBe(1);

    closeFriendEventStream(clubEventsB);
    expect(await waitForFriendGraphEvent(riderEvents)).toEqual({
      block: 'event: graph-invalidated\ndata: {}',
      data: {},
    });
    const finallyOffline = await json(await request('/api/friends?limit=20', { cookie: rider.cookie }));
    expect(finallyOffline.onlineTotal).toBe(0);
    expect(finallyOffline.items).toContainEqual(expect.objectContaining({
      officialKind: 'club',
      online: false,
    }));

    closeFriendEventStream(riderEvents);
  }, 30_000);

  it('retires only the exact club-owner presence session when enrolling a shared tablet', async () => {
    const observer = await register(
      'tablet-enrollment-presence@tracklab.test',
      'Tablet Enrollment Observer',
      '198.51.100.86',
    );
    const clubCookieA = await login('preskiranch@gmail.com');
    const clubCookieB = await login('preskiranch@gmail.com');
    const observerEvents = await openFriendEventStream(observer.cookie);
    const clubEventsA = await openFriendEventStream(clubCookieA);
    await waitForFriendGraphEvent(observerEvents);
    const clubSocketA = await openTestSocket(clubCookieA);
    const clubSocketAClosed = new Promise<void>((resolve) => {
      clubSocketA.socket.once('close', () => resolve());
    });
    const clubEventsB = await openFriendEventStream(clubCookieB);

    const noFirstEnrollmentOffline = await openFriendEventStream(observer.cookie);
    const firstEnrollment = await request('/api/club-tablet/devices', {
      cookie: clubCookieA,
      method: 'POST',
      body: { name: 'Presence Tablet A' },
    });
    expect(firstEnrollment.status).toBe(201);
    await clubSocketAClosed;
    testSockets.delete(clubSocketA.socket);
    await expectNoFriendGraphEvent(noFirstEnrollmentOffline);
    closeFriendEventStream(noFirstEnrollmentOffline);
    expect((await request('/api/friends', { cookie: clubCookieA })).status).toBe(401);
    expect((await request('/api/friends', { cookie: clubCookieB })).status).toBe(200);
    expect((await json(await request('/api/friends?limit=20', {
      cookie: observer.cookie,
    }))).onlineTotal).toBe(1);

    const secondEnrollment = await request('/api/club-tablet/devices', {
      cookie: clubCookieB,
      method: 'POST',
      body: { name: 'Presence Tablet B' },
    });
    expect(secondEnrollment.status).toBe(201);
    await waitForFriendGraphEvent(observerEvents);
    expect((await json(await request('/api/friends?limit=20', {
      cookie: observer.cookie,
    }))).onlineTotal).toBe(0);

    closeFriendEventStream(observerEvents);
    closeFriendEventStream(clubEventsA);
    closeFriendEventStream(clubEventsB);
  }, 30_000);

  it('keeps explicit friends online across devices and makes logout session-scoped', async () => {
    const riderA = await register(
      'presence-session-a@tracklab.test',
      'Presence Session A',
      '198.51.100.82',
    );
    const riderB = await register(
      'presence-session-b@tracklab.test',
      'Presence Session B',
      '198.51.100.83',
    );
    expect((await request('/api/friends/privacy', {
      cookie: riderB.cookie,
      method: 'PATCH',
      body: { discoverable: true },
    })).status).toBe(200);
    const requestId = '88888888-8888-4888-8888-888888888888';
    expect((await request('/api/friends/requests', {
      cookie: riderA.cookie,
      method: 'POST',
      body: { profileId: riderB.user.id, clientRequestId: requestId },
    })).status).toBe(201);
    expect((await request(`/api/friends/requests/${requestId}/accept`, {
      cookie: riderB.cookie,
      method: 'POST',
    })).status).toBe(200);

    const riderAEvents = await openFriendEventStream(riderA.cookie);
    const riderBEventsA = await openFriendEventStream(riderB.cookie);
    await waitForFriendGraphEvent(riderAEvents);
    let riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends).toMatchObject({
      onlineTotal: 1,
      total: 1,
      items: [expect.objectContaining({ id: riderB.user.id, online: true })],
    });

    // SSE and multiplayer are a union. Adding the socket while SSE is live,
    // then closing SSE while the socket remains, creates no false transition.
    const noSocketUnionEvent = await openFriendEventStream(riderA.cookie);
    const riderBFirstSessionSocket = await openTestSocket(riderB.cookie);
    await expectNoFriendGraphEvent(noSocketUnionEvent);
    closeFriendEventStream(noSocketUnionEvent);
    const noSseUnionCloseEvent = await openFriendEventStream(riderA.cookie);
    closeFriendEventStream(riderBEventsA);
    await expectNoFriendGraphEvent(noSseUnionCloseEvent);
    closeFriendEventStream(noSseUnionCloseEvent);
    riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends.onlineTotal).toBe(1);
    expect(riderAFriends.items[0]).toMatchObject({ id: riderB.user.id, online: true });

    const riderBSecondCookie = await login('presence-session-b@tracklab.test');
    const noSecondDeviceEvent = await openFriendEventStream(riderA.cookie);
    const riderBEventsB = await openFriendEventStream(riderBSecondCookie);
    await expectNoFriendGraphEvent(noSecondDeviceEvent);
    closeFriendEventStream(noSecondDeviceEvent);

    const noFirstLogoutEvent = await openFriendEventStream(riderA.cookie);
    expect((await request('/api/auth/logout', {
      cookie: riderB.cookie,
      method: 'POST',
    })).status).toBe(200);
    await expectNoFriendGraphEvent(noFirstLogoutEvent);
    closeFriendEventStream(noFirstLogoutEvent);
    riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends.onlineTotal).toBe(1);
    expect(riderAFriends.items[0]).toMatchObject({ id: riderB.user.id, online: true });

    expect((await request('/api/auth/logout', {
      cookie: riderBSecondCookie,
      method: 'POST',
    })).status).toBe(200);
    await waitForFriendGraphEvent(riderAEvents);
    riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends.onlineTotal).toBe(0);
    expect(riderAFriends.items[0]).toMatchObject({ id: riderB.user.id, online: false });
    testSockets.delete(riderBFirstSessionSocket.socket);

    // A personal-account multiplayer socket is also a live-presence source,
    // even when the rider does not currently have the Friends view open.
    const riderBWebSocketCookie = await login('presence-session-b@tracklab.test');
    const riderBSocket = await openTestSocket(riderBWebSocketCookie);
    await waitForFriendGraphEvent(riderAEvents);
    riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends.onlineTotal).toBe(1);
    expect(riderAFriends.items[0]).toMatchObject({ id: riderB.user.id, online: true });
    riderBSocket.socket.close();
    await waitForFriendGraphEvent(riderAEvents);
    riderAFriends = await json(await request('/api/friends?q=Presence%20Session%20B', {
      cookie: riderA.cookie,
    }));
    expect(riderAFriends.onlineTotal).toBe(0);
    expect(riderAFriends.items[0]).toMatchObject({ id: riderB.user.id, online: false });
    testSockets.delete(riderBSocket.socket);

    closeFriendEventStream(riderAEvents);
    closeFriendEventStream(riderBEventsA);
    closeFriendEventStream(riderBEventsB);
  }, 30_000);

  it('bounds half-open SSE presence with a renewable authenticated lease', async () => {
    const riderA = await register(
      'presence-lease-a@tracklab.test',
      'Presence Lease A',
      '198.51.100.84',
    );
    const riderB = await register(
      'presence-lease-b@tracklab.test',
      'Presence Lease B',
      '198.51.100.85',
    );
    expect((await request('/api/friends/privacy', {
      cookie: riderB.cookie,
      method: 'PATCH',
      body: { discoverable: true },
    })).status).toBe(200);
    const requestId = '99999999-9999-4999-8999-999999999999';
    expect((await request('/api/friends/requests', {
      cookie: riderA.cookie,
      method: 'POST',
      body: { profileId: riderB.user.id, clientRequestId: requestId },
    })).status).toBe(201);
    expect((await request(`/api/friends/requests/${requestId}/accept`, {
      cookie: riderB.cookie,
      method: 'POST',
    })).status).toBe(200);

    const riderAEvents = await openFriendEventStream(riderA.cookie);
    const riderBEventsA = await openFriendEventStream(riderB.cookie);
    await waitForFriendGraphEvent(riderAEvents);
    expect((await json(await request('/api/friends?q=Presence%20Lease%20B', {
      cookie: riderA.cookie,
    }))).onlineTotal).toBe(1);

    const riderBSecondCookie = await login('presence-lease-b@tracklab.test');
    const riderBEventsB = await openFriendEventStream(riderBSecondCookie);

    // A normal authenticated Friends poll renews only that exact login
    // session. It must not extend an abandoned stream from another device.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await request('/api/friends?limit=1', { cookie: riderBSecondCookie })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect((await json(await request('/api/friends?q=Presence%20Lease%20B', {
      cookie: riderA.cookie,
    }))).onlineTotal).toBe(1);

    const noFalseSessionExpiryEvent = await openFriendEventStream(riderA.cookie);
    await expectNoFriendGraphEvent(noFalseSessionExpiryEvent);
    closeFriendEventStream(noFalseSessionExpiryEvent);

    // The active second session kept the account online, but once it closes,
    // the expired first stream cannot keep the account falsely green.
    closeFriendEventStream(riderBEventsB);
    await waitForFriendGraphEvent(riderAEvents);
    const expired = await json(await request('/api/friends?q=Presence%20Lease%20B', {
      cookie: riderA.cookie,
    }));
    expect(expired.onlineTotal).toBe(0);
    expect(expired.items[0]).toMatchObject({ id: riderB.user.id, online: false });

    closeFriendEventStream(riderAEvents);
    closeFriendEventStream(riderBEventsA);
    closeFriendEventStream(riderBEventsB);
  }, 30_000);

  it('closes SSE and WebSocket presence at the exact authentication-session deadline', async () => {
    const expiryPort = await availablePort();
    const expiryBaseUrl = `http://127.0.0.1:${expiryPort}`;
    const expiryChild = spawn(process.execPath, ['cloud/server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(expiryPort),
        DATABASE_URL: '',
        TRACKLAB_AUTH_SESSION_MAX_AGE_SECONDS: '1',
        OPENAI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let expirySocket: WebSocket | null = null;
    let expiryReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const healthDeadline = Date.now() + 10_000;
      while (Date.now() < healthDeadline) {
        try {
          if ((await fetch(`${expiryBaseUrl}/api/health`)).ok) break;
        } catch {
          // The short-lived server may still be binding its port.
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const registration = await fetch(`${expiryBaseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { Origin: expiryBaseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'presence-expiry@tracklab.test',
          name: 'Presence Expiry',
          password: 'friends-test-password',
        }),
      });
      expect(registration.status).toBe(201);
      const expiryCookie = String(registration.headers.get('set-cookie')).split(';')[0];
      const eventResponse = await fetch(`${expiryBaseUrl}/api/friends/events`, {
        headers: { Cookie: expiryCookie, Accept: 'text/event-stream' },
      });
      expect(eventResponse.status).toBe(200);
      expiryReader = eventResponse.body!.getReader();
      expect(new TextDecoder().decode((await expiryReader.read()).value)).toContain(': connected');

      expirySocket = new WebSocket(`${expiryBaseUrl.replace(/^http/, 'ws')}/multiplayer`, {
        headers: { Cookie: expiryCookie, Origin: expiryBaseUrl },
      });
      await new Promise<void>((resolve, reject) => {
        expirySocket!.once('open', resolve);
        expirySocket!.once('error', reject);
      });
      const socketClosed = new Promise<number>((resolve) => {
        expirySocket!.once('close', (code) => resolve(code));
      });
      const streamEnded = (async () => {
        while (true) {
          const chunk = await expiryReader!.read();
          if (chunk.done) return true;
        }
      })();
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Presence sources outlived the auth session.')), 3_000);
      });
      expect(await Promise.race([socketClosed, timeout])).toBe(1008);
      await expect(Promise.race([streamEnded, timeout])).resolves.toBe(true);
      expect((await fetch(`${expiryBaseUrl}/api/friends`, {
        headers: { Cookie: expiryCookie },
      })).status).toBe(401);
    } finally {
      expirySocket?.terminate();
      await expiryReader?.cancel().catch(() => {});
      if (expiryChild.exitCode == null) {
        expiryChild.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2_000);
          expiryChild.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    }
  }, 15_000);

  it('streams generic account invalidations to both affected riders with bounded connections', async () => {
    const riderA = await register('events-a@tracklab.test', 'Events Rider A', '198.51.100.61');
    const riderB = await register('events-b@tracklab.test', 'Events Rider B', '198.51.100.62');
    expect((await request('/api/friends/events')).status).toBe(401);
    expect((await request('/api/friends/events', {
      cookie: riderA.cookie,
      headers: { 'X-TrackLab-Club-Tablet-Session': 'claimed-tablet-session' },
    })).status).toBe(403);
    expect((await request('/api/friends/events', {
      cookie: riderA.cookie,
      headers: { Authorization: 'Bearer claimed-tablet-session' },
    })).status).toBe(403);
    expect((await request('/api/friends/privacy', {
      cookie: riderB.cookie,
      method: 'PATCH',
      body: { discoverable: true },
    })).status).toBe(200);

    const streamA = await openFriendEventStream(riderA.cookie);
    const streamB = await openFriendEventStream(riderB.cookie);
    const expectBothGeneric = async () => {
      const events = await Promise.all([
        waitForFriendGraphEvent(streamA),
        waitForFriendGraphEvent(streamB),
      ]);
      expect(events).toEqual([
        { block: 'event: graph-invalidated\ndata: {}', data: {} },
        { block: 'event: graph-invalidated\ndata: {}', data: {} },
      ]);
      expect(events.map((event) => event.block).join('\n')).not.toMatch(/profile|request|accept|declin|cancel|block|remove|invite/i);
    };

    const requestId = '55555555-5555-4555-8555-555555555555';
    expect((await request('/api/friends/requests', {
      cookie: riderA.cookie,
      method: 'POST',
      body: { profileId: riderB.user.id, clientRequestId: requestId },
    })).status).toBe(201);
    await expectBothGeneric();

    expect((await request(`/api/friends/requests/${requestId}/accept`, {
      cookie: riderB.cookie,
      method: 'POST',
    })).status).toBe(200);
    await expectBothGeneric();

    expect((await request(`/api/friends/${riderB.user.id}`, {
      cookie: riderA.cookie,
      method: 'DELETE',
    })).status).toBe(200);
    await expectBothGeneric();

    expect((await request('/api/friends/blocks', {
      cookie: riderA.cookie,
      method: 'POST',
      body: { profileId: riderB.user.id },
    })).status).toBe(201);
    await expectBothGeneric();

    expect((await request(`/api/friends/blocks/${riderB.user.id}`, {
      cookie: riderA.cookie,
      method: 'DELETE',
    })).status).toBe(200);
    await expectBothGeneric();

    const invite = await json(await request('/api/friends/invites', {
      cookie: riderA.cookie,
      method: 'POST',
    }));
    const inviteToken = new URL(invite.invite.inviteUrl).searchParams.get('friendInvite');
    expect((await request('/api/friends/invites/claim', {
      cookie: riderB.cookie,
      method: 'POST',
      body: { token: inviteToken },
    })).status).toBe(200);
    await expectBothGeneric();
    closeFriendEventStream(streamA);
    closeFriendEventStream(streamB);

    const cappedStreams: TestEventStream[] = [];
    for (let index = 0; index < 6; index += 1) {
      cappedStreams.push(await openFriendEventStream(riderA.cookie));
    }
    const capped = await request('/api/friends/events', {
      cookie: riderA.cookie,
      headers: { Accept: 'text/event-stream' },
    });
    expect(capped.status).toBe(429);
    expect(capped.headers.get('retry-after')).toBe('15');
    closeFriendEventStream(cappedStreams.shift()!);
    await new Promise((resolve) => setTimeout(resolve, 75));
    cappedStreams.push(await openFriendEventStream(riderA.cookie));
    cappedStreams.forEach(closeFriendEventStream);
  }, 30_000);

  it('lists and revokes only the owner active invite metadata without exposing secrets', async () => {
    const owner = await register('invite-owner@tracklab.test', 'Invite Owner', '198.51.100.71');
    const other = await register('invite-other@tracklab.test', 'Invite Other', '198.51.100.72');
    const claimant = await register('invite-claimant@tracklab.test', 'Invite Claimant', '198.51.100.73');
    const createInvite = async (cookie: string) => {
      const envelope = await json(await request('/api/friends/invites', { cookie, method: 'POST' }));
      return {
        ...envelope.invite,
        token: new URL(envelope.invite.inviteUrl).searchParams.get('friendInvite'),
      };
    };
    const ownerInviteA = await createInvite(owner.cookie);
    const ownerInviteB = await createInvite(owner.cookie);
    const otherInvite = await createInvite(other.cookie);

    const ownerActive = await json(await request('/api/friends/invites', { cookie: owner.cookie }));
    expect(Object.keys(ownerActive)).toEqual(['invites']);
    expect(ownerActive.invites).toHaveLength(2);
    ownerActive.invites.forEach((invite: Record<string, unknown>) => {
      expect(Object.keys(invite).sort()).toEqual(['createdAt', 'expiresAt', 'id']);
    });
    expect(JSON.stringify(ownerActive)).not.toMatch(/friendInvite|token|hash|inviteUrl|qrCodeUrl/i);
    const otherActiveBefore = await json(await request('/api/friends/invites', { cookie: other.cookie }));
    expect(otherActiveBefore.invites).toEqual([
      expect.objectContaining({ id: otherInvite.inviteId }),
    ]);

    const revoked = await json(await request('/api/friends/invites', {
      cookie: owner.cookie,
      method: 'DELETE',
    }));
    expect(revoked).toEqual({ revoked: 2 });
    expect(await json(await request('/api/friends/invites', { cookie: owner.cookie }))).toEqual({ invites: [] });
    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(ownerInviteA.token)}`)).status).toBe(404);
    expect((await fetch(ownerInviteA.qrCodeUrl)).status).toBe(404);
    expect((await request('/api/friends/invites/claim', {
      cookie: claimant.cookie,
      method: 'POST',
      body: { token: ownerInviteB.token },
    })).status).toBe(409);

    expect((await request(`/api/friends/invites/preview?token=${encodeURIComponent(otherInvite.token)}`)).status).toBe(200);
    expect((await fetch(otherInvite.qrCodeUrl)).status).toBe(200);
    expect(await json(await request('/api/friends/invites', { cookie: other.cookie }))).toEqual(otherActiveBefore);
    expect((await request('/api/friends/invites/claim', {
      cookie: claimant.cookie,
      method: 'POST',
      body: { token: otherInvite.token },
    })).status).toBe(200);
  }, 30_000);

  it('supports group invites in memory mode and removes pending invites when either rider blocks', async () => {
    const owner = await register('group-owner@tracklab.test', 'Group Owner', '198.51.100.81');
    const target = await register('group-target@tracklab.test', 'Group Target', '198.51.100.82');
    const ownerSocket = await openTestSocket(owner.cookie);
    const targetSocket = await openTestSocket(target.cookie);
    const ownerConnected = await waitForSocketMessage(ownerSocket, (message) => message.type === 'connected');
    const targetConnected = await waitForSocketMessage(targetSocket, (message) => message.type === 'connected');
    ownerSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 1 }));
    targetSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 1 }));
    await waitForSocketMessage(ownerSocket, (message) => message.type === 'welcome');
    await waitForSocketMessage(targetSocket, (message) => message.type === 'welcome');

    const ownerStart = ownerSocket.messages.length;
    ownerSocket.socket.send(JSON.stringify({ type: 'group-create', name: 'Memory BMX Crew' }));
    const ownerSocial = await waitForSocketMessage(
      ownerSocket,
      (message) => message.type === 'social-state' && message.social?.groups?.length === 1,
      ownerStart,
    );
    const groupId = ownerSocial.social.groups[0].id;
    expect(ownerSocial.social.groups[0]).toMatchObject({
      name: 'Memory BMX Crew',
      ownerGuestKey: `user:${owner.user.id}`,
    });

    const targetStart = targetSocket.messages.length;
    ownerSocket.socket.send(JSON.stringify({
      type: 'group-invite',
      groupId,
      targetId: targetConnected.clientId,
    }));
    const targetInvited = await waitForSocketMessage(
      targetSocket,
      (message) => message.type === 'social-state' && message.social?.incomingGroupInvites?.length === 1,
      targetStart,
    );
    const groupInviteId = targetInvited.social.incomingGroupInvites[0].id;
    expect(targetInvited.social.incomingGroupInvites[0]).toMatchObject({
      groupId,
      groupName: 'Memory BMX Crew',
      fromGuestKey: `user:${owner.user.id}`,
    });

    const postBlockStart = targetSocket.messages.length;
    expect((await request('/api/friends/blocks', {
      cookie: owner.cookie,
      method: 'POST',
      body: { profileId: target.user.id },
    })).status).toBe(201);
    await waitForSocketMessage(
      targetSocket,
      (message) => message.type === 'social-state' && message.social?.incomingGroupInvites?.length === 0,
      postBlockStart,
    );
    const responseStart = targetSocket.messages.length;
    targetSocket.socket.send(JSON.stringify({ type: 'group-invite-response', inviteId: groupInviteId, accepted: true }));
    await waitForSocketMessage(
      targetSocket,
      (message) => message.type === 'challenge-status' && /no longer available/i.test(message.message),
      responseStart,
    );

    expect(ownerConnected.clientId).toEqual(expect.any(String));
    ownerSocket.socket.close();
    targetSocket.socket.close();
    testSockets.delete(ownerSocket.socket);
    testSockets.delete(targetSocket.socket);
  }, 30_000);
});
