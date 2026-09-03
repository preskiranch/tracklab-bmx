import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { resolveReturningRoomHost } from '../../cloud/persistence.mjs';

type SocketMessage = Record<string, any>;

type TestSocket = {
  messages: SocketMessage[];
  socket: WebSocket;
  waitFor: (
    predicate: (message: SocketMessage) => boolean,
    afterIndex?: number,
    timeoutMs?: number,
  ) => Promise<SocketMessage>;
};

let child: ChildProcess;
let baseUrl = '';
let websocketUrl = '';
let serverLog = '';
const sockets: WebSocket[] = [];
const password = 'quick-race-correct-horse-battery-staple';
let requestAddressSequence = 10;

function nextRequestAddress() {
  requestAddressSequence += 1;
  return `198.51.100.${requestAddressSequence}`;
}

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
      // Server may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Quick Race test server did not start.\n${serverLog}`);
}

function api(pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

async function register(name: string, email: string) {
  const response = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'X-Forwarded-For': nextRequestAddress() },
    body: JSON.stringify({ name, email, password }),
  });
  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

async function login(email: string) {
  const response = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Forwarded-For': nextRequestAddress() },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

async function authUserId(cookie: string) {
  const response = await api('/api/auth/me', { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return String((await response.json()).user.id);
}

async function connect(cookie = '', query = ''): Promise<TestSocket> {
  const socket = new WebSocket(`${websocketUrl}${query}`, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: baseUrl,
    },
  });
  sockets.push(socket);
  const messages: SocketMessage[] = [];
  socket.on('message', (data) => {
    messages.push(JSON.parse(String(data)) as SocketMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  return {
    messages,
    socket,
    waitFor: async (predicate, afterIndex = 0, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = messages.slice(afterIndex).find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error(
        `Expected WebSocket message was not received. Saw: ${JSON.stringify(messages.slice(afterIndex))}`,
      );
    },
  };
}

async function hello(connection: TestSocket, bikeCount = 1) {
  const afterIndex = connection.messages.length;
  connection.socket.send(JSON.stringify({
    type: 'hello',
    available: true,
    bikeCount,
    track: { id: 'quick-track', name: 'Quick Track', country: 'United States', state: 'California' },
  }));
  return connection.waitFor((message) => message.type === 'welcome', afterIndex);
}

function trackRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quick-track',
    name: 'Quick Track',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'California',
    source: 'TrackLab test',
    sourceUrl: 'https://example.test/quick-track',
    surface: 'Dirt',
    lengthMeters: 320,
    elevationMeters: 5,
    centerline: [
      { lat: 38.1, lng: -122.1 },
      { lat: 38.101, lng: -122.099 },
    ],
    outline: [],
    zones: [],
    routeStatus: 'user-mapped',
    leaderboards: { rpm: [], speed: [] },
    ...overrides,
  };
}

function trackSplitSections() {
  return [{
    id: 'quick-split',
    name: 'First split',
    index: 0,
    splitPoint: { lat: 38.1, lng: -122.1 },
    mergePoint: { lat: 38.101, lng: -122.099 },
    branches: [
      {
        id: 'a',
        name: 'Amateur Line',
        points: [{ lat: 38.1, lng: -122.1 }, { lat: 38.101, lng: -122.099 }],
        lengthMeters: 100,
      },
      {
        id: 'b',
        name: 'Pro Set',
        points: [{ lat: 38.1, lng: -122.1 }, { lat: 38.1005, lng: -122.0995 }, { lat: 38.101, lng: -122.099 }],
        lengthMeters: 105,
      },
    ],
  }];
}

function raceSetup(configurationOverrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    revision: 3,
    configurationId: 'client-value-is-not-trusted',
    configuration: {
      activityType: 'bmx-race',
      trackId: 'quick-track',
      trackName: 'Quick Track',
      trackRecord: trackRecord(),
      raceView: { mode: 'satellite' },
      lapCount: 1,
      routeVariantId: null,
      section: null,
      startSection: null,
      ...configurationOverrides,
    },
  };
}

function sprintSetup(courseTrack = trackRecord({ id: 'quick-sprint', name: 'Quick Drag Strip' })) {
  return {
    version: 1,
    revision: 1,
    configurationId: 'client-sprint-value-is-not-trusted',
    configuration: {
      activityType: 'straight-sprint',
      courseId: 'quick-sprint',
      courseName: 'Quick Drag Strip',
      courseSource: 'saved-map',
      trackRecord: courseTrack,
      raceView: { mode: '3d' },
      distanceFeet: 145,
      airSetting: 7,
    },
  };
}

function raceState(sessionId: string, raceToken: string, trackId = 'quick-track') {
  return {
    sessionId,
    raceToken,
    trackId,
    raceState: 'finished',
    riders: [],
    summary: [],
  };
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  websocketUrl = `ws://127.0.0.1:${port}/multiplayer`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      GOOGLE_ROUTES_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: [
        'quick-invalid@tracklab.test',
        'quick-host@tracklab.test',
        'quick-guest@tracklab.test',
        'quick-capacity@tracklab.test',
        'quick-capacity-peer@tracklab.test',
        'quick-studio@tracklab.test',
        'quick-late-host@tracklab.test',
        'quick-late-guest@tracklab.test',
        'quick-late-joiner@tracklab.test',
        'quick-timeout-host@tracklab.test',
        'quick-timeout-guest@tracklab.test',
        'quick-reconnect-host@tracklab.test',
        'quick-reconnect-guest@tracklab.test',
        'quick-observer@tracklab.test',
        'quick-blocked-oldest@tracklab.test',
        'quick-compatible-one@tracklab.test',
        'quick-compatible-two@tracklab.test',
      ].join(','),
      TRACKLAB_QUICK_RACE_ROUND_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data) => { serverLog += String(data); });
  child.stderr?.on('data', (data) => { serverLog += String(data); });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
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

describe('configured Quick Race server protocol', () => {
  it('keeps a provisional restart host separate from the durable owner', () => {
    const restoredRoom = {
      hostId: null,
      hostGuestKey: 'user:durable-owner',
      durableHostPending: true,
    };
    const provisional = resolveReturningRoomHost(restoredRoom, {
      id: 'socket-provisional',
      guestKey: 'user:guest',
    });
    expect(provisional).toEqual({
      hostId: 'socket-provisional',
      hostGuestKey: 'user:durable-owner',
      durableHostPending: true,
      persistHost: false,
    });
    const reclaimed = resolveReturningRoomHost(provisional, {
      id: 'socket-owner',
      guestKey: 'user:durable-owner',
    });
    expect(reclaimed).toEqual({
      hostId: 'socket-owner',
      hostGuestKey: 'user:durable-owner',
      durableHostPending: false,
      persistHost: false,
    });
  });

  it('rejects a route choice without shared geometry and bounds sections to the selected route', async () => {
    const cookie = await register('Invalid Setup', 'quick-invalid@tracklab.test');
    const connection = await connect(cookie);
    await hello(connection);

    let afterIndex = connection.messages.length;
    connection.socket.send(JSON.stringify({
      type: 'quick-race',
      scope: 'world',
      racerSeatCount: 1,
      setup: raceSetup({ routeVariantId: 'pro' }),
    }));
    await connection.waitFor(
      (message) => message.type === 'room-error' && /complete race setup/i.test(String(message.message)),
      afterIndex,
    );

    afterIndex = connection.messages.length;
    connection.socket.send(JSON.stringify({
      type: 'quick-race',
      scope: 'world',
      racerSeatCount: 1,
      setup: raceSetup({
        trackRecord: trackRecord({
          lengthMeters: 500,
          routeVariants: [{ id: 'pro', name: 'Pro Track', lengthMeters: 100 }],
        }),
        routeVariantId: 'pro',
        section: { id: 'too-long', name: 'Too long', startMeter: 10, endMeter: 150 },
      }),
    }));
    await connection.waitFor(
      (message) => message.type === 'room-error' && /complete race setup/i.test(String(message.message)),
      afterIndex,
    );

    afterIndex = connection.messages.length;
    connection.socket.send(JSON.stringify({
      type: 'quick-race',
      scope: 'world',
      racerSeatCount: 1,
      setup: sprintSetup(trackRecord({
        id: 'quick-sprint',
        name: 'Quick Drag Strip',
        lengthMeters: 320,
        centerline: [
          { lat: 38.1, lng: -122.1 },
          { lat: 38.100001, lng: -122.099999 },
        ],
      })),
    }));
    await connection.waitFor(
      (message) => message.type === 'room-error' && /complete race setup/i.test(String(message.message)),
      afterIndex,
    );
  });

  it('matches one exact setup, gates readiness, binds sync to its track/token, and keeps the party for race again', async () => {
    const hostCookie = await register('Quick Host', 'quick-host@tracklab.test');
    const guestCookie = await register('Quick Guest', 'quick-guest@tracklab.test');
    const observerCookie = await register('Quick Observer', 'quick-observer@tracklab.test');
    const host = await connect(hostCookie);
    const guest = await connect(guestCookie);
    const observer = await connect(observerCookie);
    const hostWelcome = await hello(host);
    const guestWelcome = await hello(guest);
    const hostId = String(hostWelcome.clientId);
    const guestId = String(guestWelcome.clientId);
    const observerWelcome = await hello(observer);
    const observerIndex = observer.messages.length;

    const hostMatchIndex = host.messages.length;
    const guestMatchIndex = guest.messages.length;
    const sharedRaceSetup = raceSetup({
      trackRecord: trackRecord({ splitSections: trackSplitSections() }),
    });
    host.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: sharedRaceSetup }));
    guest.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: sharedRaceSetup }));
    const matched = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.racerCount === 2
        && Boolean(message.room?.setup),
      hostMatchIndex,
    );
    const guestMatched = await guest.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.racerCount === 2,
      guestMatchIndex,
    );
    expect(matched.room).toMatchObject({
      hostId,
      private: true,
      purpose: 'race',
      racerCount: 2,
      racerSeatCount: 2,
      roundNumber: 1,
      matchmakingScope: 'world',
      track: { id: 'quick-track' },
      flow: { phase: 'lobby' },
      setup: {
        version: 1,
        revision: 3,
        configurationId: expect.stringMatching(/^setup-[0-9a-f]{24}$/u),
        configuration: { activityType: 'bmx-race', trackId: 'quick-track' },
      },
    });
    expect(guestMatched.room.setup).toEqual(matched.room.setup);
    expect(matched.room.members.map((member: { id: string }) => member.id).sort())
      .toEqual([guestId, hostId].sort());
    expect(matched.room.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: hostId, roomId: matched.room.id }),
      expect.objectContaining({ id: guestId, roomId: matched.room.id }),
    ]));
    const observerLobby = await observer.waitFor(
      (message) => message.type === 'lobby-state'
        && message.riders?.some((rider: { id: string }) => rider.id === hostId)
        && message.riders?.some((rider: { id: string }) => rider.id === guestId),
      observerIndex,
    );
    expect(observerWelcome.clientId).toBeTruthy();
    expect(observerLobby.rooms).toEqual([]);
    observerLobby.riders.forEach((rider: { roomId?: string }) => expect(rider).not.toHaveProperty('roomId'));

    let afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({
      type: 'room-track',
      track: { id: 'mutated-track', name: 'Mutated Track', country: 'Nowhere', state: 'Nope' },
    }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /shared setup/i.test(String(message.message)),
      afterIndex,
    );
    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({
      type: 'room-vote-start',
      candidates: [
        { id: 'a', name: 'A', country: 'US', state: 'CA', hasPedalZones: true, hasSplits: false },
        { id: 'b', name: 'B', country: 'US', state: 'CA', hasPedalZones: true, hasSplits: false },
        { id: 'c', name: 'C', country: 'US', state: 'CA', hasPedalZones: true, hasSplits: false },
      ],
    }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /shared setup/i.test(String(message.message)),
      afterIndex,
    );
    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-vote', trackId: 'mutated-track' }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /shared setup/i.test(String(message.message)),
      afterIndex,
    );
    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 2 }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /setup changed/i.test(String(message.message)),
      afterIndex,
    );

    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 3 }));
    await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.readyMemberIds?.includes(hostId),
      afterIndex,
    );
    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-route-choice', choice: 'b' }));
    const lineChanged = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.flow?.routeChoices?.[hostId] === 'b'
        && !message.room?.readyMemberIds?.includes(hostId),
      afterIndex,
    );
    expect(lineChanged.room.setup.configuration.routeVariantId).toBeNull();

    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 3 }));
    const hostStartIndex = host.messages.length;
    const guestStartIndex = guest.messages.length;
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 3 }));
    const started = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.flow?.phase === 'race',
      hostStartIndex,
    );
    const guestStarted = await guest.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.flow?.phase === 'race',
      guestStartIndex,
    );
    const firstToken = String(started.room.flow.raceToken);
    expect(firstToken).toMatch(/^RACE-/u);
    expect(guestStarted.room.flow).toMatchObject({
      raceToken: firstToken,
      raceStartAt: started.room.flow.raceStartAt,
    });
    expect(started.room.readyMemberIds.sort()).toEqual([guestId, hostId].sort());
    expect(started.room.flow.routeChoices[hostId]).toBe('b');

    const outsiderJoinIndex = observer.messages.length;
    observer.socket.send(JSON.stringify({ type: 'join-room', roomId: matched.room.id }));
    await observer.waitFor(
      (message) => message.type === 'room-error' && /only its original racers/i.test(String(message.message)),
      outsiderJoinIndex,
    );

    const rejectedSyncIndex = guest.messages.length;
    host.socket.send(JSON.stringify({
      type: 'race-sync',
      state: raceState('wrong-track', firstToken, 'mutated-track'),
    }));
    host.socket.send(JSON.stringify({
      type: 'race-sync',
      state: raceState('wrong-token', 'RACE-stale-token'),
    }));
    host.socket.send(JSON.stringify({
      type: 'race-sync',
      state: { ...raceState('accepted-host', firstToken), raceState: 'racing' },
    }));
    await guest.waitFor(
      (message) => message.type === 'race-sync' && message.state?.sessionId === 'accepted-host',
      rejectedSyncIndex,
    );
    expect(guest.messages.slice(rejectedSyncIndex).some(
      (message) => message.type === 'race-sync'
        && ['wrong-track', 'wrong-token'].includes(String(message.state?.sessionId)),
    )).toBe(false);

    const roundCompleteIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'race-sync', state: raceState('host-finished', firstToken) }));
    guest.socket.send(JSON.stringify({ type: 'race-sync', state: raceState('guest-finished', firstToken) }));
    const completed = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.flow?.phase === 'round-complete',
      roundCompleteIndex,
    );
    expect(completed.room).toMatchObject({ racerCount: 2, roundNumber: 1 });

    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-setup', setup: sprintSetup() }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /change activity\/setup/i.test(String(message.message)),
      afterIndex,
    );

    afterIndex = guest.messages.length;
    guest.socket.send(JSON.stringify({ type: 'room-setup-edit' }));
    await guest.waitFor(
      (message) => message.type === 'room-error' && /only the race host/i.test(String(message.message)),
      afterIndex,
    );

    const setupSelectionHostIndex = host.messages.length;
    const setupSelectionGuestIndex = guest.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-setup-edit' }));
    const selecting = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.flow?.phase === 'setup-select',
      setupSelectionHostIndex,
    );
    await guest.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.flow?.phase === 'setup-select',
      setupSelectionGuestIndex,
    );
    expect(selecting.room.readyMemberIds).toEqual([]);
    expect(selecting.room.members.map((member: { id: string }) => member.id).sort())
      .toEqual([guestId, hostId].sort());

    afterIndex = guest.messages.length;
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 3 }));
    await guest.waitFor(
      (message) => message.type === 'room-error' && /only before the race starts/i.test(String(message.message)),
      afterIndex,
    );

    const confirmedHostIndex = host.messages.length;
    const confirmedGuestIndex = guest.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-setup', setup: sprintSetup() }));
    const confirmed = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.flow?.phase === 'lobby'
        && message.room?.setup?.revision === 4
        && message.room?.setup?.configuration?.activityType === 'straight-sprint',
      confirmedHostIndex,
    );
    await guest.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.setup?.revision === 4,
      confirmedGuestIndex,
    );
    expect(confirmed.room).toMatchObject({ racerCount: 2, roundNumber: 2 });
    expect(confirmed.room.readyMemberIds).toEqual([]);
    expect(confirmed.room.members.map((member: { id: string }) => member.id).sort())
      .toEqual([guestId, hostId].sort());

    afterIndex = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 3 }));
    await host.waitFor(
      (message) => message.type === 'room-error' && /setup changed/i.test(String(message.message)),
      afterIndex,
    );

    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 4 }));
    const secondStartIndex = host.messages.length;
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: 4 }));
    const secondStarted = await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.roundNumber === 2
        && message.room?.flow?.phase === 'race',
      secondStartIndex,
    );
    const secondToken = String(secondStarted.room.flow.raceToken);
    expect(secondToken).not.toBe(firstToken);

    const secondCompleteIndex = host.messages.length;
    host.socket.send(JSON.stringify({
      type: 'race-sync',
      state: raceState('host-sprint-finished', secondToken, 'quick-sprint'),
    }));
    guest.socket.send(JSON.stringify({
      type: 'race-sync',
      state: raceState('guest-sprint-finished', secondToken, 'quick-sprint'),
    }));
    await host.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.roundNumber === 2
        && message.room?.flow?.phase === 'round-complete',
      secondCompleteIndex,
    );

    const nextRoundIndex = guest.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-next-round' }));
    const nextRound = await guest.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.id === matched.room.id
        && message.room?.roundNumber === 3
        && message.room?.flow?.phase === 'race',
      nextRoundIndex,
    );
    expect(nextRound.room.flow.raceToken).not.toBe(secondToken);
    expect(nextRound.room.setup).toEqual(confirmed.room.setup);
    expect(nextRound.room.members.map((member: { id: string }) => member.id).sort())
      .toEqual([guestId, hostId].sort());
  });

  it('revalidates racer-seat eligibility before forming a queued match', async () => {
    const capacityCookie = await register('Capacity Racer', 'quick-capacity@tracklab.test');
    const peerCookie = await register('Capacity Peer', 'quick-capacity-peer@tracklab.test');
    const first = await connect(capacityCookie);
    const peer = await connect(peerCookie);
    await hello(first, 4);
    await hello(peer);
    first.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 4, setup: raceSetup() }));

    const replacement = await connect(capacityCookie);
    const firstCapacityIndex = first.messages.length;
    replacement.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await replacement.waitFor(
      (message) => message.type === 'wattbike-capacity' && message.grantedConnections === 4,
    );
    await first.waitFor(
      (message) => message.type === 'wattbike-capacity'
        && message.grantedConnections === 0
        && message.action === 'disconnect-excess',
      firstCapacityIndex,
    );

    const peerQueueIndex = peer.messages.length;
    peer.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
    const queuedAlone = await peer.waitFor(
      (message) => message.type === 'matchmaking-state'
        && message.state?.active === true
        && message.state?.queuedRacers === 1,
      peerQueueIndex,
    );
    expect(queuedAlone.state.message).toContain('1/4');
    await new Promise((resolve) => setTimeout(resolve, 1_450));
    expect(peer.messages.slice(peerQueueIndex).some(
      (message) => message.type === 'room-state' && Boolean(message.room?.setup),
    )).toBe(false);
    expect(peer.messages.slice(peerQueueIndex).some(
      (message) => message.type === 'matchmaking-state'
        && message.state?.active === false
        && /Match found/i.test(String(message.state?.message)),
    )).toBe(false);
    peer.socket.send(JSON.stringify({ type: 'matchmaking-cancel' }));
  });

  it('matches a compatible pair even when the oldest queued racer blocks both', async () => {
    const oldestCookie = await register('Blocked Oldest', 'quick-blocked-oldest@tracklab.test');
    const firstCookie = await register('Compatible One', 'quick-compatible-one@tracklab.test');
    const secondCookie = await register('Compatible Two', 'quick-compatible-two@tracklab.test');
    const firstId = await authUserId(firstCookie);
    const secondId = await authUserId(secondCookie);
    for (const profileId of [firstId, secondId]) {
      const response = await api('/api/friends/blocks', {
        method: 'POST',
        headers: { Cookie: oldestCookie },
        body: JSON.stringify({ profileId }),
      });
      expect(response.status).toBe(201);
    }

    const oldest = await connect(oldestCookie);
    const first = await connect(firstCookie);
    const second = await connect(secondCookie);
    try {
      await hello(oldest);
      await hello(first);
      await hello(second);
      const oldestIndex = oldest.messages.length;
      const firstIndex = first.messages.length;
      const secondIndex = second.messages.length;
      oldest.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
      first.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
      second.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));

      // Observe the fully populated queue first, then require a later update
      // proving that only the blocked oldest racer remains after the other two
      // match. This avoids asserting before the matcher's final queue refresh.
      await oldest.waitFor(
        (message) => message.type === 'matchmaking-state'
          && message.state?.active === true
          && message.state?.queuedRacers === 3,
        oldestIndex,
      );
      const oldestPostMatchIndex = oldest.messages.length;
      const firstMatch = await first.waitFor(
        (message) => message.type === 'room-state' && message.room?.racerCount === 2,
        firstIndex,
      );
      const secondMatch = await second.waitFor(
        (message) => message.type === 'room-state' && message.room?.id === firstMatch.room.id,
        secondIndex,
      );
      expect(secondMatch.room.racerCount).toBe(2);
      expect(oldest.messages.slice(oldestIndex).some(
        (message) => message.type === 'room-state' && message.room?.id === firstMatch.room.id,
      )).toBe(false);
      const oldestQueue = await oldest.waitFor(
        (message) => message.type === 'matchmaking-state'
          && message.state?.active === true
          && message.state?.queuedRacers === 1,
        oldestPostMatchIndex,
      );
      expect(oldestQueue.state.message).toContain('1/4');
    } finally {
      for (const connection of [oldest, first, second]) {
        if (connection.socket.readyState !== WebSocket.OPEN) continue;
        connection.socket.send(JSON.stringify({ type: 'matchmaking-cancel' }));
        connection.socket.send(JSON.stringify({ type: 'leave-room' }));
        connection.socket.close();
      }
    }
  });

  it('keeps returning racers ready but requires a post-round newcomer to load the setup', async () => {
    const hostCookie = await register('Late Host', 'quick-late-host@tracklab.test');
    const guestCookie = await register('Late Guest', 'quick-late-guest@tracklab.test');
    const lateCookie = await register('Late Joiner', 'quick-late-joiner@tracklab.test');
    const host = await connect(hostCookie);
    const guest = await connect(guestCookie);
    const late = await connect(lateCookie);
    const hostId = String((await hello(host)).clientId);
    const guestId = String((await hello(guest)).clientId);
    const lateId = String((await hello(late)).clientId);

    host.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
    guest.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
    const matched = await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.racerCount === 2 && message.room?.setup
    ));
    const roomId = String(matched.room.id);
    const revision = Number(matched.room.setup.revision);

    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    const started = await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId && message.room?.flow?.phase === 'race'
    ));
    const token = String(started.room.flow.raceToken);
    host.socket.send(JSON.stringify({ type: 'race-sync', state: raceState('late-host-finished', token) }));
    guest.socket.send(JSON.stringify({ type: 'race-sync', state: raceState('late-guest-finished', token) }));
    await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId && message.room?.flow?.phase === 'round-complete'
    ));

    late.socket.send(JSON.stringify({ type: 'join-room', roomId }));
    const joined = await late.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId && message.room?.racerCount === 3
    ));
    expect(joined.room.flow.phase).toBe('round-complete');

    const nextIndex = late.messages.length;
    host.socket.send(JSON.stringify({ type: 'room-next-round' }));
    const waiting = await late.waitFor((message) => (
      message.type === 'room-state'
      && message.room?.id === roomId
      && message.room?.roundNumber === 2
      && message.room?.flow?.phase === 'lobby'
    ), nextIndex);
    expect(waiting.room.readyMemberIds.sort()).toEqual([guestId, hostId].sort());
    expect(waiting.room.readyMemberIds).not.toContain(lateId);

    const restartIndex = host.messages.length;
    late.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    const restarted = await host.waitFor((message) => (
      message.type === 'room-state'
      && message.room?.id === roomId
      && message.room?.roundNumber === 2
      && message.room?.flow?.phase === 'race'
    ), restartIndex);
    expect(restarted.room.readyMemberIds.sort()).toEqual([guestId, hostId, lateId].sort());
  });

  it('ends a configured round when a connected racer never finishes', async () => {
    const hostCookie = await register('Timeout Host', 'quick-timeout-host@tracklab.test');
    const guestCookie = await register('Timeout Guest', 'quick-timeout-guest@tracklab.test');
    const host = await connect(hostCookie);
    const guest = await connect(guestCookie);
    await hello(host);
    await hello(guest);

    host.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
    guest.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: raceSetup() }));
    const matched = await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.racerCount === 2 && message.room?.setup
    ));
    const roomId = String(matched.room.id);
    const revision = Number(matched.room.setup.revision);
    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    const started = await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId && message.room?.flow?.phase === 'race'
    ));
    const token = String(started.room.flow.raceToken);
    host.socket.send(JSON.stringify({ type: 'race-sync', state: raceState('timeout-host-finished', token) }));
    const completed = await host.waitFor((message) => (
      message.type === 'room-state'
      && message.room?.id === roomId
      && message.room?.flow?.phase === 'round-complete'
    ), host.messages.length, 5_000);
    expect(completed.messages?.at?.(-1)?.text ?? '').toMatch(/treated as DNF|time limit reached/i);
  });

  it('lets only the same stable racers reconnect to an active configured race', async () => {
    const hostCookie = await register('Reconnect Host', 'quick-reconnect-host@tracklab.test');
    const guestCookie = await register('Reconnect Guest', 'quick-reconnect-guest@tracklab.test');
    const host = await connect(hostCookie);
    const guest = await connect(guestCookie);
    await hello(host);
    await hello(guest);
    host.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: sprintSetup() }));
    guest.socket.send(JSON.stringify({ type: 'quick-race', scope: 'world', racerSeatCount: 1, setup: sprintSetup() }));
    const matched = await host.waitFor((message) => (
      message.type === 'room-state' && message.room?.racerCount === 2 && message.room?.setup
    ));
    const roomId = String(matched.room.id);
    const revision = Number(matched.room.setup.revision);
    host.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    guest.socket.send(JSON.stringify({ type: 'room-ready', ready: true, setupRevision: revision }));
    const running = await host.waitFor((message) => (
      message.type === 'room-state'
      && message.room?.id === roomId
      && message.room?.flow?.phase === 'race'
    ));
    const raceToken = String(running.room.flow.raceToken);
    host.socket.close();
    guest.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const reconnectedHost = await connect(hostCookie);
    await hello(reconnectedHost);
    reconnectedHost.socket.send(JSON.stringify({ type: 'join-room', roomId }));
    const restored = await reconnectedHost.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId
    ));
    expect(restored.room.setup.configuration).toMatchObject({
      activityType: 'straight-sprint',
      courseId: 'quick-sprint',
      distanceFeet: 145,
      airSetting: 7,
    });
    expect(restored.room.flow).toMatchObject({ phase: 'race', raceToken });

    const reconnectedGuest = await connect(guestCookie);
    await hello(reconnectedGuest);
    reconnectedGuest.socket.send(JSON.stringify({ type: 'join-room', roomId }));
    const partyRestored = await reconnectedGuest.waitFor((message) => (
      message.type === 'room-state' && message.room?.id === roomId && message.room?.racerCount === 2
    ));
    expect(partyRestored.room.setup).toEqual(restored.room.setup);
    expect(partyRestored.room.flow).toMatchObject({ phase: 'race', raceToken });
  });

  it('keeps two studio tablets gathering beyond the world delay and matches immediately at four', async () => {
    const email = 'quick-studio@tracklab.test';
    const ownerCookie = await register('Quick Studio', email);
    const now = Date.now();
    const riders = Array.from({ length: 4 }, (_, index) => ({
      id: `quick-studio-rider-${index + 1}`,
      name: `Studio Rider ${index + 1}`,
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      headers: { Cookie: ownerCookie },
      body: JSON.stringify({ studioRiders: riders }),
    });
    expect(rosterSave.status).toBe(200);

    const tablets: Array<{ deviceToken: string; sessionToken: string }> = [];
    for (let index = 0; index < 4; index += 1) {
      const cookie = await login(email);
      const enrollment = await api('/api/club-tablet/devices', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ name: `Quick Race iPad ${index + 1}` }),
      });
      expect(enrollment.status).toBe(201);
      const enrolled = await enrollment.json();
      const bikeLabel = `WattbikeQuickRace${index + 1}`;
      const presence = await api('/api/club-tablet/bike-presence', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${enrolled.deviceToken}` },
        body: JSON.stringify({ bikeDeviceId: 80_000 + index, bikeLabel }),
      });
      expect(presence.status).toBe(200);
      const session = await api('/api/club-tablet/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${enrolled.deviceToken}` },
        body: JSON.stringify({ studioRiderId: riders[index].id, bikeDeviceId: bikeLabel }),
      });
      expect(session.status).toBe(201);
      tablets.push({
        deviceToken: enrolled.deviceToken,
        sessionToken: (await session.json()).sessionToken,
      });
    }

    const tabletSockets: TestSocket[] = [];
    for (const tablet of tablets) {
      const ticketResponse = await api('/api/club-tablet/multiplayer-ticket', {
        method: 'POST',
        headers: { 'X-TrackLab-Club-Tablet-Session': tablet.sessionToken },
      });
      expect(ticketResponse.status).toBe(201);
      const { ticket } = await ticketResponse.json();
      const connection = await connect('', `?clubTabletTicket=${encodeURIComponent(ticket)}`);
      await hello(connection, 0);
      tabletSockets.push(connection);
    }

    const firstRoomIndex = tabletSockets[0].messages.length;
    const secondRoomIndex = tabletSockets[1].messages.length;
    tabletSockets[0].socket.send(JSON.stringify({ type: 'quick-race', scope: 'studio', racerSeatCount: 1, setup: raceSetup() }));
    tabletSockets[1].socket.send(JSON.stringify({ type: 'quick-race', scope: 'studio', racerSeatCount: 1, setup: raceSetup() }));
    await tabletSockets[0].waitFor(
      (message) => message.type === 'matchmaking-state'
        && message.state?.active === true
        && message.state?.queuedRacers === 2,
      firstRoomIndex,
    );
    // Studio queues do not time-split one club into multiple two-tablet rooms.
    // They keep gathering beyond the old eight-second cutoff until a tablet
    // explicitly starts or all four arrive.
    await new Promise((resolve) => setTimeout(resolve, 8_250));
    expect(tabletSockets[0].messages.slice(firstRoomIndex).some(
      (message) => message.type === 'room-state' && Boolean(message.room?.setup),
    )).toBe(false);
    expect(tabletSockets[1].messages.slice(secondRoomIndex).some(
      (message) => message.type === 'room-state' && Boolean(message.room?.setup),
    )).toBe(false);

    const twoRacerIndexes = tabletSockets.slice(0, 2).map((connection) => connection.messages.length);
    tabletSockets[0].socket.send(JSON.stringify({ type: 'quick-race-start-now' }));
    const twoRacerRooms = await Promise.all(tabletSockets.slice(0, 2).map((connection, index) => connection.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.studio === true
        && message.room?.racerCount === 2,
      twoRacerIndexes[index],
    )));
    expect(new Set(twoRacerRooms.map((message) => message.room.id)).size).toBe(1);

    const leaveIndexes = tabletSockets.slice(0, 2).map((connection) => connection.messages.length);
    tabletSockets[0].socket.send(JSON.stringify({ type: 'leave-room' }));
    tabletSockets[1].socket.send(JSON.stringify({ type: 'leave-room' }));
    await Promise.all(tabletSockets.slice(0, 2).map((connection, index) => connection.waitFor(
      (message) => message.type === 'room-left',
      leaveIndexes[index],
    )));

    const matchIndexes = tabletSockets.map((connection) => connection.messages.length);
    tabletSockets.forEach((connection) => {
      connection.socket.send(JSON.stringify({ type: 'quick-race', scope: 'studio', racerSeatCount: 1, setup: raceSetup() }));
    });
    const rooms = await Promise.all(tabletSockets.map((connection, index) => connection.waitFor(
      (message) => message.type === 'room-state'
        && message.room?.studio === true
        && message.room?.racerCount === 4,
      matchIndexes[index],
    )));
    expect(new Set(rooms.map((message) => message.room.id)).size).toBe(1);
    rooms.forEach((message) => {
      expect(message.room).toMatchObject({
        private: true,
        purpose: 'race',
        studio: true,
        racerCount: 4,
        racerSeatCount: 4,
        flow: { phase: 'lobby' },
      });
    });

    const startIndex = tabletSockets[0].messages.length;
    tabletSockets[0].socket.send(JSON.stringify({ type: 'room-start' }));
    await tabletSockets[0].waitFor(
      (message) => message.type === 'room-error' && /assigned bikes connected/i.test(String(message.message)),
      startIndex,
    );
    const readyIndex = tabletSockets[0].messages.length;
    tabletSockets[0].socket.send(JSON.stringify({
      type: 'room-ready',
      ready: true,
      setupRevision: rooms[0].room.setup.revision,
    }));
    await tabletSockets[0].waitFor(
      (message) => message.type === 'room-error' && /reconnect every bike/i.test(String(message.message)),
      readyIndex,
    );
    expect(tabletSockets[0].messages.slice(readyIndex).some(
      (message) => message.type === 'room-state'
        && message.room?.readyMemberIds?.includes(message.room?.hostId),
    )).toBe(false);
  }, 40_000);
});
