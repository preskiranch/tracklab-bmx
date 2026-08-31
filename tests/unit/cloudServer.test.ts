import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
let cookie = '';
let secondaryCookie = '';
let secondaryEmail = '';
const testSockets = new Set<WebSocket>();
const testEventStreams = new Set<AbortController>();
const onePixelJpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

type TestSocket = {
  socket: WebSocket;
  messages: Array<Record<string, any>>;
};

type TestEventStream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

async function openTrainingHistoryStream(authCookie: string): Promise<TestEventStream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/training-sessions/stream`, {
    headers: { Cookie: authCookie, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  if (!response.body) throw new Error('Training history event stream did not include a body.');
  testEventStreams.add(controller);
  return {
    controller,
    reader: response.body.getReader(),
    decoder: new TextDecoder(),
    buffer: '',
  };
}

async function waitForTrainingHistoryEvent(
  stream: TestEventStream,
  eventName: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const separator = stream.buffer.indexOf('\n\n');
    if (separator >= 0) {
      const block = stream.buffer.slice(0, separator);
      stream.buffer = stream.buffer.slice(separator + 2);
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = block.match(/^data:\s*(.+)$/m)?.[1]?.trim();
      if (event === eventName) return data ? JSON.parse(data) : {};
      continue;
    }
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await Promise.race([
      stream.reader.read(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), remaining);
      }),
    ]);
    if (chunk.done) throw new Error(`Training history stream ended before ${eventName}.`);
    stream.buffer += stream.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
  }
  throw new Error(`Timed out waiting for ${eventName}.`);
}

function closeTrainingHistoryStream(stream: TestEventStream) {
  stream.controller.abort();
  testEventStreams.delete(stream.controller);
}

async function openTestSocket(authCookie: string): Promise<TestSocket> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/multiplayer`, {
    headers: { Cookie: authCookie, Origin: baseUrl },
  });
  const messages: Array<Record<string, any>> = [];
  socket.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // Tests only inspect JSON protocol messages.
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  testSockets.add(socket);
  return { socket, messages };
}

async function clubTabletSocketTicket(sessionToken: string) {
  const response = await api('/api/club-tablet/multiplayer-ticket', {
    method: 'POST',
    headers: { 'X-TrackLab-Club-Tablet-Session': sessionToken },
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ ticket: string; expiresAt: number }>;
}

async function openClubTabletSocketWithTicket(ticket: string, authCookie = ''): Promise<TestSocket> {
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/multiplayer?clubTabletTicket=${encodeURIComponent(ticket)}`,
    { headers: { Origin: baseUrl, ...(authCookie ? { Cookie: authCookie } : {}) } },
  );
  const messages: Array<Record<string, any>> = [];
  socket.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // Tests only inspect JSON protocol messages.
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  testSockets.add(socket);
  return { socket, messages };
}

async function openClubTabletSocket(sessionToken: string): Promise<TestSocket> {
  const { ticket } = await clubTabletSocketTicket(sessionToken);
  return openClubTabletSocketWithTicket(ticket);
}

async function expectClubTabletTicketRejected(ticket: string, authCookie = '') {
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/, 'ws')}/multiplayer?clubTabletTicket=${encodeURIComponent(ticket)}`,
    { headers: { Origin: baseUrl, ...(authCookie ? { Cookie: authCookie } : {}) } },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => reject(new Error('A consumed or expired Club Tablet ticket was accepted.')));
    socket.once('unexpected-response', (_request, response) => {
      expect(response.statusCode).toBe(401);
      response.resume();
      resolve();
    });
    socket.once('error', () => resolve());
  });
}

async function waitForSocketMessage(
  connection: TestSocket,
  predicate: (message: Record<string, any>) => boolean,
  afterIndex = 0,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = connection.messages.slice(afterIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for WebSocket message. Received: ${JSON.stringify(connection.messages.slice(afterIndex))}`);
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
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The child process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Cloud test server did not become healthy.');
}

function api(pathname: string, init: RequestInit = {}) {
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

async function beginHeldJsonRequest(
  pathname: string,
  {
    body,
    headers = {},
    authCookie = cookie,
  }: {
    body: unknown;
    headers?: Record<string, string>;
    authCookie?: string;
  },
) {
  const payload = Buffer.from(JSON.stringify(body));
  const leadingBody = payload.subarray(0, Math.max(0, payload.length - 1));
  const finalByte = payload.subarray(Math.max(0, payload.length - 1));
  let release!: () => void;
  let requestError: unknown = null;
  const responsePromise = new Promise<{ status: number; json: () => Promise<unknown> }>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${pathname}`, {
      method: 'PUT',
      headers: {
        Origin: baseUrl,
        ...(authCookie ? { Cookie: authCookie } : {}),
        'Content-Type': 'application/json',
        'Content-Length': String(payload.byteLength),
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        resolve({
          status: response.statusCode ?? 500,
          json: async () => JSON.parse(responseBody.toString('utf8')),
        });
      });
    });
    request.once('error', (error) => {
      requestError = error;
      reject(error);
    });
    request.write(leadingBody);
    release = () => {
      if (!requestError) request.end(finalByte);
    };
  });
  // Keep the final JSON byte back while the server authenticates and blocks in
  // readJsonBody. This deterministic half-request lets an end/revoke request
  // complete first without relying on a slow persistence implementation.
  await new Promise((resolve) => setTimeout(resolve, 75));
  return { release, responsePromise };
}

function trackMapping(trackId: string) {
  const startGate = { lat: 38.244, lng: -122.283 };
  const finishLine = { lat: 38.245, lng: -122.282 };
  return {
    version: 1,
    trackId,
    trackName: 'North Bay BMX - Napa Valley',
    country: 'United States',
    state: 'California',
    savedAt: new Date().toISOString(),
    routeStatus: 'user-mapped',
    restAfterSeconds: 1,
    lengthMeters: 320,
    centerline: [startGate, finishLine],
    startGate,
    finishLine,
    zoneBoundaryMeters: [0, 45],
    zones: [{
      id: 'pedal-zone-1',
      name: 'Pedal Zone 1',
      startMeter: 0,
      endMeter: 45,
      type: 'pedal',
      restAfterSeconds: 1,
    }],
    splitSections: [],
  };
}

function customSprintTrack(id: string) {
  return {
    id,
    name: 'Drag Strip',
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'New Hampshire',
    region: 'New Hampshire',
    source: 'Custom',
    sourceUrl: 'local://custom-route',
    sourceType: 'manual',
    verificationStatus: 'unverified',
    addressStatus: 'provider-address',
    address: 'Drag Strip, Epping, NH 03042, USA',
    city: 'Epping',
    postalCode: '03042',
    latitude: 43.031,
    longitude: -71.077,
    coordinateSource: 'TrackLab developer mapping',
    coordinateAccuracy: 'developer-confirmed',
    lengthMeters: 457.2,
    elevationMeters: 0,
    surface: 'Custom sprint route',
    outline: [
      { lat: 43.031, lng: -71.077 },
      { lat: 43.032, lng: -71.076 },
    ],
    centerline: [
      { lat: 43.031, lng: -71.077 },
      { lat: 43.032, lng: -71.076 },
    ],
    routeStatus: 'locator-only',
    zones: [],
    leaderboards: { rpm: [], speed: [] },
  };
}

function exploreRoute(id: string) {
  return {
    id,
    name: 'My San Francisco ride',
    origin: { lat: 37.7749, lng: -122.4194 },
    destination: { lat: 37.8024, lng: -122.4058 },
    originLabel: 'Market Street, San Francisco, CA',
    destinationLabel: 'Fisherman’s Wharf, San Francisco, CA',
    travelMode: 'bicycle',
    distanceMeters: 5_200,
    durationSeconds: 1_320,
    encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    createdAt: Date.now(),
  };
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
      TRACKLAB_ADMIN_EMAILS: 'admin-only@tracklab.test,usage-admin@tracklab.test,global-view-admin@tracklab.test,club-owner-admin@tracklab.test,overlay-only-admin@tracklab.test,capacity-admin@tracklab.test,tablet-capacity-admin@tracklab.test',
      TRACKLAB_ALLOW_RACER_MAP_PUBLISH: '0',
      TRACKLAB_METRICS_TOKEN: 'test-metrics-token',
      TRACKLAB_3D_FREE_LOAD_CAP: '5000',
      TRACKLAB_CLUB_LIVE_SESSION_TTL_MS: '600',
      TRACKLAB_CLUB_LIVE_FRAME_TTL_MS: '300',
      TRACKLAB_CLUB_TABLET_WS_TICKET_TTL_MS: '120',
      TRACKLAB_CLUB_EVENT_START_LEAD_MS: '3000',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
}, 35_000);

afterAll(async () => {
  testEventStreams.forEach((controller) => controller.abort());
  testEventStreams.clear();
  testSockets.forEach((socket) => socket.terminate());
  testSockets.clear();
  if (!child || child.exitCode != null) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('cloud API trust boundaries', () => {
  it('serves public App Store pages without turning missing assets into SPA routes', async () => {
    for (const pathname of ['/privacy', '/privacy-policy', '/support']) {
      const response = await fetch(`${baseUrl}${pathname}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toContain('<div id="root"></div>');
    }

    const missingAsset = await fetch(`${baseUrl}/assets/tracklab-missing.js`, {
      headers: { Accept: 'text/html' },
    });
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.headers.get('content-type')).toContain('application/json');
  });

  it('reports a no-store healthy memory fallback', async () => {
    const response = await api('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      storage: { mode: 'memory', configured: false, ready: true },
      billing: {
        provider: 'apple-app-store',
        enabled: false,
        configured: false,
        ready: false,
        appleOnlyCutover: false,
      },
      requirements: { appleIap: false, appleOnlyCutover: false },
    });
  });

  it('enforces one account-wide Wattbike allocation across reconnects and auth sessions', async () => {
    const originalCookie = cookie;
    const registration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.44' },
      body: JSON.stringify({
        name: 'Capacity Admin',
        email: 'capacity-admin@tracklab.test',
        password: 'capacity-correct-horse-battery-staple',
      }),
    });
    expect(registration.status).toBe(201);
    const firstSessionCookie = String(registration.headers.get('set-cookie')).split(';')[0];
    const secondLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.44' },
      body: JSON.stringify({
        email: 'capacity-admin@tracklab.test',
        password: 'capacity-correct-horse-battery-staple',
      }),
    });
    expect(secondLogin.status).toBe(200);
    const secondSessionCookie = String(secondLogin.headers.get('set-cookie')).split(';')[0];

    const first = await openTestSocket(firstSessionCookie);
    first.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await waitForSocketMessage(first, (message) => (
      message.type === 'wattbike-capacity' && message.grantedConnections === 4
    ));
    await waitForSocketMessage(first, (message) => message.type === 'welcome');

    const firstReplacementIndex = first.messages.length;
    const reconnect = await openTestSocket(firstSessionCookie);
    reconnect.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await waitForSocketMessage(reconnect, (message) => (
      message.type === 'wattbike-capacity'
      && message.requestedConnections === 4
      && message.grantedConnections === 4
      && message.accountConnectionsInUse === 4
    ));
    await waitForSocketMessage(first, (message) => (
      message.type === 'wattbike-capacity'
      && message.grantedConnections === 0
      && message.action === 'disconnect-excess'
    ), firstReplacementIndex);

    const independentSession = await openTestSocket(secondSessionCookie);
    independentSession.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 1 }));
    await waitForSocketMessage(independentSession, (message) => (
      message.type === 'wattbike-capacity'
      && message.requestedConnections === 1
      && message.grantedConnections === 0
      && message.connectionLimit === 4
      && message.action === 'disconnect-excess'
    ));

    reconnect.socket.close();
    await new Promise<void>((resolve) => reconnect.socket.once('close', () => resolve()));
    // Socket close waits for the WebSocket handshake, while lease release is a
    // separately serialized persistence operation on the server.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const retryIndex = independentSession.messages.length;
    independentSession.socket.send(JSON.stringify({ type: 'presence', available: true, bikeCount: 1 }));
    await waitForSocketMessage(independentSession, (message) => (
      message.type === 'wattbike-capacity'
      && message.grantedConnections === 1
      && message.accountConnectionsInUse === 1
    ), retryIndex);

    first.socket.close();
    independentSession.socket.close();
    cookie = originalCookie;
  });

  it('reserves one device-authenticated picker connection and atomically hands it to the athlete session', async () => {
    const originalCookie = cookie;
    const email = 'tablet-capacity-admin@tracklab.test';
    const password = 'tablet-capacity-correct-horse-battery-staple';
    const riderId = `tablet-capacity-rider-${Date.now()}`;
    const registration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.45' },
      body: JSON.stringify({ name: 'Tablet Capacity Admin', email, password }),
    });
    expect(registration.status).toBe(201);
    const authorizingCookie = String(registration.headers.get('set-cookie')).split(';')[0];
    cookie = authorizingCookie;
    expect((await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: riderId,
          name: 'Picker Rider',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      }),
    })).status).toBe(200);

    const independentLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.46' },
      body: JSON.stringify({ email, password }),
    });
    expect(independentLogin.status).toBe(200);
    const independentCookie = String(independentLogin.headers.get('set-cookie')).split(';')[0];

    const enrollment = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Capacity Picker iPad' }),
    });
    expect(enrollment.status).toBe(201);
    const enrolled = await enrollment.json() as {
      device: {
        id: string;
        recoveryState: 'complete';
        recoveryCompleted: true;
      };
      deviceToken: string;
    };
    expect(enrolled.device).toMatchObject({
      recoveryState: 'complete',
      recoveryCompleted: true,
    });
    expect(enrolled.device).not.toHaveProperty('pairedBike');
    let currentDeviceToken = enrolled.deviceToken;
    const currentDeviceHeaders = (): HeadersInit => ({
      Authorization: `Bearer ${currentDeviceToken}`,
    });
    cookie = '';

    expect((await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
    })).status).toBe(401);

    const ownerSocket = await openTestSocket(independentCookie);
    ownerSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await waitForSocketMessage(ownerSocket, (message) => (
      message.type === 'wattbike-capacity'
      && message.grantedConnections === 4
      && message.accountConnectionsInUse === 4
    ));

    const denied = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
      body: JSON.stringify({ requestedConnections: 4 }),
    });
    expect(denied.status).toBe(200);
    await expect(denied.json()).resolves.toMatchObject({
      capacity: {
        requestedConnections: 1,
        grantedConnections: 0,
        connectionLimit: 4,
        accountConnectionsInUse: 4,
        action: 'disconnect-excess',
        reason: 'capacity-full',
      },
      expiresAt: expect.any(Number),
      pollAfterMs: expect.any(Number),
    });

    const ownerReductionIndex = ownerSocket.messages.length;
    ownerSocket.socket.send(JSON.stringify({ type: 'presence', available: true, bikeCount: 3 }));
    await waitForSocketMessage(ownerSocket, (message) => (
      message.type === 'wattbike-capacity'
      && message.requestedConnections === 3
      && message.grantedConnections === 3
      && message.accountConnectionsInUse === 3
    ), ownerReductionIndex);

    const reserved = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
      // The server must ignore any attempt by a picker to request more seats.
      body: JSON.stringify({ requestedConnections: 4 }),
    });
    expect(reserved.status).toBe(200);
    const reservedPayload = await reserved.json();
    expect(reservedPayload).toMatchObject({
      capacity: {
        requestedConnections: 1,
        grantedConnections: 1,
        connectionLimit: 4,
        accountConnectionsInUse: 4,
        action: 'none',
        reason: 'club-tablet-picker-reserved',
      },
    });

    const renewed = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
    });
    await expect(renewed.json()).resolves.toMatchObject({
      capacity: { grantedConnections: 1, accountConnectionsInUse: 4 },
    });

    const started = await api('/api/club-tablet/sessions', {
      method: 'POST',
      headers: currentDeviceHeaders(),
      body: JSON.stringify({ studioRiderId: riderId, bikeDeviceId: 'picker-bike-1' }),
    });
    expect(started.status).toBe(201);
    const startedPayload = await started.json() as { sessionToken: string };

    // Picker cleanup carries the old device holder. The stable allocation key
    // now belongs to the athlete session, so this stale release is harmless.
    const staleRelease = await api('/api/club-tablet/wattbike-capacity', {
      method: 'DELETE',
      headers: currentDeviceHeaders(),
    });
    await expect(staleRelease.json()).resolves.toEqual({ released: false });
    const stillSelected = await api('/api/club-tablet/sessions/current', {
      headers: { 'X-TrackLab-Club-Tablet-Session': startedPayload.sessionToken },
    });
    expect(stillSelected.status).toBe(200);

    const latePickerPoll = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
    });
    expect(latePickerPoll.status).toBe(409);
    expect((await api('/api/club-tablet/sessions/current', {
      headers: { 'X-TrackLab-Club-Tablet-Session': startedPayload.sessionToken },
    })).status).toBe(200);

    const connectedBeforeRecovery = await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
      body: JSON.stringify({
        bikeDeviceId: 25_058_701,
        bikeLabel: 'WattbikePM25058701',
      }),
    });
    expect(connectedBeforeRecovery.status).toBe(200);
    const connectedBeforeRecoveryPayload = await connectedBeforeRecovery.json();
    expect(connectedBeforeRecoveryPayload).toMatchObject({
      pairedBike: {
        deviceId: 25_058_701,
        label: 'WattbikePM25058701',
        updatedAt: expect.any(Number),
      },
    });
    const repeatedHeartbeat = await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: currentDeviceHeaders(),
      body: JSON.stringify({
        bikeDeviceId: 25_058_701,
        bikeLabel: 'WattbikePM25058701',
      }),
    });
    expect(repeatedHeartbeat.status).toBe(200);
    await expect(repeatedHeartbeat.json()).resolves.toMatchObject({
      pairedBike: {
        deviceId: 25_058_701,
        label: 'WattbikePM25058701',
        updatedAt: connectedBeforeRecoveryPayload.pairedBike.updatedAt,
      },
    });
    cookie = independentCookie;
    const recoveryTrack = customSprintTrack(`tablet-recovery-${Date.now()}`);
    const recoveryEventResponse = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'straight-sprint',
        configuration: {
          trackId: recoveryTrack.id,
          trackName: recoveryTrack.name,
          distanceFeet: 300,
          airSetting: 1,
          trackRecord: recoveryTrack,
        },
      }),
    });
    expect(recoveryEventResponse.status).toBe(201);
    const recoveryEventId = (await recoveryEventResponse.json()).event.id;
    cookie = '';
    const recoveryEventJoin = await api('/api/club-events/current/join', {
      method: 'POST',
      headers: { 'X-TrackLab-Club-Tablet-Session': startedPayload.sessionToken },
      body: JSON.stringify({ eventId: recoveryEventId }),
    });
    expect(recoveryEventJoin.status).toBe(200);
    await expect(recoveryEventJoin.json()).resolves.toMatchObject({
      event: {
        id: recoveryEventId,
        slots: expect.arrayContaining([
          expect.objectContaining({
            deviceId: enrolled.device.id,
            status: 'ready',
            athlete: expect.objectContaining({ studioRiderId: riderId }),
          }),
        ]),
      },
    });
    // A process restart or a long app update loses live presence. Explicitly
    // ending the heartbeat simulates that boundary while the paired-bike
    // identity must remain durable on the logical tablet row.
    expect((await api('/api/club-tablet/bike-presence', {
      method: 'DELETE',
      headers: currentDeviceHeaders(),
    })).status).toBe(200);

    // An app update can strand the web-view copy of the tablet bearer while
    // the owner still sees the existing device in the club list. Recover that
    // exact row instead of enrolling a duplicate. Recovery consumes only this
    // fresh authorizing login, rotates the old device bearer, and retires the
    // transient athlete/event authority attached to the old installation.
    const recoveryLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.47' },
      body: JSON.stringify({ email, password }),
    });
    expect(recoveryLogin.status).toBe(200);
    const recoveryCookie = String(recoveryLogin.headers.get('set-cookie')).split(';')[0];
    cookie = recoveryCookie;
    const recoveredResponse = await api(
      `/api/club-tablet/devices/${encodeURIComponent(enrolled.device.id)}/recover`,
      { method: 'POST' },
    );
    expect(recoveredResponse.status).toBe(200);
    expect(recoveredResponse.headers.get('cache-control')).toBe('no-store');
    expect(recoveredResponse.headers.get('set-cookie')).toContain('Max-Age=0');
    const recovered = await recoveredResponse.json() as {
      device: {
        id: string;
        name: string;
        recoveryState: 'restored';
        recoveryCompleted: true;
        pairedBike?: { deviceId: number; label: string; updatedAt: number };
        connectedBike?: { deviceId: number; label: string };
      };
      deviceToken: string;
    };
    expect(recovered.device).toMatchObject({
      id: enrolled.device.id,
      name: 'Capacity Picker iPad',
      recoveryState: 'restored',
      recoveryCompleted: true,
      pairedBike: {
        deviceId: 25_058_701,
        label: 'WattbikePM25058701',
      },
    });
    expect(recovered.device).not.toHaveProperty('connectedBike');
    expect(recovered.deviceToken).toHaveLength(43);
    expect(recovered.deviceToken).not.toBe(enrolled.deviceToken);
    expect(JSON.stringify(recovered)).not.toContain('tokenHash');

    cookie = independentCookie;
    const eventAfterRecovery = await api('/api/club-events/current');
    expect(eventAfterRecovery.status).toBe(200);
    await expect(eventAfterRecovery.json()).resolves.toMatchObject({
      event: {
        id: recoveryEventId,
        slots: expect.arrayContaining([
          expect.objectContaining({
            deviceId: enrolled.device.id,
            status: 'available',
            athlete: null,
          }),
        ]),
      },
    });

    const retiredRecoveryIdentity = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: baseUrl, Cookie: recoveryCookie },
    });
    expect(retiredRecoveryIdentity.status).toBe(200);
    await expect(retiredRecoveryIdentity.json()).resolves.toEqual({ user: null });

    cookie = '';
    expect((await api('/api/club-tablet/roster', {
      headers: currentDeviceHeaders(),
    })).status).toBe(401);
    // Recovery keeps the physical-bike assignment but ends the temporary
    // athlete identity so the replaced installation cannot retain a rider.
    expect((await api('/api/club-tablet/sessions/current', {
      headers: { 'X-TrackLab-Club-Tablet-Session': startedPayload.sessionToken },
    })).status).toBe(401);
    const recoveredHeaders = { Authorization: `Bearer ${recovered.deviceToken}` };
    currentDeviceToken = recovered.deviceToken;
    const recoveredRoster = await api('/api/club-tablet/roster', {
      headers: recoveredHeaders,
    });
    expect(recoveredRoster.status).toBe(200);
    await expect(recoveredRoster.json()).resolves.toMatchObject({
      device: {
        id: enrolled.device.id,
        name: 'Capacity Picker iPad',
        recoveryState: 'restored',
        recoveryCompleted: true,
        pairedBike: {
          deviceId: 25_058_701,
          label: 'WattbikePM25058701',
        },
      },
    });

    // With transient athlete state released, the recovered credential can
    // immediately reuse that exact device allocation without affecting
    // another tablet.
    const recoveredCapacity = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: recoveredHeaders,
    });
    expect(recoveredCapacity.status).toBe(200);
    await expect(recoveredCapacity.json()).resolves.toMatchObject({
      capacity: {
        grantedConnections: 1,
        accountConnectionsInUse: 4,
        reason: 'club-tablet-picker-reserved',
      },
    });
    // Recover once more while the picker owns the seat. Its durable lease is
    // rebound from the old bearer hash to the new one, so the same allocation
    // renews instead of conflicting or consuming a duplicate seat.
    const pickerRecoveryLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '192.0.2.48' },
      body: JSON.stringify({ email, password }),
    });
    expect(pickerRecoveryLogin.status).toBe(200);
    cookie = String(pickerRecoveryLogin.headers.get('set-cookie')).split(';')[0];
    const pickerRecoveredResponse = await api(
      `/api/club-tablet/devices/${encodeURIComponent(enrolled.device.id)}/recover`,
      { method: 'POST' },
    );
    expect(pickerRecoveredResponse.status).toBe(200);
    const pickerRecovered = await pickerRecoveredResponse.json() as {
      device: { id: string; name: string; recoveryState: string };
      deviceToken: string;
    };
    expect(pickerRecovered.device).toMatchObject({
      id: enrolled.device.id,
      name: 'Capacity Picker iPad',
      recoveryState: 'restored',
    });
    expect((await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: recoveredHeaders,
    })).status).toBe(401);
    const pickerRecoveredHeaders = { Authorization: `Bearer ${pickerRecovered.deviceToken}` };
    const renewedAfterPickerRecovery = await api('/api/club-tablet/wattbike-capacity', {
      method: 'PUT',
      headers: pickerRecoveredHeaders,
    });
    expect(renewedAfterPickerRecovery.status).toBe(200);
    await expect(renewedAfterPickerRecovery.json()).resolves.toMatchObject({
      capacity: {
        grantedConnections: 1,
        accountConnectionsInUse: 4,
        reason: 'club-tablet-picker-reserved',
      },
    });
    expect((await api('/api/club-tablet/wattbike-capacity', {
      method: 'DELETE',
      headers: pickerRecoveredHeaders,
    })).status).toBe(200);
    currentDeviceToken = pickerRecovered.deviceToken;

    // The independent monitor login survives; the recovered device appears
    // exactly once and no bearer or hash is exposed by the owner list.
    cookie = independentCookie;
    const listedAfterRecovery = await api('/api/club-tablet/devices');
    expect(listedAfterRecovery.status).toBe(200);
    const listedAfterRecoveryPayload = await listedAfterRecovery.json();
    expect(listedAfterRecoveryPayload.devices.filter(
      (device: { id: string }) => device.id === enrolled.device.id,
    )).toHaveLength(1);
    expect(listedAfterRecoveryPayload.devices.find(
      (device: { id: string }) => device.id === enrolled.device.id,
    )).toMatchObject({
      id: enrolled.device.id,
      name: 'Capacity Picker iPad',
      recoveryState: 'restored',
      recoveryCompleted: true,
      pairedBike: {
        deviceId: 25_058_701,
        label: 'WattbikePM25058701',
      },
    });
    expect(listedAfterRecoveryPayload.devices.find(
      (device: { id: string }) => device.id === enrolled.device.id,
    )).not.toHaveProperty('connectedBike');
    expect(JSON.stringify(listedAfterRecoveryPayload)).not.toContain(pickerRecovered.deviceToken);
    expect(JSON.stringify(listedAfterRecoveryPayload)).not.toContain('tokenHash');

    ownerSocket.socket.close();
    cookie = originalCookie;
  });

  it('requires reauthentication and permanently erases account sessions and private history', async () => {
    const originalCookie = cookie;
    const email = `delete-me-${Date.now()}@tracklab.test`;
    const password = 'delete-correct-horse-battery-staple';
    const requestIp = `198.51.100.${20 + Math.floor(Math.random() * 100)}`;
    const registration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ name: 'Delete Me Rider', email, password }),
    });
    expect(registration.status).toBe(201);
    const deletionCookie = String(registration.headers.get('set-cookie')).split(';')[0];
    cookie = deletionCookie;

    const secondLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ email, password }),
    });
    expect(secondLogin.status).toBe(200);
    const secondCookie = String(secondLogin.headers.get('set-cookie')).split(';')[0];

    expect((await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: { photoUrl: 'data:image/png;base64,REVNTw==', updatedAt: Date.now() },
        exploreRoutes: [exploreRoute(`DELETE-ROUTE-${Date.now()}`)],
      }),
    })).status).toBe(200);
    const startedAt = Date.now() - 10_000;
    expect((await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: `delete-training-${startedAt}`,
          activityType: 'straight-sprint',
          title: 'Private deletion sprint',
          startedAt,
          endedAt: startedAt + 8_000,
          durationMs: 8_000,
          distanceMeters: 100,
          trackId: 'delete-private-track',
          trackName: 'Delete Private Track',
          details: { riderName: 'Delete Me Rider', peakWatts: 999 },
        },
      }),
    })).status).toBe(201);

    const bearerAttempt = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer club-tablet-credential' },
      body: JSON.stringify({ password, confirmation: 'DELETE' }),
    });
    expect(bearerAttempt.status).toBe(403);
    expect(bearerAttempt.headers.get('cache-control')).toBe('no-store');

    const malformed = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { 'X-Forwarded-For': requestIp },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('cache-control')).toBe('no-store');

    const badConfirmation = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ password, confirmation: 'delete' }),
    });
    expect(badConfirmation.status).toBe(400);
    expect(badConfirmation.headers.get('cache-control')).toBe('no-store');

    const wrongPassword = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ password: 'definitely-not-the-password', confirmation: 'DELETE' }),
    });
    expect(wrongPassword.status).toBe(403);
    expect(wrongPassword.headers.get('cache-control')).toBe('no-store');

    const erased = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ password, confirmation: 'DELETE' }),
    });
    expect(erased.status).toBe(200);
    expect(erased.headers.get('cache-control')).toBe('no-store');
    expect(erased.headers.get('set-cookie')).toContain('Max-Age=0');
    await expect(erased.json()).resolves.toEqual({ deleted: true });

    const staleSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: secondCookie, Origin: baseUrl },
    });
    await expect(staleSession.json()).resolves.toEqual({ user: null });
    const oldLogin = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': requestIp },
      body: JSON.stringify({ email, password }),
    });
    expect(oldLogin.status).toBe(401);

    // Reusing the email creates a clean identity; no profile, route, or
    // training history from the erased UUID may reappear.
    cookie = '';
    const cleanRegistration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.201' },
      body: JSON.stringify({ name: 'Fresh Rider', email, password }),
    });
    expect(cleanRegistration.status).toBe(201);
    cookie = String(cleanRegistration.headers.get('set-cookie')).split(';')[0];
    const cleanUserData = await api('/api/user-data');
    await expect(cleanUserData.json()).resolves.toMatchObject({
      accountProfile: {},
    });
    const cleanExploreRoutes = await api('/api/explore/recent-routes');
    await expect(cleanExploreRoutes.json()).resolves.toEqual({ routes: [] });
    const cleanTraining = await api('/api/training-sessions');
    await expect(cleanTraining.json()).resolves.toMatchObject({ sessions: [] });

    const cleanup = await api('/api/auth/account', {
      method: 'DELETE',
      headers: { 'X-Forwarded-For': '203.0.113.201' },
      body: JSON.stringify({ password, confirmation: 'DELETE' }),
    });
    expect(cleanup.status).toBe(200);
    cookie = originalCookie;
  });

  it('reports commentary capability without exposing a server key', async () => {
    const response = await api('/api/commentary/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const config = await response.json();
    expect(config).toMatchObject({
      aiAvailable: false,
      speechStatus: 'not-configured',
      textModel: 'local-race-engine',
      preRaceTextModel: 'gpt-5.6-luna',
      speechModel: 'gpt-realtime-2.1-mini',
      voicePresets: ['american-man'],
      research: {
        knowledgeVersion: 'usabmx-national-2026-07-23-v6-2024-inventory-and-prosody',
        indexedVideos: 285,
        analyzedRaceCallSegments: 18_208,
        analyzedRaceAudioSections: 9,
        minimumGenerativeVocabularyTarget: 10_000,
        vocabularyStrategy: 'open-generative-lexicon',
        retainsFullTranscripts: false,
        retainsSourceAudio: false,
      },
    });
    expect(config).not.toHaveProperty('textModels');
    expect(JSON.stringify(config)).not.toContain('OPENAI_API_KEY');
  });

  it('reports Explore capability without exposing its Google Routes key', async () => {
    const response = await api('/api/explore/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      routesConfigured: false,
      smartRoutesConfigured: false,
      supportedTravelModes: ['bicycle'],
      routeNotice: 'Explore routes favor bicycle-accessible roads and paths and avoid major interstates.',
    });

    const unauthorizedRoute = await fetch(`${baseUrl}/api/explore/route`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin: { lat: 38.5, lng: -120.2 },
        destination: { lat: 38.6, lng: -120.1 },
        travelMode: 'bicycle',
      }),
    });
    expect(unauthorizedRoute.status).toBe(401);

    const unauthorizedElevation = await fetch(`${baseUrl}/api/explore/elevation`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceMeters: 1_000,
      }),
    });
    expect(unauthorizedElevation.status).toBe(401);
  });

  it('protects production metrics and exposes redacted process telemetry to operators', async () => {
    const unauthorized = await api('/api/metrics');
    expect(unauthorized.status).toBe(401);

    const authorized = await api('/api/metrics', {
      headers: { Authorization: 'Bearer test-metrics-token' },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('content-type')).toContain('text/plain');
    const metrics = await authorized.text();
    expect(metrics).toContain('tracklab_process_uptime_seconds{service="tracklab-cloud"}');
    expect(metrics).toContain('tracklab_http_requests_total');
    expect(metrics).not.toContain('test-metrics-token');
  });

  it('requires authentication for profile data', async () => {
    const response = await fetch(`${baseUrl}/api/user-data`);
    expect(response.status).toBe(401);

    const mappingSave = await fetch(`${baseUrl}/api/user-data/track-mapping`, {
      method: 'POST',
      headers: { Origin: baseUrl },
    });
    expect(mappingSave.status).toBe(401);

    const personalRoutes = await fetch(`${baseUrl}/api/explore/recent-routes`);
    expect(personalRoutes.status).toBe(401);

    const commentary = await fetch(`${baseUrl}/api/commentary/line`, {
      method: 'POST',
      headers: { Origin: baseUrl },
    });
    expect(commentary.status).toBe(401);
  });

  it('keeps profile reads and writes bound to the authenticated account', async () => {
    const email = 'club-owner-admin@tracklab.test';
    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Review Rider', email, password: 'correct-horse-battery-staple' }),
    });
    expect(registration.status).toBe(201);
    cookie = String(registration.headers.get('set-cookie')).split(';')[0];

    const saved = await api('/api/user-data?profileKey=user:someone-else', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          photoUrl: 'data:image/png;base64,QUJDRA==',
          updatedAt: 210,
        },
        bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }],
        studioRiders: [{
          id: 'rider-jordan',
          name: 'Jordan',
          photoUrl: 'data:image/jpeg;base64,QUJDRA==',
          createdAt: 100,
          updatedAt: 100,
        }],
        raceViewPreferences: {
          cameraLocked: true,
          cameraLockedUpdatedAt: 200,
          earthCamerasByTrack: {
            'north-bay-bmx': {
              angle: 42,
              heading: 180,
              zoom: 19,
              referenceViewport: { width: 1366.125, height: 1024.555 },
              updatedAt: 200,
            },
          },
          riderOverlaysByTrack: {
            'north-bay-bmx': {
              xPct: 0.08,
              yPct: 0.72,
              width: 1040,
              height: 190,
              locked: true,
              referenceViewport: { width: 1366.125, height: 1024.555 },
            },
          },
          riderOverlayUpdatedAtByTrack: {
            'north-bay-bmx': 200,
          },
          demoRiderNames: {
            1: 'Maya Torres',
            2: 'Jordan Lee',
            5: 'Invalid Lane',
          },
          demoRiderNamesUpdatedAt: 200,
          demoRiderPhotos: {
            1: 'data:image/jpeg;base64,QUJDRA==',
            2: 'data:image/svg+xml;base64,PHN2Zz4=',
          },
          demoRiderPhotosUpdatedAt: 200,
          commentary: {
            enabled: true,
            ambientEnabled: false,
            ambientVolume: 0.11,
            ambientVolumeLocked: true,
            model: 'gpt-5.6-sol',
            voicePreset: 'american-man',
            volume: 0.75,
            adaptiveMemory: true,
            recentLines: ['Avery takes it to the stripe.'],
          },
          commentaryUpdatedAt: 200,
        },
      }),
    });
    expect(saved.status).toBe(200);

    const loaded = await api('/api/user-data?profileKey=user:someone-else');
    expect(loaded.status).toBe(200);
    const loadedPayload = await loaded.json();
    expect(loadedPayload).toMatchObject({
      accountProfile: {
        photoUrl: 'data:image/png;base64,QUJDRA==',
        updatedAt: 210,
      },
      bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }],
      studioRiders: [{
        id: 'rider-jordan',
        name: 'Jordan',
        photoUrl: 'data:image/jpeg;base64,QUJDRA==',
        createdAt: 100,
        updatedAt: 100,
      }],
      raceViewPreferences: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 200,
        earthCamerasByTrack: {
          'north-bay-bmx': {
            angle: 42,
            heading: 180,
            zoom: 19,
            referenceViewport: { width: 1366.13, height: 1024.56 },
            updatedAt: 200,
          },
        },
        riderOverlaysByTrack: {
          'north-bay-bmx': {
            xPct: 0.08,
            yPct: 0.72,
            width: 1040,
            height: 190,
            locked: true,
            referenceViewport: { width: 1366.13, height: 1024.56 },
          },
        },
        riderOverlayUpdatedAtByTrack: {
          'north-bay-bmx': 200,
        },
        demoRiderNames: {
          1: 'Maya Torres',
          2: 'Jordan Lee',
        },
        demoRiderNamesUpdatedAt: 200,
        demoRiderPhotos: {
          1: 'data:image/jpeg;base64,QUJDRA==',
        },
        demoRiderPhotosUpdatedAt: 200,
        commentary: {
          enabled: true,
          ambientEnabled: false,
          ambientVolume: 0.11,
          ambientVolumeLocked: true,
          voicePreset: 'american-man',
          volume: 0.75,
          adaptiveMemory: true,
          recentLines: ['Avery takes it to the stripe.'],
        },
        commentaryUpdatedAt: 200,
      },
    });
    expect(loadedPayload.raceViewPreferences.commentary).not.toHaveProperty('model');

    const staleBrowserSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 100,
          earthCamerasByTrack: {
            'north-bay-bmx': { angle: 0, heading: 0, zoom: 17, updatedAt: 100 },
          },
          riderOverlaysByTrack: {
            'north-bay-bmx': {
              xPct: 0,
              yPct: 0,
              width: 320,
              height: 190,
              locked: false,
            },
          },
          riderOverlayUpdatedAtByTrack: {
            'north-bay-bmx': 100,
          },
          demoRiderNames: {},
          demoRiderNamesUpdatedAt: 100,
          demoRiderPhotos: {},
          demoRiderPhotosUpdatedAt: 100,
          commentary: {
            enabled: false,
            ambientEnabled: false,
            ambientVolume: 0.05,
            ambientVolumeLocked: true,
            voicePreset: 'american-man',
            volume: 0.6,
            adaptiveMemory: true,
            recentLines: ['A newer commentary preference.'],
          },
          commentaryUpdatedAt: 300,
        },
      }),
    });
    expect(staleBrowserSave.status).toBe(200);
    const mergedPayload = await staleBrowserSave.json();
    expect(mergedPayload.raceViewPreferences).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'north-bay-bmx': { angle: 42, heading: 180, zoom: 19, updatedAt: 200 },
      },
      riderOverlaysByTrack: {
        'north-bay-bmx': {
          xPct: 0.08,
          yPct: 0.72,
          width: 1040,
          height: 190,
          locked: true,
        },
      },
      demoRiderNames: {
        1: 'Maya Torres',
        2: 'Jordan Lee',
      },
      demoRiderPhotos: {
        1: 'data:image/jpeg;base64,QUJDRA==',
      },
      commentary: {
        enabled: false,
        volume: 0.6,
        recentLines: ['A newer commentary preference.'],
      },
    });

    const savedRoute = await api('/api/explore/recent-routes?profileKey=user:someone-else', {
      method: 'POST',
      body: JSON.stringify({ routes: [exploreRoute('EXPLORE-PERSONAL-1')] }),
    });
    expect(savedRoute.status).toBe(200);
    await expect(savedRoute.json()).resolves.toMatchObject({
      routes: [{ id: 'EXPLORE-PERSONAL-1', name: 'My San Francisco ride' }],
    });

    const trainingStartedAt = Date.now() - 20_000;
    for (const [index, activityType] of ['bmx-race', 'straight-sprint', 'explore', 'get-pulled'].entries()) {
      const trainingSave = await api('/api/training-sessions', {
        method: 'POST',
        body: JSON.stringify({
          session: {
            id: `training-${activityType}-${trainingStartedAt}`,
            activityType,
            title: `${activityType} training`,
            startedAt: trainingStartedAt + index * 1_000,
            endedAt: trainingStartedAt + index * 1_000 + 8_000,
            durationMs: 8_000,
            distanceMeters: activityType === 'explore' ? 3_218.688 : activityType === 'get-pulled' ? 18 : 320,
            trackId: 'north-bay-bmx',
            trackName: 'North Bay BMX',
            details: activityType === 'get-pulled'
              ? {
                durationSeconds: 6,
                airSetting: 7,
                recordKey: '6s-air-7',
                riders: [{ playerId: 1, riderName: 'Review Rider', distanceMeters: 18, peakWatts: 1240 }],
              }
              : { riderName: 'Review Rider', attempt: index + 1 },
          },
        }),
      });
      expect(trainingSave.status).toBe(201);
    }

    const trainingHistory = await api(`/api/training-sessions?from=${trainingStartedAt - 1_000}&to=${Date.now()}&limit=20`);
    expect(trainingHistory.status).toBe(200);
    await expect(trainingHistory.json()).resolves.toMatchObject({
      totals: {
        sessions: 4,
        bmxRaces: 1,
        straightSprints: 1,
        exploreRides: 1,
        getPulledTests: 1,
        distanceMeters: 3_876.688,
        durationMs: 32_000,
      },
    });

    const firstAccountCookie = cookie;
    secondaryEmail = `other-${Date.now()}@tracklab.test`;
    const secondRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Other Rider',
        email: secondaryEmail,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(secondRegistration.status).toBe(201);
    cookie = String(secondRegistration.headers.get('set-cookie')).split(';')[0];
    secondaryCookie = cookie;

    const otherAccountRoutes = await api('/api/explore/recent-routes?profileKey=user:someone-else');
    expect(otherAccountRoutes.status).toBe(200);
    await expect(otherAccountRoutes.json()).resolves.toEqual({ routes: [] });

    const otherAccountTraining = await api(`/api/training-sessions?from=${trainingStartedAt - 1_000}&to=${Date.now()}`);
    expect(otherAccountTraining.status).toBe(200);
    await expect(otherAccountTraining.json()).resolves.toMatchObject({ sessions: [], totals: { sessions: 0 } });

    const otherAccountClubState = await api('/api/club-connect');
    expect(otherAccountClubState.status).toBe(200);
    await expect(otherAccountClubState.json()).resolves.toMatchObject({ ownedClub: null });

    const personalPowerSessionId = `personal-power-${Date.now()}`;
    const personalPowerStartedAt = Date.now() - 2 * 60 * 60_000;
    const personalPowerSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: personalPowerSessionId,
          activityType: 'straight-sprint',
          title: 'Personal power review',
          startedAt: personalPowerStartedAt,
          endedAt: personalPowerStartedAt + 1_000,
          durationMs: 1_000,
          distanceMeters: 9.144,
          details: {
            summaries: [{
              playerId: 1,
              riderName: 'Other Rider',
              topWatts: 1_120,
              averageWatts: 875,
            }],
          },
        },
      }),
    });
    expect(personalPowerSave.status).toBe(201);
    const personalPowerHistory = await api('/api/training-sessions?from=0');
    expect(personalPowerHistory.status).toBe(200);
    const personalPowerHistoryPayload = await personalPowerHistory.json();
    const personalPowerSession = personalPowerHistoryPayload.sessions.find(
      (session: { id: string }) => session.id === personalPowerSessionId,
    );
    expect(personalPowerSession).toBeDefined();
    expect(personalPowerSession).not.toHaveProperty('club');
    expect(personalPowerSession).toMatchObject({
      details: {
        summaries: [{ topWatts: 1_120, averageWatts: 875 }],
      },
    });

    cookie = firstAccountCookie;
    const restoredAfterBrowserReset = await api('/api/explore/recent-routes');
    expect(restoredAfterBrowserReset.status).toBe(200);
    await expect(restoredAfterBrowserReset.json()).resolves.toMatchObject({
      routes: [{ id: 'EXPLORE-PERSONAL-1' }],
    });
  });

  it('keeps the newest account unit preference across stale and concurrent cloud writes', async () => {
      const initialSave = await api('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({
          unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 200 },
        }),
      });
      expect(initialSave.status).toBe(200);
      await expect(initialSave.json()).resolves.toMatchObject({
        unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 200 },
      });

      const staleSave = await api('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({
          unitPreferences: { speedUnit: 'kph', distanceUnit: 'm', updatedAt: 100 },
        }),
      });
      expect(staleSave.status).toBe(200);
      await expect(staleSave.json()).resolves.toMatchObject({
        unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: 200 },
      });

      const newerUpdatedAt = Date.now();
      const [newerSave, olderSave] = await Promise.all([
        api('/api/user-data', {
          method: 'PATCH',
          body: JSON.stringify({
            unitPreferences: { speedUnit: 'kph', distanceUnit: 'm', updatedAt: newerUpdatedAt },
          }),
        }),
        api('/api/user-data', {
          method: 'PATCH',
          body: JSON.stringify({
            unitPreferences: { speedUnit: 'mph', distanceUnit: 'ft', updatedAt: newerUpdatedAt - 1 },
          }),
        }),
      ]);
      expect(newerSave.status).toBe(200);
      expect(olderSave.status).toBe(200);

      const loaded = await api('/api/user-data');
      expect(loaded.status).toBe(200);
      await expect(loaded.json()).resolves.toMatchObject({
        unitPreferences: { speedUnit: 'kph', distanceUnit: 'm', updatedAt: newerUpdatedAt },
      });

      const beforeFutureSave = Date.now();
      const futureSave = await api('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({
          unitPreferences: {
            speedUnit: 'mph',
            distanceUnit: 'ft',
            updatedAt: beforeFutureSave + 24 * 60 * 60 * 1000,
          },
        }),
      });
      expect(futureSave.status).toBe(200);
      const futurePayload = await futureSave.json();
      expect(futurePayload.unitPreferences).toMatchObject({ speedUnit: 'mph', distanceUnit: 'ft' });
      expect(futurePayload.unitPreferences.updatedAt).toBeGreaterThanOrEqual(beforeFutureSave);
      expect(futurePayload.unitPreferences.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it('lets a student privately claim only their studio training record', async () => {
    const now = Date.now();
    const ownerCookie = cookie;

    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: 'studio-maya', name: 'Maya Torres', createdAt: now, updatedAt: now },
          { id: 'studio-jordan', name: 'Jordan Lee', createdAt: now, updatedAt: now },
        ],
      }),
    });
    expect(rosterSave.status).toBe(200);
    const monitorCookie = ownerCookie;

    const trainingSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: `club-race-${now}`,
          activityType: 'bmx-race',
          title: 'North Bay BMX race',
          startedAt: now - 10_000,
          endedAt: now - 1_000,
          durationMs: 9_000,
          distanceMeters: 320,
          trackId: 'north-bay-bmx',
          trackName: 'North Bay BMX',
          details: {
            summaries: [
              { playerId: 1, riderId: 'studio-maya', riderName: 'Maya Torres', rank: 1, finishTimeMs: 8_100, distanceMeters: 320 },
              { playerId: 2, riderId: 'studio-jordan', riderName: 'Jordan Lee', rank: 2, finishTimeMs: 8_500, distanceMeters: 320 },
            ],
            zoneResults: [{ zoneId: 'zone-1', riders: [{ playerId: 1, topWatts: 900 }, { playerId: 2, topWatts: 850 }] }],
            events: [{ label: 'Maya Torres leads Jordan Lee' }],
          },
        },
      }),
    });
    expect(trainingSave.status).toBe(201);

    const legacyNameRaceId = `legacy-name-race-${now}`;
    const legacyNameRaceSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: legacyNameRaceId,
          activityType: 'bmx-race',
          title: 'Legacy name-only race',
          startedAt: now - 9_500,
          endedAt: now - 1_500,
          durationMs: 8_000,
          distanceMeters: 300,
          trackId: 'legacy-name-track',
          trackName: 'Legacy Name Track',
          details: {
            summaries: [{
              playerId: 3,
              riderName: 'Maya Torres',
              finishTimeMs: 7_900,
              distanceMeters: 300,
              topWatts: 1_050,
              averageWatts: 790,
              allowedBikeNote: 'allowed bike result',
              siblingTelemetry: { riderName: 'Jordan Lee', privateValue: 'race sibling secret' },
              pulse: 188,
              restingPulse: 51,
              AppleWatch: { bpm: 188 },
            }],
            reactionTimesByPlayer: { 3: 177, 4: 199 },
            zoneResults: [
              {
                zoneId: 'maya-zone',
                zoneName: 'Maya drive',
                zoneType: 'pedal',
                startMeter: 5,
                endMeter: 25,
                siblingTelemetry: 'zone sibling secret',
                riders: [{ playerId: 3, topWatts: 1_020, pulse: 187 }],
              },
              {
                zoneId: 'sibling-only-zone',
                zoneName: 'Jordan private zone',
                zoneType: 'pedal',
                startMeter: 25,
                endMeter: 50,
                riders: [{ playerId: 4, topWatts: 990 }],
              },
            ],
            events: [{ label: 'sibling event secret' }],
            siblingTelemetry: { privateValue: 'top-level sibling secret' },
            healthKit: { bpm: 188 },
            appleHealth: { restingBpm: 51 },
            hrv: 44,
          },
        },
      }),
    });
    expect(legacyNameRaceSave.status).toBe(201);
    const legacyNameRaceSavePayload = await legacyNameRaceSave.json();
    expect(JSON.stringify(legacyNameRaceSavePayload.session.details)).not.toMatch(
      /apple.?watch|apple.?health|health.?kit|resting.?pulse|"pulse"|"hrv"|"bpm"/iu,
    );

    const legacyExploreId = `legacy-name-explore-${now}`;
    expect((await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: legacyExploreId,
          activityType: 'explore',
          title: 'Legacy Explore ride',
          startedAt: now - 9_000,
          endedAt: now - 1_000,
          durationMs: 8_000,
          distanceMeters: 1_000,
          details: {
            originLabel: 'Studio start',
            destinationLabel: 'Hill finish',
            travelMode: 'bicycle',
            elevationGainMeters: 31.5,
            elevationLossMeters: 12.25,
            activeClockSegments: [{
              startedAt: now - 9_000,
              endedAt: now - 1_000,
              activeElapsedAtStartMs: 0,
              siblingTelemetry: 'segment sibling secret',
            }],
            riders: [
              {
                playerId: 3,
                riderName: 'Maya Torres',
                distanceMeters: 1_000,
                averageSpeedMph: 12,
                siblingTelemetry: 'explore sibling secret',
              },
              { playerId: 4, riderName: 'Jordan Lee', distanceMeters: 950 },
            ],
            siblingTelemetry: 'explore top-level sibling secret',
          },
        },
      }),
    })).status).toBe(201);

    const legacyPullId = `legacy-name-pull-${now}`;
    expect((await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: legacyPullId,
          activityType: 'get-pulled',
          title: 'Legacy Get Pulled',
          startedAt: now - 8_500,
          endedAt: now - 2_500,
          durationMs: 6_000,
          distanceMeters: 24,
          details: {
            durationSeconds: 6,
            airSetting: 7,
            recordKey: 'forged-private-record-key',
            riders: [{
              playerId: 3,
              riderName: 'Maya Torres',
              distanceMeters: 24,
              peakWatts: 1_030,
              averageWatts: 780,
              siblingTelemetry: 'pull sibling secret',
            }],
            siblingTelemetry: 'pull top-level sibling secret',
          },
        },
      }),
    })).status).toBe(201);

    const legacyMonitorId = `legacy-name-monitor-${now}`;
    expect((await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: legacyMonitorId,
          activityType: 'monitor-sprint',
          title: 'Legacy monitor sprint',
          startedAt: now - 8_000,
          endedAt: now - 2_000,
          durationMs: 6_000,
          distanceMeters: 70,
          details: {
            riders: [{
              playerId: 3,
              riderName: 'Maya Torres',
              distanceMeters: 70,
              peakWatts: 1_010,
              averageWatts: 770,
              siblingTelemetry: 'monitor sibling secret',
            }],
            monitor: { siblingTelemetry: 'monitor device secret' },
          },
        },
      }),
    })).status).toBe(201);

    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-maya' }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json();
    expect(invite.token).toHaveLength(43);

    cookie = secondaryCookie;
    const athleteCookie = cookie;

    const claim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({
        token: invite.token,
        fullName: 'Maya Alexandria Torres',
        nickname: 'Rocket',
        photoUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    });
    expect(claim.status).toBe(200);
    const claimPayload = await claim.json();
    expect(claimPayload).toMatchObject({
      canManageClub: false,
      user: { name: 'Maya Alexandria Torres (Rocket)', membership: { tier: 'spectator' } },
      accountProfile: { photoUrl: 'data:image/png;base64,aGVsbG8=' },
      memberships: [{ clubName: 'Review Rider', studioRiderId: 'studio-maya', riderName: 'Maya Torres' }],
    });
    const claimedMembership = claimPayload.memberships[0];

    await new Promise((resolve) => setTimeout(resolve, 5));
    cookie = ownerCookie;
    const postClaimNameInjectionId = `post-claim-name-injection-${now}`;
    const postClaimNameInjectionSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: postClaimNameInjectionId,
          activityType: 'straight-sprint',
          title: 'Post-claim owner name injection',
          startedAt: now - 750,
          endedAt: now - 250,
          durationMs: 500,
          distanceMeters: 30,
          details: {
            summaries: [{
              playerId: 6,
              riderName: 'Maya Torres',
              finishTimeMs: 500,
              distanceMeters: 30,
              topWatts: 9_999,
            }],
          },
        },
      }),
    });
    expect(postClaimNameInjectionSave.status).toBe(201);

    const jordanInviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-jordan' }),
    });
    expect(jordanInviteResponse.status).toBe(201);
    const jordanInvite = await jordanInviteResponse.json();

    cookie = '';
    const jordanRegistration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.77' },
      body: JSON.stringify({
        name: 'Jordan Account',
        email: `jordan-attribution-${now}@tracklab.test`,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(jordanRegistration.status).toBe(201);
    cookie = String(jordanRegistration.headers.get('set-cookie')).split(';')[0];
    const jordanClaim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: jordanInvite.token, fullName: 'Jordan Lee' }),
    });
    expect(jordanClaim.status).toBe(200);
    const jordanClaimPayload = await jordanClaim.json();
    const jordanMembership = jordanClaimPayload.memberships[0];
    expect(jordanMembership).toMatchObject({
      clubId: claimedMembership.clubId,
      studioRiderId: 'studio-jordan',
    });

    const jordanAttributedSessionId = `jordan-attributed-${now}`;
    const jordanAttributedSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: jordanMembership.clubId,
          studioRiderId: jordanMembership.studioRiderId,
        },
        session: {
          id: jordanAttributedSessionId,
          activityType: 'bmx-race',
          title: 'Jordan attributed adversarial race',
          startedAt: now - 700,
          endedAt: now - 200,
          durationMs: 500,
          distanceMeters: 35,
          details: {
            summaries: [
              {
                playerId: 1,
                riderId: 'studio-maya',
                riderName: 'Maya Torres',
                finishTimeMs: 450,
                topWatts: 1_500,
                siblingTelemetry: 'attributed sibling secret',
              },
              {
                playerId: 2,
                riderId: 'studio-jordan',
                riderName: 'Jordan Lee',
                finishTimeMs: 500,
                topWatts: 1_100,
              },
            ],
            reactionTimesByPlayer: { 1: 175, 2: 190 },
            zoneResults: [
              {
                zoneId: 'shared-attributed-zone',
                zoneName: 'Shared attributed zone',
                zoneType: 'pedal',
                startMeter: 5,
                endMeter: 25,
                siblingTelemetry: 'attributed zone sibling secret',
                riders: [
                  { playerId: 1, topWatts: 1_450, siblingTelemetry: 'Maya zone secret' },
                  { playerId: 2, topWatts: 1_050, sampleCount: 8 },
                ],
              },
              {
                zoneId: 'maya-only-attributed-zone',
                zoneName: 'Maya private attributed zone',
                zoneType: 'pedal',
                startMeter: 25,
                endMeter: 45,
                riders: [{ playerId: 1, topWatts: 1_400 }],
              },
            ],
            events: [{ label: 'attributed sibling event secret' }],
            siblingTelemetry: { privateValue: 'attributed top-level sibling secret' },
          },
        },
      }),
    });
    expect(jordanAttributedSave.status).toBe(201);
    await expect(jordanAttributedSave.json()).resolves.toMatchObject({
      session: { club: { studioRiderId: 'studio-jordan', role: 'athlete' } },
    });

    cookie = athleteCookie;

    const athleteClubState = await api('/api/club-connect?profileKey=user:club-owner');
    expect(athleteClubState.status).toBe(200);
    const athleteClubPayload = await athleteClubState.json();
    expect(athleteClubPayload).toMatchObject({
      canManageClub: false,
      ownedClub: null,
      memberships: [{ studioRiderId: 'studio-maya', riderName: 'Maya Torres' }],
    });
    expect(JSON.stringify(athleteClubPayload)).not.toContain('studio-jordan');
    expect(JSON.stringify(athleteClubPayload)).not.toContain('Jordan Lee');

    const copiedRosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: 'studio-jordan', name: 'Jordan Lee', createdAt: now, updatedAt: now },
        ],
        accountProfile: {
          photoUrl: 'data:image/png;base64,aGVsbG8=',
          updatedAt: now + 100_000,
        },
      }),
    });
    expect(copiedRosterSave.status).toBe(200);
    await expect(copiedRosterSave.json()).resolves.toMatchObject({
      studioRiders: [],
      accountProfile: {
        photoUrl: 'data:image/png;base64,aGVsbG8=',
        updatedAt: now + 100_000,
      },
    });
    const athleteUserData = await api('/api/user-data?profileKey=user:club-owner');
    expect(athleteUserData.status).toBe(200);
    const athleteUserDataPayload = await athleteUserData.json();
    expect(athleteUserDataPayload.studioRiders).toEqual([]);
    expect(JSON.stringify(athleteUserDataPayload)).not.toContain('studio-jordan');
    expect(JSON.stringify(athleteUserDataPayload)).not.toContain('Jordan Lee');
    const forbiddenAthleteInvite = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-jordan' }),
    });
    expect(forbiddenAthleteInvite.status).toBe(403);
    await expect(forbiddenAthleteInvite.json()).resolves.toEqual({
      error: 'Only the TrackLab club owner can invite studio athletes.',
    });
    const athleteStateAfterForbiddenInvite = await api('/api/club-connect');
    await expect(athleteStateAfterForbiddenInvite.json()).resolves.toMatchObject({
      canManageClub: false,
      ownedClub: null,
      memberships: [{ studioRiderId: 'studio-maya' }],
    });

    const athleteHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    expect(athleteHistory.status).toBe(200);
    const athleteHistoryPayload = await athleteHistory.json();
    expect(athleteHistoryPayload.sessions).toHaveLength(5);
    expect(athleteHistoryPayload.sessions.map((session: { id: string }) => session.id)).not.toContain(
      postClaimNameInjectionId,
    );
    expect(athleteHistoryPayload.sessions.some(
      (session: { id: string }) => session.id.includes(jordanAttributedSessionId),
    )).toBe(false);
    const originalLegacyRace = athleteHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(`club-race-${now}`),
    );
    expect(originalLegacyRace.details.summaries).toEqual([
      expect.objectContaining({ riderId: 'studio-maya', riderName: 'Maya Torres' }),
    ]);
    expect(originalLegacyRace.details.zoneResults[0].riders).toEqual([
      expect.objectContaining({ playerId: 1, topWatts: 900 }),
    ]);
    expect(originalLegacyRace.details.events).toEqual([]);

    const projectedLegacyNameRace = athleteHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(legacyNameRaceId),
    );
    expect(projectedLegacyNameRace).toMatchObject({
      details: {
        summaries: [{
          playerId: 3,
          riderName: 'Maya Torres',
          finishTimeMs: 7_900,
          topWatts: 1_050,
          averageWatts: 790,
        }],
        reactionTimesByPlayer: { 3: 177 },
        zoneResults: [{
          zoneId: 'maya-zone',
          riders: [{ playerId: 3, topWatts: 1_020 }],
        }],
        events: [],
      },
    });
    expect(Object.keys(projectedLegacyNameRace.details).sort()).toEqual([
      'club', 'events', 'reactionTimesByPlayer', 'summaries', 'zoneResults',
    ]);
    expect(Object.keys(projectedLegacyNameRace.details.summaries[0]).sort()).toEqual([
      'averageWatts', 'distanceMeters', 'finishTimeMs', 'playerId', 'riderName', 'topWatts',
    ]);
    expect(projectedLegacyNameRace.details.zoneResults).toHaveLength(1);

    const projectedExplore = athleteHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(legacyExploreId),
    );
    expect(projectedExplore).toMatchObject({
      details: {
        originLabel: 'Studio start',
        destinationLabel: 'Hill finish',
        travelMode: 'bicycle',
        elevationGainMeters: 31.5,
        elevationLossMeters: 12.25,
        activeClockSegments: [{
          startedAt: now - 9_000,
          endedAt: now - 1_000,
          activeElapsedAtStartMs: 0,
        }],
        riders: [{
          playerId: 3,
          riderName: 'Maya Torres',
          distanceMeters: 1_000,
          averageSpeedMph: 12,
        }],
      },
    });
    expect(Object.keys(projectedExplore.details).sort()).toEqual([
      'activeClockSegments', 'club', 'destinationLabel', 'elevationGainMeters',
      'elevationLossMeters', 'originLabel', 'riders', 'travelMode',
    ]);

    const projectedPull = athleteHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(legacyPullId),
    );
    expect(projectedPull).toMatchObject({
      durationMs: 6_000,
      details: {
        durationSeconds: 6,
        airSetting: 7,
        recordKey: '6s-air-7',
        riders: [{ riderName: 'Maya Torres', peakWatts: 1_030, averageWatts: 780 }],
      },
    });

    const projectedMonitor = athleteHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(legacyMonitorId),
    );
    expect(projectedMonitor).toMatchObject({
      details: {
        riders: [{ riderName: 'Maya Torres', peakWatts: 1_010, averageWatts: 770 }],
      },
    });
    const initialProjectionJson = JSON.stringify(athleteHistoryPayload);
    expect(initialProjectionJson).not.toMatch(/sibling secret|sibling telemetry|Jordan private zone/iu);
    expect(initialProjectionJson).not.toMatch(
      /apple.?watch|apple.?health|health.?kit|resting.?pulse|"pulse"|"hrv"|"bpm"/iu,
    );

    const athleteHistoryStream = await openTrainingHistoryStream(athleteCookie);
    const immediateSessionId = `club-race-live-sync-${now}`;
    cookie = ownerCookie;
    const immediateSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: immediateSessionId,
          activityType: 'bmx-race',
          title: 'Mapped interval live sync',
          startedAt: now - 900,
          endedAt: now - 100,
          durationMs: 800,
          distanceMeters: 44.2,
          trackId: 'mapped-interval',
          trackName: 'Mapped interval',
          details: {
            summaries: [
              {
                playerId: 1,
                riderId: 'studio-maya',
                riderName: 'Maya Torres',
                rank: 1,
                finishTimeMs: 800,
                thirtyFootTimeMs: 420,
                distanceMeters: 44.2,
                sampleCount: 18,
                topSpeedKph: 45.4,
                averageSpeedKph: 39.2,
                topCadence: 182,
                averageCadence: 168,
                topWatts: 1_120,
                averageWatts: 875,
              },
              { playerId: 2, riderId: 'studio-jordan', riderName: 'Jordan Lee', topWatts: 980 },
            ],
            reactionTimesByPlayer: { 1: 178, 2: 204 },
            zoneResults: [{
              zoneId: 'mapped-pedal-zone',
              zoneName: 'First straight drive',
              zoneType: 'pedal',
              startMeter: 4.5,
              endMeter: 22.1,
              riders: [
                {
                  playerId: 1,
                  sampleCount: 12,
                  entryElapsedMs: 110,
                  exitElapsedMs: 490,
                  durationMs: 380,
                  topSpeedKph: 44.8,
                  averageSpeedKph: 38.6,
                  topCadence: 181,
                  averageCadence: 169.5,
                  topWatts: 1_100,
                  averageWatts: 890.5,
                },
                { playerId: 2, sampleCount: 10, topWatts: 960 },
              ],
            }],
            events: [{ label: 'Private multi-rider event' }],
          },
        },
      }),
    });
    expect(immediateSave.status).toBe(201);
    const pushedUpdate = await waitForTrainingHistoryEvent(athleteHistoryStream, 'training-history-updated');
    expect(pushedUpdate).toMatchObject({
      sessionId: immediateSessionId,
      activityType: 'bmx-race',
    });
    expect(JSON.stringify(pushedUpdate)).not.toMatch(/Maya|Jordan|watts|cadence/i);
    closeTrainingHistoryStream(athleteHistoryStream);

    cookie = athleteCookie;
    const immediateHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    expect(immediateHistory.status).toBe(200);
    const immediateHistoryPayload = await immediateHistory.json();
    const immediateAthleteSession = immediateHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(immediateSessionId),
    );
    expect(immediateAthleteSession).toMatchObject({
      details: {
        summaries: [expect.objectContaining({
          playerId: 1,
          riderId: 'studio-maya',
          topSpeedKph: 45.4,
          averageSpeedKph: 39.2,
          topCadence: 182,
          averageCadence: 168,
          topWatts: 1_120,
          averageWatts: 875,
        })],
        reactionTimesByPlayer: { 1: 178 },
        zoneResults: [{
          zoneId: 'mapped-pedal-zone',
          zoneName: 'First straight drive',
          zoneType: 'pedal',
          startMeter: 4.5,
          endMeter: 22.1,
          riders: [{
            playerId: 1,
            sampleCount: 12,
            entryElapsedMs: 110,
            exitElapsedMs: 490,
            durationMs: 380,
            topSpeedKph: 44.8,
            averageSpeedKph: 38.6,
            topCadence: 181,
            averageCadence: 169.5,
            topWatts: 1_100,
            averageWatts: 890.5,
          }],
        }],
        events: [],
      },
    });
    expect(JSON.stringify(immediateAthleteSession)).not.toContain('studio-jordan');
    expect(JSON.stringify(immediateAthleteSession)).not.toContain('Jordan Lee');

    const athleteClubSessionId = `athlete-club-sprint-${now}`;
    const athleteClubSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: claimedMembership.clubId,
          studioRiderId: claimedMembership.studioRiderId,
        },
        session: {
          id: athleteClubSessionId,
          activityType: 'straight-sprint',
          title: '300 ft club sprint',
          startedAt: now - 800,
          endedAt: now - 200,
          durationMs: 600,
          distanceMeters: 91.44,
          trackId: 'club-drag-strip',
          trackName: 'Club Drag Strip',
          details: {
            sprintDistanceFeet: 300,
            sprintAirSetting: 4,
            summaries: [{ riderId: 'studio-maya', riderName: 'Maya Torres', topWatts: 1_025 }],
          },
        },
      }),
    });
    expect(athleteClubSave.status).toBe(201);
    await expect(athleteClubSave.json()).resolves.toMatchObject({
      session: {
        id: athleteClubSessionId,
        club: {
          id: claimedMembership.clubId,
          studioRiderId: 'studio-maya',
          riderName: 'Maya Torres',
          role: 'athlete',
        },
      },
    });

    const spoofedAccess = await api('/api/club-live/access?clubId=club-not-mine');
    expect(spoofedAccess.status).toBe(403);
    const athleteMonitorRead = await api('/api/club-live/sessions');
    expect(athleteMonitorRead.status).toBe(403);

    // Club bike access is authorized by the club's paid bike seats. The owner
    // does not need to have the optional Club Live Monitor open first.
    const activeAccessWithoutMonitor = await api(
      `/api/club-live/access?clubId=${claimedMembership.clubId}`,
    );
    expect(activeAccessWithoutMonitor.status).toBe(200);
    await expect(activeAccessWithoutMonitor.json()).resolves.toMatchObject({
      clubId: claimedMembership.clubId,
      active: true,
      expiresAt: expect.any(Number),
      bikeSeats: 4,
    });
    const publishWithoutMonitor = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.1,
        metrics: { watts: 500 },
      }),
    });
    expect(publishWithoutMonitor.status).toBe(200);

    cookie = ownerCookie;
    const monitorOpen = await api('/api/club-live/sessions');
    expect(monitorOpen.status).toBe(200);
    expect(monitorOpen.headers.get('cache-control')).toBe('no-store');
    await expect(monitorOpen.json()).resolves.toMatchObject({
      club: { id: claimedMembership.clubId },
      sessions: [expect.objectContaining({
        studioRiderId: claimedMembership.studioRiderId,
        activityType: 'straight-sprint',
      })],
      bikeSeats: 4,
      heartbeatTtlMs: 600,
      pollAfterMs: 1_000,
    });

    cookie = athleteCookie;
    const activeAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    expect(activeAccess.status).toBe(200);
    expect(activeAccess.headers.get('cache-control')).toBe('no-store');
    await expect(activeAccess.json()).resolves.toMatchObject({
      clubId: claimedMembership.clubId,
      active: true,
      expiresAt: expect.any(Number),
    });

    const crossSiteGrantChange = await fetch(
      `${baseUrl}/api/club-live/access?clubId=club-not-mine`,
      {
        headers: {
          Cookie: athleteCookie,
          Origin: 'https://attacker.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      },
    );
    expect(crossSiteGrantChange.status).toBe(403);
    expect(crossSiteGrantChange.headers.get('cache-control')).toBe('no-store');
    const accessAfterCrossSiteAttempt = await api(
      `/api/club-live/access?clubId=${claimedMembership.clubId}`,
    );
    await expect(accessAfterCrossSiteAttempt.json()).resolves.toMatchObject({ active: true });

    const primarySocket = await openTestSocket(athleteCookie);
    const primaryConnected = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'connected',
    );
    primarySocket.socket.send(JSON.stringify({
      type: 'hello',
      available: true,
      bikeCount: 4,
      track: { id: 'club-live-track', name: 'Club Live Track' },
    }));
    await waitForSocketMessage(primarySocket, (message) => message.type === 'welcome');
    const primaryRoomStart = primarySocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'create-room',
      private: true,
      racerSeatCount: 4,
      track: { id: 'club-live-track', name: 'Club Live Track' },
    }));
    const primaryRoomState = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-state'
        && message.room?.members?.some((member: { id: string }) => member.id === primaryConnected.clientId),
      primaryRoomStart,
    );
    const multiplayerRoomId = primaryRoomState.room.id;
    const primaryRoomMember = primaryRoomState.room.members.find(
      (member: { id: string }) => member.id === primaryConnected.clientId,
    );
    expect(primaryRoomMember).toMatchObject({
      roomRole: 'racer',
      racerSeatCount: 1,
      membershipTier: 'racer',
    });
    expect(primaryRoomMember).not.toHaveProperty('racerAccess');
    expect(primaryRoomState.room).toMatchObject({
      hostId: primaryConnected.clientId,
      racerCount: 1,
      racerSeatCount: 1,
    });

    const duplicateSocket = await openTestSocket(athleteCookie);
    const duplicateConnected = await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'connected',
    );
    duplicateSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await waitForSocketMessage(duplicateSocket, (message) => message.type === 'welcome');
    const duplicateJoinStart = duplicateSocket.messages.length;
    duplicateSocket.socket.send(JSON.stringify({ type: 'join-room', roomId: multiplayerRoomId }));
    const duplicateRoomState = await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'room-state'
        && message.room?.members?.some((member: { id: string }) => member.id === duplicateConnected.clientId),
      duplicateJoinStart,
    );
    expect(duplicateRoomState.room.members.find(
      (member: { id: string }) => member.id === duplicateConnected.clientId,
    )).toMatchObject({ roomRole: 'spectator', racerSeatCount: 0 });
    expect(duplicateRoomState.room).toMatchObject({ racerCount: 1, racerSeatCount: 1 });

    const raceSyncStart = primarySocket.messages.length;
    const duplicateRaceSyncStart = duplicateSocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'race-sync',
      state: {
        sessionId: 'club-live-temporary-race',
        trackId: 'club-live-track',
        raceState: 'racing',
        riders: [{
          id: 'maya-live',
          playerId: 1,
          name: 'Maya Torres',
          distance: 20,
          velocity: 5,
          cadence: 200,
          speedKph: 18,
        }],
        summary: [],
      },
    }));
    await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'race-sync' && message.state?.sessionId === 'club-live-temporary-race',
      raceSyncStart,
    );
    await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'race-sync'
        && message.state?.sessionId === 'club-live-temporary-race',
      duplicateRaceSyncStart,
    );

    const retainedStateStart = duplicateSocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'race-sync',
      state: {
        sessionId: 'club-live-temporary-race',
        trackId: 'club-live-track',
        raceState: 'racing',
        riders: [{
          id: 'maya-live',
          playerId: 1,
          name: 'Maya Torres',
          distance: 9_999,
          velocity: 999,
          cadence: 200.01,
          speedKph: 151_080.1,
        }],
        summary: [],
      },
    }));
    primarySocket.socket.send(JSON.stringify({ type: 'latency', rttMs: 10, clockOffsetMs: 0 }));
    const retainedRoomState = await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'room-state'
        && message.raceStates?.some(
          (state: { sessionId?: string }) => state.sessionId === 'club-live-temporary-race',
        ),
      retainedStateStart,
    );
    expect(retainedRoomState.raceStates.find(
      (state: { sessionId?: string }) => state.sessionId === 'club-live-temporary-race',
    )?.riders[0]).toMatchObject({ distance: 20, cadence: 200, speedKph: 18 });

    // The athlete's access poll renews the short-lived seat grant. The owner
    // monitor is a read-only optional display and is not the authorization.
    await new Promise((resolve) => setTimeout(resolve, 400));
    cookie = ownerCookie;
    expect((await api('/api/club-live/sessions')).status).toBe(200);
    cookie = athleteCookie;
    const renewedAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    await expect(renewedAccess.json()).resolves.toMatchObject({ active: true });

    const livePublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        riderName: 'Forged rider name',
        athleteName: 'Forged athlete name',
        sessionId: 'live-straight-sprint-1',
        activityType: 'straight-sprint',
        status: 'active',
        progress: { percent: 45, distanceMeters: 41.15, label: '145 ft sprint' },
        metrics: {
          watts: 1_100,
          cadence: 150,
          speedKph: 42.5,
          distanceMeters: 41.15,
          elapsedMs: 6_200,
          position: 1,
          participantCount: 4,
        },
        trackName: 'Club Drag Strip',
        multiplayer: true,
        roomId: 'PRIVATE-JOIN-SECRET',
      }),
    });
    expect(livePublish.status).toBe(200);
    const livePublishPayload = await livePublish.json();
    expect(livePublishPayload.session).toMatchObject({
      clubId: claimedMembership.clubId,
      studioRiderId: 'studio-maya',
      riderName: 'Maya Torres',
      athleteName: 'Maya Alexandria Torres (Rocket)',
      activityType: 'straight-sprint',
      status: 'active',
      progress: { fraction: 0.45, distanceMeters: 41.15, label: '145 ft sprint' },
      metrics: { watts: 1_100, participantCount: 4 },
      multiplayer: true,
    });
    expect(livePublishPayload.session).not.toHaveProperty('roomId');
    expect(livePublishPayload.session).not.toHaveProperty('_publisherProfileKey');
    expect(JSON.stringify(livePublishPayload)).not.toContain('PRIVATE-JOIN-SECRET');
    expect(JSON.stringify(livePublishPayload)).not.toContain('Forged rider name');

    const liveScreenFrame = {
      clubId: claimedMembership.clubId,
      studioRiderId: claimedMembership.studioRiderId,
      sessionId: livePublishPayload.session.sessionId,
      jpegDataUrl: onePixelJpegDataUrl,
      width: 1,
      height: 1,
      capturedAt: Date.now(),
    };
    const publishedFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify(liveScreenFrame),
    });
    expect(publishedFrame.status).toBe(200);
    expect(publishedFrame.headers.get('cache-control')).toBe('no-store');
    await expect(publishedFrame.json()).resolves.toMatchObject({
      frame: {
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        riderName: 'Maya Torres',
        sessionId: 'live-straight-sprint-1',
        activityType: 'straight-sprint',
        contentType: 'image/jpeg',
        jpegDataUrl: onePixelJpegDataUrl,
        width: 1,
        height: 1,
        byteLength: expect.any(Number),
      },
      heartbeatTtlMs: 300,
    });

    const wrongFrameSession = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({ ...liveScreenFrame, sessionId: 'another-session' }),
    });
    expect(wrongFrameSession.status).toBe(409);
    const oversizedFrameDimensions = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({ ...liveScreenFrame, width: 1_281 }),
    });
    expect(oversizedFrameDimensions.status).toBe(400);
    const oversizedJpegBytes = Buffer.alloc((350 * 1024) + 1);
    oversizedJpegBytes.set([0xff, 0xd8, 0xff], 0);
    oversizedJpegBytes.set([0xff, 0xd9], oversizedJpegBytes.length - 2);
    const oversizedFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({
        ...liveScreenFrame,
        jpegDataUrl: `data:image/jpeg;base64,${oversizedJpegBytes.toString('base64')}`,
      }),
    });
    expect(oversizedFrame.status).toBe(413);
    const crossAthleteFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({ ...liveScreenFrame, studioRiderId: 'studio-jordan' }),
    });
    expect(crossAthleteFrame.status).toBe(409);
    const athleteFrameRead = await api('/api/club-live/frames');
    expect(athleteFrameRead.status).toBe(403);

    cookie = ownerCookie;
    const ownerLiveSessions = await api('/api/club-live/sessions');
    const ownerLivePayload = await ownerLiveSessions.json();
    expect(ownerLivePayload.sessions).toHaveLength(1);
    expect(ownerLivePayload.sessions[0]).toMatchObject({
      studioRiderId: 'studio-maya',
      activityType: 'straight-sprint',
      metrics: { watts: 1_100 },
      multiplayer: true,
    });
    expect(JSON.stringify(ownerLivePayload)).not.toContain('PRIVATE-JOIN-SECRET');
    const ownerLiveFrames = await api('/api/club-live/frames');
    expect(ownerLiveFrames.status).toBe(200);
    expect(ownerLiveFrames.headers.get('cache-control')).toBe('no-store');
    const ownerFramePayload = await ownerLiveFrames.json();
    expect(ownerFramePayload.frames).toHaveLength(1);
    expect(ownerFramePayload.frames[0]).toMatchObject({
      clubId: claimedMembership.clubId,
      studioRiderId: 'studio-maya',
      sessionId: 'live-straight-sprint-1',
      jpegDataUrl: onePixelJpegDataUrl,
    });
    expect(JSON.stringify(ownerFramePayload)).not.toMatch(/_publisher|Maya Alexandria/u);
    const ownerFramesEtag = ownerLiveFrames.headers.get('etag');
    expect(ownerFramesEtag).toMatch(/^"[A-Za-z0-9_-]{32}"$/u);
    const unchangedOwnerFrames = await api('/api/club-live/frames', {
      headers: { 'If-None-Match': ownerFramesEtag! },
    });
    expect(unchangedOwnerFrames.status).toBe(304);

    await new Promise((resolve) => setTimeout(resolve, 350));
    const expiredOwnerFrames = await api('/api/club-live/frames');
    await expect(expiredOwnerFrames.json()).resolves.toMatchObject({ frames: [] });

    cookie = athleteCookie;
    const frameCascadeHeartbeat = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'live-straight-sprint-1',
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.5,
        metrics: { watts: 1_050, cadence: 145, speedKph: 41 },
      }),
    });
    expect(frameCascadeHeartbeat.status).toBe(200);
    const cascadeFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({ ...liveScreenFrame, capturedAt: Date.now() }),
    });
    expect(cascadeFrame.status).toBe(200);
    const staleLiveSessionStop = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'older-personal-activity-session',
      }),
    });
    await expect(staleLiveSessionStop.json()).resolves.toEqual({ stopped: false });
    const missingLiveSessionStop = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
      }),
    });
    expect(missingLiveSessionStop.status).toBe(400);
    cookie = ownerCookie;
    await expect((await api('/api/club-live/frames')).json()).resolves.toMatchObject({
      frames: [expect.objectContaining({ sessionId: 'live-straight-sprint-1' })],
    });
    cookie = athleteCookie;
    const stoppedLiveSession = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'live-straight-sprint-1',
      }),
    });
    await expect(stoppedLiveSession.json()).resolves.toEqual({ stopped: true });
    cookie = ownerCookie;
    await expect((await api('/api/club-live/frames')).json()).resolves.toMatchObject({ frames: [] });
    cookie = athleteCookie;
    const passiveExpiryStart = primarySocket.messages.length;
    const accessBeforePassiveExpiry = await api(
      `/api/club-live/access?clubId=${claimedMembership.clubId}`,
    );
    await expect(accessBeforePassiveExpiry.json()).resolves.toMatchObject({ active: true });
    const expiringPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'restored-explore-session',
        activityType: 'explore',
        status: 'active',
        progress: 0.2,
        metrics: { speedKph: 20, distanceMeters: 500 },
      }),
    });
    expect(expiringPublish.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const passivelyDemotedState = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-state'
        && message.room?.id === multiplayerRoomId
        && message.room?.members?.find(
          (member: { id: string }) => member.id === primaryConnected.clientId,
        )?.roomRole === 'spectator',
      passiveExpiryStart,
    );
    expect(passivelyDemotedState.room).toMatchObject({
      hostId: null,
      racerCount: 0,
      racerSeatCount: 0,
    });
    expect(passivelyDemotedState.raceStates).toEqual([]);

    const expiredControlStart = primarySocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'room-vote-start',
      candidates: [1, 2, 3].map((index) => ({
        id: `expired-vote-track-${index}`,
        name: `Expired Track ${index}`,
        hasPedalZones: true,
      })),
    }));
    await expect(waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-error'
        && String(message.message).includes('Only the room host'),
      expiredControlStart,
    )).resolves.toBeTruthy();

    const restoredAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    await expect(restoredAccess.json()).resolves.toMatchObject({
      active: true,
      expiresAt: expect.any(Number),
      bikeSeats: 4,
    });
    const heldPersonalEndSessionId = 'held-personal-end-session';
    const heldPersonalEndPublish = await beginHeldJsonRequest('/api/club-live/sessions', {
      authCookie: athleteCookie,
      body: {
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: heldPersonalEndSessionId,
        activityType: 'explore',
        status: 'active',
        progress: 0.25,
        metrics: { speedKph: 20, distanceMeters: 550 },
      },
    });
    const heldPersonalEnd = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: heldPersonalEndSessionId,
      }),
    });
    await expect(heldPersonalEnd.json()).resolves.toEqual({ stopped: false });
    heldPersonalEndPublish.release();
    expect((await heldPersonalEndPublish.responsePromise).status).toBe(409);

    const secondAthleteLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: secondaryEmail,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(secondAthleteLogin.status).toBe(200);
    const secondAthleteCookie = String(secondAthleteLogin.headers.get('set-cookie')).split(';')[0];
    cookie = secondAthleteCookie;
    expect((await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`)).status).toBe(200);
    const heldPersonalLogoutSessionId = 'held-personal-logout-session';
    const heldPersonalLogoutPublish = await beginHeldJsonRequest('/api/club-live/sessions', {
      authCookie: secondAthleteCookie,
      body: {
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: heldPersonalLogoutSessionId,
        activityType: 'explore',
        status: 'active',
        progress: 0.27,
        metrics: { speedKph: 20.5, distanceMeters: 575 },
      },
    });
    expect((await api('/api/auth/logout', { method: 'POST' })).status).toBe(200);
    heldPersonalLogoutPublish.release();
    expect([401, 409]).toContain((await heldPersonalLogoutPublish.responsePromise).status);
    cookie = athleteCookie;
    expect((await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`)).status).toBe(200);

    cookie = ownerCookie;
    const sessionsAfterHeldPersonalStops = await api('/api/club-live/sessions').then((response) => response.json());
    expect(sessionsAfterHeldPersonalStops.sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: heldPersonalEndSessionId }),
      expect.objectContaining({ sessionId: heldPersonalLogoutSessionId }),
    ]));
    cookie = athleteCookie;
    const restoredPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'restored-explore-session',
        activityType: 'explore',
        status: 'active',
        progress: 0.3,
        metrics: { speedKph: 21, distanceMeters: 600 },
      }),
    });
    expect(restoredPublish.status).toBe(200);
    cookie = ownerCookie;
    const restoredMonitorSessions = await api('/api/club-live/sessions');
    await expect(restoredMonitorSessions.json()).resolves.toMatchObject({
      sessions: [expect.objectContaining({ studioRiderId: claimedMembership.studioRiderId })],
    });
    cookie = athleteCookie;
    const finalStop = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'restored-explore-session',
      }),
    });
    expect(finalStop.status).toBe(200);
    const releaseSeat = await api('/api/club-live/access?clubId=');
    expect(releaseSeat.status).toBe(403);
    primarySocket.socket.close();
    duplicateSocket.socket.close();

    cookie = athleteCookie;
    const athleteClubHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const athleteClubHistoryPayload = await athleteClubHistory.json();
    expect(athleteClubHistoryPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId, club: expect.objectContaining({ role: 'athlete' }) }),
    ]));
    expect(JSON.stringify(athleteClubHistoryPayload)).toContain('topWatts');
    const athleteIdentityBeforePersonal = await api('/api/auth/me').then((response) => response.json());

    const athletePersonalSessionId = `athlete-personal-ride-${now}`;
    const athletePersonalSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: athletePersonalSessionId,
          activityType: 'explore',
          title: 'Private home ride',
          startedAt: now - 700,
          endedAt: now - 100,
          durationMs: 600,
          distanceMeters: 1_000,
          details: { destinationLabel: 'Private destination' },
        },
      }),
    });
    expect(athletePersonalSave.status).toBe(201);
    const athleteIdentityAfterPersonal = await api('/api/auth/me').then((response) => response.json());
    expect(athleteIdentityAfterPersonal.user.id).toBe(athleteIdentityBeforePersonal.user.id);

    const athleteCombinedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const athleteCombinedPayload = await athleteCombinedHistory.json();
    expect(athleteCombinedPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId, club: expect.objectContaining({ role: 'athlete' }) }),
      expect.objectContaining({ id: athletePersonalSessionId }),
    ]));
    expect(athleteCombinedPayload.sessions.find((session: { id: string }) => session.id === athletePersonalSessionId)).not.toHaveProperty('club');

    const membership = await api('/api/auth/me');
    await expect(membership.json()).resolves.toMatchObject({
      user: { name: 'Maya Alexandria Torres (Rocket)', membership: { tier: 'spectator' } },
    });
    const athleteProfile = await api('/api/user-data');
    await expect(athleteProfile.json()).resolves.toMatchObject({
      accountProfile: { photoUrl: 'data:image/png;base64,aGVsbG8=' },
    });

    cookie = ownerCookie;
    const ownerUserData = await api('/api/user-data');
    expect(ownerUserData.status).toBe(200);
    await expect(ownerUserData.json()).resolves.toMatchObject({
      studioRiders: expect.arrayContaining([
        expect.objectContaining({ id: 'studio-maya', name: 'Maya Torres' }),
        expect.objectContaining({ id: 'studio-jordan', name: 'Jordan Lee' }),
      ]),
    });
    const connectedRoster = await api('/api/club-connect');
    const connectedRosterPayload = await connectedRoster.json();
    expect(connectedRosterPayload).toMatchObject({
      canManageClub: true,
      ownedClub: { id: claimedMembership.clubId },
    });
    expect(connectedRosterPayload.ownedClub.members).toEqual(expect.arrayContaining([
      expect.objectContaining({
          studioRiderId: 'studio-maya',
          athleteName: 'Maya Alexandria Torres (Rocket)',
          status: 'claimed',
      }),
      expect.objectContaining({ studioRiderId: 'studio-jordan', status: 'claimed' }),
    ]));

    const ownerCombinedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const ownerCombinedPayload = await ownerCombinedHistory.json();
    expect(ownerCombinedPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `club-owner:${claimedMembership.clubId}:studio-maya:${athleteClubSessionId}`,
        club: expect.objectContaining({ role: 'owner', riderName: 'Maya Torres' }),
      }),
    ]));
    expect(ownerCombinedPayload.sessions.some((session: { id: string }) => session.id.includes(athletePersonalSessionId))).toBe(false);
    const ownerViewOfAthleteSession = ownerCombinedPayload.sessions.find(
      (session: { id: string }) => session.id === `club-owner:${claimedMembership.clubId}:studio-maya:${athleteClubSessionId}`,
    );
    expect(JSON.stringify(ownerViewOfAthleteSession)).not.toMatch(/watts?|power/i);
    const ownerViewOfLegacyNameRace = ownerCombinedPayload.sessions.find(
      (session: { id: string }) => session.id === legacyNameRaceId,
    );
    expect(ownerViewOfLegacyNameRace).toBeDefined();
    expect(JSON.stringify(ownerViewOfLegacyNameRace)).not.toMatch(/watts?|power/i);
    const ownerViewOfPostClaimInjection = ownerCombinedPayload.sessions.find(
      (session: { id: string }) => session.id === postClaimNameInjectionId,
    );
    expect(ownerViewOfPostClaimInjection).toMatchObject({
      details: { summaries: [{ topWatts: 9_999 }] },
    });
    const ownerViewOfJordanAttributed = ownerCombinedPayload.sessions.find(
      (session: { id: string }) => session.id.includes(jordanAttributedSessionId),
    );
    expect(ownerViewOfJordanAttributed).toMatchObject({
      id: `club-owner:${claimedMembership.clubId}:studio-jordan:${jordanAttributedSessionId}`,
      club: { studioRiderId: 'studio-jordan', riderName: 'Jordan Lee', role: 'owner' },
      details: {
        summaries: [{
          playerId: 2,
          riderId: 'studio-jordan',
          riderName: 'Jordan Lee',
          finishTimeMs: 500,
        }],
        reactionTimesByPlayer: { 2: 190 },
        zoneResults: [{
          zoneId: 'shared-attributed-zone',
          zoneName: 'Shared attributed zone',
          zoneType: 'pedal',
          startMeter: 5,
          endMeter: 25,
          riders: [{ playerId: 2, sampleCount: 8 }],
        }],
        events: [],
        club: { role: 'owner' },
      },
    });
    const ownerJordanJson = JSON.stringify(ownerViewOfJordanAttributed);
    expect(ownerJordanJson).not.toMatch(/watts?|power/i);
    expect(ownerJordanJson).not.toMatch(/studio-maya|Maya Torres|sibling secret|maya-only-attributed-zone/iu);
    expect(ownerCombinedPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activityType: 'get-pulled',
        details: expect.objectContaining({
          recordKey: '6s-air-7',
          riders: [expect.objectContaining({ peakWatts: 1_240 })],
        }),
      }),
    ]));

    const reusedClaim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token }),
    });
    expect(reusedClaim.status).toBe(409);

    cookie = athleteCookie;
    expect((await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`)).status).toBe(200);
    const visibleBeforeMembershipRevoke = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'visible-before-membership-revoke',
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.4,
        metrics: { watts: 900 },
      }),
    });
    expect(visibleBeforeMembershipRevoke.status).toBe(200);
    expect((await api('/api/club-live/frames', {
      method: 'PUT',
      body: JSON.stringify({
        ...liveScreenFrame,
        sessionId: 'visible-before-membership-revoke',
        capturedAt: Date.now(),
      }),
    })).status).toBe(200);
    const heldMembershipRevokePublish = await beginHeldJsonRequest('/api/club-live/sessions', {
      authCookie: athleteCookie,
      body: {
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        sessionId: 'held-membership-revoke-session',
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.45,
        metrics: { watts: 950 },
      },
    });
    cookie = ownerCookie;
    const revoked = await api('/api/club-connect/revoke', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-maya' }),
    });
    expect(revoked.status).toBe(200);
    heldMembershipRevokePublish.release();
    expect([403, 409]).toContain((await heldMembershipRevokePublish.responsePromise).status);
    await expect((await api('/api/club-live/sessions')).json()).resolves.toMatchObject({ sessions: [] });
    await expect((await api('/api/club-live/frames')).json()).resolves.toMatchObject({ frames: [] });

    cookie = athleteCookie;
    const revokedLiveAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    expect(revokedLiveAccess.status).toBe(403);
    const revokedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const revokedHistoryPayload = await revokedHistory.json();
    expect(revokedHistoryPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId }),
      expect.objectContaining({ id: athletePersonalSessionId }),
    ]));
    expect(revokedHistoryPayload.sessions.some((session: { id: string }) => session.id.startsWith('club:'))).toBe(false);

    const revokedClubSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: claimedMembership.clubId,
          studioRiderId: claimedMembership.studioRiderId,
        },
        session: {
          id: `revoked-club-session-${now}`,
          activityType: 'bmx-race',
          title: 'Revoked club session',
          startedAt: now - 500,
          endedAt: now - 50,
          durationMs: 450,
          distanceMeters: 100,
          details: {},
        },
      }),
    });
    expect(revokedClubSave.status).toBe(403);
  });

  it('shares four purchased club bike seats across independently active studio riders', async () => {
    const originalCookie = cookie;
    const ownerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'club-owner-admin@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(ownerLogin.status).toBe(200);
    const ownerCookie = String(ownerLogin.headers.get('set-cookie')).split(';')[0];
    cookie = ownerCookie;
    const now = Date.now();
    const riders = Array.from({ length: 5 }, (_value, index) => ({
      id: `live-cap-rider-${index + 1}`,
      name: `Live Cap Rider ${index + 1}`,
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ studioRiders: riders }),
    });
    expect(rosterSave.status).toBe(200);

    const tokens = [];
    for (const rider of riders) {
      const inviteResponse = await api('/api/club-connect/invites', {
        method: 'POST',
        body: JSON.stringify({ studioRiderId: rider.id }),
      });
      expect(inviteResponse.status).toBe(201);
      tokens.push((await inviteResponse.json()).token);
    }

    const athleteCookies = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const athleteRegistration = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `198.51.100.${120 + index}` },
        body: JSON.stringify({
          name: `Live Cap Athlete ${index + 1}`,
          email: `live-cap-athlete-${index + 1}-${now}@tracklab.test`,
          password: 'correct-horse-battery-staple',
        }),
      });
      expect(athleteRegistration.status).toBe(201);
      cookie = String(athleteRegistration.headers.get('set-cookie')).split(';')[0];
      athleteCookies.push(cookie);
      const claimResponse = await api('/api/club-connect/claim', {
        method: 'POST',
        body: JSON.stringify({
          token: tokens[index],
          fullName: `Live Cap Athlete ${index + 1}`,
        }),
      });
      expect(claimResponse.status).toBe(200);
    }

    cookie = ownerCookie;
    const ownerClubState = await api('/api/club-connect');
    expect(ownerClubState.status).toBe(200);
    const clubId = (await ownerClubState.json()).ownedClub.id;

    for (let index = 0; index < riders.length; index += 1) {
      const rider = riders[index];
      cookie = athleteCookies[index];
      const accessResponse = await api(`/api/club-live/access?clubId=${clubId}`);
      expect(accessResponse.status).toBe(200);
      const accessPayload = await accessResponse.json();
      if (index === 4) {
        expect(accessPayload).toMatchObject({
          active: false,
          bikeSeats: 4,
          reason: 'club-bike-seats-full',
        });
        continue;
      }
      expect(accessPayload).toMatchObject({ active: true, bikeSeats: 4 });
      const publishResponse = await api('/api/club-live/sessions', {
        method: 'PUT',
        body: JSON.stringify({
          clubId,
          studioRiderId: rider.id,
          sessionId: `capacity-session-${index}`,
          activityType: rider.id.endsWith('1') ? 'explore' : 'bmx-race',
          status: 'active',
          progress: 0.25,
          metrics: { watts: 600, cadence: 95, speedKph: 24 },
        }),
      });
      expect(publishResponse.status).toBe(200);
    }

    cookie = athleteCookies[4];
    const fifthPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId,
        studioRiderId: riders[4].id,
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.2,
        metrics: { watts: 700, cadence: 110, speedKph: 30 },
      }),
    });
    expect(fifthPublish.status).toBe(409);
    await expect(fifthPublish.json()).resolves.toEqual({
      error: "Authorize this athlete's personal or club Wattbike seat before sharing the session.",
    });

    cookie = ownerCookie;
    const monitored = await api('/api/club-live/sessions');
    const monitoredPayload = await monitored.json();
    expect(monitoredPayload.sessions).toHaveLength(4);
    expect(monitoredPayload.sessions.map((session: { studioRiderId: string }) => session.studioRiderId))
      .toEqual(riders.slice(0, 4).map((rider) => rider.id));

    for (let index = 0; index < riders.length; index += 1) {
      cookie = athleteCookies[index];
      const rider = riders[index];
      const stopped = await api('/api/club-live/sessions', {
        method: 'DELETE',
        body: JSON.stringify({
          clubId,
          studioRiderId: rider.id,
          sessionId: `capacity-session-${index}`,
        }),
      });
      expect(stopped.status).toBe(200);
      expect((await api('/api/club-live/access?clubId=club-not-mine')).status).toBe(403);
    }
    cookie = originalCookie;
  });

  it('retains an owner-authored club tablet rider panel when no camera has been saved', async () => {
    const originalCookie = cookie;
    const now = Date.now();
    const registration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.219' },
      body: JSON.stringify({
        name: 'Overlay Only Club',
        email: 'overlay-only-admin@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(registration.status).toBe(201);
    cookie = String(registration.headers.get('set-cookie')).split(';')[0];

    const saved = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [{
          id: 'overlay-only-rider',
          name: 'Overlay Only Rider',
          createdAt: now,
          updatedAt: now,
        }],
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 0,
          earthCamerasByTrack: {},
          riderOverlaysByTrack: {
            'overlay-only-track': {
              xPct: 0.08,
              yPct: 0.68,
              width: 980,
              height: 205,
              locked: true,
              referenceViewport: { width: 1366, height: 1024 },
            },
          },
          riderOverlayUpdatedAtByTrack: { 'overlay-only-track': 810 },
        },
      }),
    });
    expect(saved.status).toBe(200);

    const enrollment = await api('/api/club-tablet/devices', {
      method: 'POST',
      body: JSON.stringify({ name: 'Overlay Test Tablet' }),
    });
    expect(enrollment.status).toBe(201);
    const enrolled = await enrollment.json();
    cookie = '';
    const roster = await api('/api/club-tablet/roster', {
      headers: { Authorization: `Bearer ${enrolled.deviceToken}` },
    });
    expect(roster.status).toBe(200);
    await expect(roster.json()).resolves.toMatchObject({
      racePresentation: {
        cameraLocked: true,
        earthCamerasByTrack: {},
        riderOverlaysByTrack: {
          'overlay-only-track': {
            xPct: 0.08,
            yPct: 0.68,
            width: 980,
            height: 205,
            locked: true,
            referenceViewport: { width: 1366, height: 1024 },
          },
        },
        riderOverlayUpdatedAtByTrack: { 'overlay-only-track': 810 },
      },
    });
    cookie = originalCookie;
  });

  it('authorizes shared club tablets without exposing the roster or binding athletes to bikes', async () => {
    const originalCookie = cookie;
    let ownerCookie = '';
    let ownerLoginSequence = 20;
    const signInOwner = async () => {
      ownerLoginSequence += 1;
      const ownerLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `198.51.100.${ownerLoginSequence}` },
        body: JSON.stringify({
          email: 'club-owner-admin@tracklab.test',
          password: 'correct-horse-battery-staple',
        }),
      });
      expect(ownerLogin.status).toBe(200);
      ownerCookie = String(ownerLogin.headers.get('set-cookie')).split(';')[0];
      cookie = ownerCookie;
      return ownerCookie;
    };
    await signInOwner();
    const now = Date.now();
    const globalViewSave = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: true,
          cameraLockedUpdatedAt: 750,
          earthCamerasByTrack: {
            'chula-vista-elite-bmx': {
              angle: 47,
              heading: 180,
              center: { lat: 32.6001, lng: -116.9987 },
              zoom: 20.78,
              referenceViewport: { width: 1366, height: 1024 },
              updatedAt: 750,
            },
          },
          riderOverlaysByTrack: {
            'chula-vista-elite-bmx': {
              xPct: 0.06,
              yPct: 0.7,
              width: 880,
              height: 196,
              locked: true,
              referenceViewport: { width: 1366, height: 1024 },
            },
          },
          riderOverlayUpdatedAtByTrack: { 'chula-vista-elite-bmx': 780 },
        },
      }),
    });
    expect(globalViewSave.status).toBe(200);
    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          {
            id: 'shared-tablet-rider-one',
            name: 'Tablet Rider One',
            photoUrl: 'data:image/png;base64,aGVsbG8=',
            createdAt: now,
            updatedAt: now,
          },
          { id: 'shared-tablet-rider-two', name: 'Tablet Rider Two', createdAt: now, updatedAt: now },
        ],
        raceViewPreferences: {
          cameraLocked: true,
          cameraLockedUpdatedAt: 750,
          earthCamerasByTrack: {
            'chula-vista-elite-bmx': {
              // Deliberately stale/conflicting. The developer-global camera
              // must win exactly as it does for a signed-in administrator.
              angle: 56,
              heading: 120,
              center: { lat: 32.6001, lng: -116.9987 },
              zoom: 20.78,
              referenceViewport: { width: 1366, height: 1024 },
              updatedAt: 750,
            },
          },
          riderOverlaysByTrack: {
            'chula-vista-elite-bmx': {
              // Deliberately stale/conflicting. The developer-global rider
              // panel must win exactly as its camera does.
              xPct: 0.02,
              yPct: 0.76,
              width: 1240,
              height: 210,
              locked: true,
              referenceViewport: { width: 1366, height: 1024 },
            },
          },
          riderOverlayUpdatedAtByTrack: { 'chula-vista-elite-bmx': 760 },
          demoRiderNames: { 1: 'Must stay private' },
          commentary: { recentLines: ['Must stay private'] },
        },
      }),
    });
    expect(rosterSave.status).toBe(200);
    // The central Club Live monitor is a separate browser session. Enrolling a
    // physical tablet must consume only that tablet browser's authorizing
    // session and leave this independently signed-in monitor available.
    const monitorCookie = ownerCookie;

    const enroll = async (name: string, assertKioskTakeover = false) => {
      const authorizingCookie = await signInOwner();
      const response = await api('/api/club-tablet/devices', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(201);
      const clearingCookie = response.headers.get('set-cookie') ?? '';
      expect(clearingCookie).toContain('tracklab_session=;');
      expect(clearingCookie).toContain('Max-Age=0');
      expect(clearingCookie).toContain('HttpOnly');
      const enrolled = await response.json();
      expect(enrolled.deviceToken).toHaveLength(43);
      if (assertKioskTakeover) {
        const retiredIdentity = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Origin: baseUrl, Cookie: authorizingCookie },
        });
        // /api/auth/me deliberately represents signed-out as 200 + null so the
        // app can bootstrap without treating a guest as a transport error.
        expect(retiredIdentity.status).toBe(200);
        await expect(retiredIdentity.json()).resolves.toEqual({ user: null });
        const retiredOwnerDevices = await fetch(`${baseUrl}/api/club-tablet/devices`, {
          headers: { Origin: baseUrl, Cookie: authorizingCookie },
        });
        expect(retiredOwnerDevices.status).toBe(401);
        const retiredFriends = await fetch(`${baseUrl}/api/friends`, {
          headers: { Origin: baseUrl, Cookie: authorizingCookie },
        });
        expect(retiredFriends.status).toBe(401);
        const retiredWatchConnect = await fetch(`${baseUrl}/api/heart-rate/watch-connect`, {
          headers: { Origin: baseUrl, Cookie: authorizingCookie },
        });
        expect(retiredWatchConnect.status).toBe(401);
        const independentMonitorIdentity = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Origin: baseUrl, Cookie: monitorCookie },
        });
        expect(independentMonitorIdentity.status).toBe(200);
        const enrolledRoster = await fetch(`${baseUrl}/api/club-tablet/roster`, {
          headers: {
            Origin: baseUrl,
            Authorization: `Bearer ${enrolled.deviceToken}`,
          },
        });
        expect(enrolledRoster.status).toBe(200);
        await expect(enrolledRoster.json()).resolves.toMatchObject({
          device: { id: enrolled.device.id },
          athletes: expect.arrayContaining([
            expect.objectContaining({ studioRiderId: 'shared-tablet-rider-one' }),
          ]),
        });
      }
      cookie = '';
      return enrolled;
    };
    const firstDevice = await enroll('Studio iPad 1', true);
    const secondDevice = await enroll('Studio iPad 2');
    expect(firstDevice.deviceToken).toHaveLength(43);
    cookie = monitorCookie;
    const listedDevices = await api('/api/club-tablet/devices');
    const listedPayload = await listedDevices.json();
    expect(listedPayload.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstDevice.device.id, name: 'Studio iPad 1' }),
      expect.objectContaining({ id: secondDevice.device.id, name: 'Studio iPad 2' }),
    ]));
    expect(JSON.stringify(listedPayload)).not.toContain(firstDevice.deviceToken);
    expect(JSON.stringify(listedPayload)).not.toContain('tokenHash');
    expect((await api('/api/club-live/sessions')).status).toBe(200);

    // More than four devices may be enrolled over the lifetime of a club. The
    // event console must surface the four that are actually in current use,
    // instead of pinning an arbitrary set of older enrollments forever.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const thirdDevice = await enroll('Studio iPad 3');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fourthDevice = await enroll('Studio iPad 4');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fifthDevice = await enroll('Studio iPad 5');

    const deviceHeaders = (deviceToken: string): HeadersInit => ({
      Authorization: `Bearer ${deviceToken}`,
    });
    const athleteHeaders = (sessionToken: string): HeadersInit => ({
      'X-TrackLab-Club-Tablet-Session': sessionToken,
    });

    expect((await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      body: JSON.stringify({ bikeDeviceId: 43_950, bikeLabel: 'WattbikePM25043950' }),
    })).status).toBe(401);
    cookie = '';
    const publishedBikePresence = await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({
        deviceId: secondDevice.device.id,
        clubId: 'forged-club',
        bikeDeviceId: 43_950,
        bikeLabel: 'WattbikePM25043950',
      }),
    });
    expect(publishedBikePresence.status).toBe(200);
    await expect(publishedBikePresence.json()).resolves.toMatchObject({
      connectedBike: {
        deviceId: 43_950,
        label: 'WattbikePM25043950',
        updatedAt: expect.any(Number),
        expiresAt: expect.any(Number),
      },
      pairedBike: {
        deviceId: 43_950,
        label: 'WattbikePM25043950',
        updatedAt: expect.any(Number),
      },
      heartbeatTtlMs: 12_000,
    });
    cookie = monitorCookie;
    const devicesWithPresence = await api('/api/club-tablet/devices');
    const firstDeviceWithPresence = (await devicesWithPresence.json()).devices.find(
      (device: { id: string }) => device.id === firstDevice.device.id,
    );
    expect(firstDeviceWithPresence).toMatchObject({
      id: firstDevice.device.id,
      connectedBike: {
        deviceId: 43_950,
        label: 'WattbikePM25043950',
      },
      pairedBike: {
        deviceId: 43_950,
        label: 'WattbikePM25043950',
      },
    });
    expect(firstDeviceWithPresence).not.toHaveProperty('deviceToken');
    expect(firstDeviceWithPresence.connectedBike).not.toHaveProperty('clubId');

    await new Promise((resolve) => setTimeout(resolve, 650));
    const devicesAfterConfiguredLiveTtl = await api('/api/club-tablet/devices');
    const presenceProtectedByHeartbeatFloor = (await devicesAfterConfiguredLiveTtl.json()).devices.find(
      (device: { id: string }) => device.id === firstDevice.device.id,
    );
    expect(presenceProtectedByHeartbeatFloor).toHaveProperty('connectedBike');

    cookie = '';
    expect((await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ bikeDeviceId: 43_950, bikeLabel: 'WattbikePM25043950' }),
    })).status).toBe(200);
    expect((await api('/api/club-tablet/bike-presence', {
      method: 'DELETE',
      headers: deviceHeaders(firstDevice.deviceToken),
    })).status).toBe(200);
    cookie = monitorCookie;
    const devicesAfterPresenceClear = await api('/api/club-tablet/devices');
    const clearedPresenceDevice = (await devicesAfterPresenceClear.json()).devices.find(
      (device: { id: string }) => device.id === firstDevice.device.id,
    );
    expect(clearedPresenceDevice).not.toHaveProperty('connectedBike');
    expect(clearedPresenceDevice).toMatchObject({
      pairedBike: {
        deviceId: 43_950,
        label: 'WattbikePM25043950',
      },
    });

    const roster = await api('/api/club-tablet/roster', {
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(roster.status).toBe(200);
    const rosterPayload = await roster.json();
    expect(rosterPayload.athletes).toEqual([
      expect.objectContaining({
        studioRiderId: 'shared-tablet-rider-one',
        riderName: 'Tablet Rider One',
        status: 'unclaimed',
        photoUrl: 'data:image/png;base64,aGVsbG8=',
      }),
      expect.objectContaining({
        studioRiderId: 'shared-tablet-rider-two',
        riderName: 'Tablet Rider Two',
        status: 'unclaimed',
      }),
    ]);
    expect(rosterPayload.racePresentation).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'chula-vista-elite-bmx': {
          angle: 47,
          heading: 180,
          zoom: 20.78,
          referenceViewport: { width: 1366, height: 1024 },
        },
      },
      riderOverlaysByTrack: {
        'chula-vista-elite-bmx': {
          xPct: 0.06,
          yPct: 0.7,
          width: 880,
          height: 196,
          locked: true,
          referenceViewport: { width: 1366, height: 1024 },
        },
      },
      riderOverlayUpdatedAtByTrack: { 'chula-vista-elite-bmx': 780 },
    });
    expect(rosterPayload.racePresentation).not.toHaveProperty('demoRiderNames');
    expect(rosterPayload.racePresentation).not.toHaveProperty('commentary');
    expect(JSON.stringify(rosterPayload)).not.toContain('@');
    expect(JSON.stringify(rosterPayload)).not.toContain('ProfileKey');

    const startTabletSession = (deviceToken: string, studioRiderId: string, bikeDeviceId: string) => (
      api('/api/club-tablet/sessions', {
        method: 'POST',
        headers: deviceHeaders(deviceToken),
        body: JSON.stringify({ studioRiderId, bikeDeviceId }),
      })
    );
    const selected = await startTabletSession(
      firstDevice.deviceToken,
      'shared-tablet-rider-one',
      'WattbikePM25043950',
    );
    expect(selected.status).toBe(201);
    const selectedPayload = await selected.json();
    expect(selectedPayload).toMatchObject({
      session: {
        clubId: firstDevice.device.clubId,
        studioRiderId: 'shared-tablet-rider-one',
        riderName: 'Tablet Rider One',
        bikeDeviceId: 'WattbikePM25043950',
      },
      sessionToken: expect.any(String),
    });
    expect(JSON.stringify(selectedPayload)).not.toContain('ownerProfileKey');

    const duplicateAthlete = await startTabletSession(
      secondDevice.deviceToken,
      'shared-tablet-rider-one',
      'WattbikePM25043951',
    );
    expect(duplicateAthlete.status).toBe(409);
    const duplicateBike = await startTabletSession(
      secondDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043950',
    );
    expect(duplicateBike.status).toBe(409);

    const secondSelected = await startTabletSession(
      secondDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043951',
    );
    expect(secondSelected.status).toBe(201);
    let secondSelectedPayload = await secondSelected.json();

    const firstAthleteExploreRoute = exploreRoute('EXPLORE-TABLET-ATHLETE-ONE');
    const savedFirstAthleteRoute = await api('/api/explore/recent-routes', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ routes: [firstAthleteExploreRoute] }),
    });
    expect(savedFirstAthleteRoute.status).toBe(200);
    await expect(savedFirstAthleteRoute.json()).resolves.toMatchObject({
      routes: [{ id: firstAthleteExploreRoute.id }],
    });
    const firstAthleteRoutes = await api('/api/explore/recent-routes', {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    await expect(firstAthleteRoutes.json()).resolves.toMatchObject({
      routes: [{ id: firstAthleteExploreRoute.id }],
    });
    const siblingAthleteRoutes = await api('/api/explore/recent-routes', {
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
    });
    await expect(siblingAthleteRoutes.json()).resolves.toEqual({ routes: [] });

    const demoRoutes = await api('/api/explore/recent-routes', {
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(demoRoutes.status).toBe(200);
    await expect(demoRoutes.json()).resolves.toEqual({ routes: [] });
    const demoRouteSave = await api('/api/explore/recent-routes', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ routes: [exploreRoute('EXPLORE-DEMO-MUST-NOT-SAVE')] }),
    });
    expect(demoRouteSave.status).toBe(403);

    const expiredAthleteWithOwnerCookie = await api('/api/explore/recent-routes', {
      headers: athleteHeaders('expired-athlete-session-token-that-must-not-fallback'),
    });
    expect(expiredAthleteWithOwnerCookie.status).toBe(401);
    const revokedDeviceWithOwnerCookie = await api('/api/explore/recent-routes', {
      headers: deviceHeaders('revoked-device-token-that-must-not-fallback-to-owner'),
    });
    expect(revokedDeviceWithOwnerCookie.status).toBe(401);

    cookie = '';
    const demoRouteCompute = await api('/api/explore/route', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({
        origin: { lat: 38.5, lng: -120.2 },
        destination: { lat: 38.6, lng: -120.1 },
        travelMode: 'bicycle',
      }),
    });
    expect(demoRouteCompute.status).toBe(503);
    const athleteRouteCompute = await api('/api/explore/route', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({
        origin: { lat: 38.5, lng: -120.2 },
        destination: { lat: 38.6, lng: -120.1 },
        travelMode: 'bicycle',
      }),
    });
    expect(athleteRouteCompute.status).toBe(503);
    const athleteSmartRoute = await api('/api/explore/smart-route', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ description: 'A detailed coastal ride near San Francisco' }),
    });
    expect(athleteSmartRoute.status).toBe(503);
    const demoSmartRoute = await api('/api/explore/smart-route', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ description: 'A detailed coastal ride near San Francisco' }),
    });
    expect(demoSmartRoute.status).toBe(503);
    const demoElevation = await api('/api/explore/elevation', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({
        encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceMeters: 1_000,
      }),
    });
    expect(demoElevation.status).toBe(503);

    cookie = monitorCookie;
    const privateDragStrip = {
      ...customSprintTrack('private-drag-strip'),
      name: 'Private Drag Strip',
      centerline: Array.from({ length: 80 }, (_, index) => ({
        lat: 38 + (index * 0.00001),
        lng: -122,
      })),
    };
    const nonDragstripTrack = { ...privateDragStrip, name: 'Private Sprint' };
    const invalidRaceView = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'straight-sprint',
        configuration: {
          trackId: nonDragstripTrack.id,
          trackName: nonDragstripTrack.name,
          distanceFeet: 300,
          airSetting: 1,
          trackRecord: nonDragstripTrack,
          raceView: { mode: '3d', camera: { angle: 68, heading: 90 } },
        },
      }),
    });
    expect(invalidRaceView.status).toBe(400);

    const invalidGameArena = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'straight-sprint',
        configuration: {
          trackId: nonDragstripTrack.id,
          trackName: nonDragstripTrack.name,
          distanceFeet: 300,
          airSetting: 1,
          trackRecord: nonDragstripTrack,
          raceView: { mode: 'game' },
        },
      }),
    });
    expect(invalidGameArena.status).toBe(400);

    const gameArenaCreated = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'straight-sprint',
        configuration: {
          trackId: privateDragStrip.id,
          trackName: privateDragStrip.name,
          distanceFeet: 300,
          airSetting: 1,
          trackRecord: privateDragStrip,
        },
      }),
    });
    expect(gameArenaCreated.status).toBe(201);
    await expect(gameArenaCreated.json()).resolves.toMatchObject({
      event: { configuration: { raceView: { mode: 'game' } } },
    });

    const eventCreated = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'straight-sprint',
        configuration: {
          trackId: privateDragStrip.id,
          trackName: privateDragStrip.name,
          distanceFeet: 300,
          airSetting: 1,
          trackRecord: privateDragStrip,
          raceView: { mode: '3d', accountKey: 'must not survive' },
          constructor: 'must not survive',
        },
      }),
    });
    expect(eventCreated.status).toBe(201);
    const eventCreatedPayload = await eventCreated.json();
    expect(eventCreatedPayload).toMatchObject({
      pollAfterMs: 2_000,
      event: {
        activityType: 'straight-sprint',
        configuration: {
          distanceFeet: 300,
          airSetting: 1,
          raceView: { mode: 'game' },
        },
        status: 'lobby',
        startAt: null,
        slots: expect.arrayContaining([
          expect.objectContaining({ deviceId: firstDevice.device.id, status: 'available', athlete: null }),
          expect.objectContaining({ deviceId: secondDevice.device.id, status: 'available', athlete: null }),
        ]),
      },
    });
    expect(eventCreatedPayload.event.configuration.trackRecord.centerline).toHaveLength(80);
    expect(eventCreatedPayload.event.configuration.raceView).not.toHaveProperty('accountKey');
    expect(eventCreatedPayload.event.configuration.raceView).not.toHaveProperty('camera');
    expect(eventCreatedPayload.event.configuration.raceView).not.toHaveProperty('riderOverlay');
    const eventId = eventCreatedPayload.event.id;
    expect(JSON.stringify(eventCreatedPayload)).not.toMatch(/token|ProfileKey|constructor/i);
    const createdSlotDeviceIds = new Set(eventCreatedPayload.event.slots.map(
      (slot: { deviceId: string }) => slot.deviceId,
    ));
    expect(createdSlotDeviceIds).toEqual(new Set([
      firstDevice.device.id,
      secondDevice.device.id,
      fourthDevice.device.id,
      fifthDevice.device.id,
    ]));
    expect(createdSlotDeviceIds.has(thirdDevice.device.id)).toBe(false);

    cookie = '';
    const deviceEventRead = await api('/api/club-events/current', {
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(deviceEventRead.status).toBe(200);
    await expect(deviceEventRead.json()).resolves.toMatchObject({ event: { id: eventId } });

    const joinedResponses = await Promise.all([
      api('/api/club-events/current/join', {
        method: 'POST',
        headers: athleteHeaders(selectedPayload.sessionToken),
        body: JSON.stringify({ eventId, studioRiderId: 'forged-rider', bikeDeviceId: 'forged-bike' }),
      }),
      api('/api/club-events/current/join', {
        method: 'POST',
        headers: athleteHeaders(secondSelectedPayload.sessionToken),
        body: JSON.stringify({ eventId }),
      }),
    ]);
    expect(joinedResponses.map((response) => response.status)).toEqual([200, 200]);
    // Either concurrent request may acquire the per-club event lock first, so
    // an individual 200 response can legitimately contain only that first
    // participant. Verify the authoritative snapshot after both commits.
    const joinedSnapshot = await api('/api/club-events/current', {
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
    });
    expect(joinedSnapshot.status).toBe(200);
    const joinedPayload = await joinedSnapshot.json();
    expect(joinedPayload.event.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deviceId: firstDevice.device.id,
        status: 'ready',
        ready: true,
        athlete: expect.objectContaining({ studioRiderId: 'shared-tablet-rider-one' }),
        bikeDeviceId: 'WattbikePM25043950',
      }),
      expect.objectContaining({
        deviceId: secondDevice.device.id,
        status: 'ready',
        ready: true,
        athlete: expect.objectContaining({ studioRiderId: 'shared-tablet-rider-two' }),
        bikeDeviceId: 'WattbikePM25043951',
      }),
    ]));
    expect(JSON.stringify(joinedPayload)).not.toMatch(/sessionToken|tokenHash|ownerProfileKey|athleteProfileKey/i);

    const releasedFromEvent = await api('/api/club-events/current/join', {
      method: 'DELETE',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
      body: JSON.stringify({ eventId }),
    });
    expect(releasedFromEvent.status).toBe(200);
    expect((await releasedFromEvent.json()).event.slots.find(
      (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
    )).toMatchObject({ athlete: null, status: 'available' });
    expect((await api('/api/club-events/current/join', {
      method: 'POST',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
      body: JSON.stringify({ eventId }),
    })).status).toBe(200);

    // Ending an athlete session is an idempotent fallback for a failed event
    // leave request. It must clear the durable event seat immediately so the
    // next athlete/tablet is not blocked by a ghost participant.
    const stoppedWithoutEventLeave = await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
    });
    expect(stoppedWithoutEventLeave.status).toBe(200);
    cookie = monitorCookie;
    const afterSessionStop = await api('/api/club-events/current');
    expect((await afterSessionStop.json()).event.slots.find(
      (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
    )).toMatchObject({ athlete: null, status: 'available' });
    cookie = '';
    const secondReselected = await startTabletSession(
      secondDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043951',
    );
    expect(secondReselected.status).toBe(201);
    secondSelectedPayload = await secondReselected.json();
    expect((await api('/api/club-events/current/join', {
      method: 'POST',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
      body: JSON.stringify({ eventId }),
    })).status).toBe(200);

    cookie = monitorCookie;
    const eventStarted = await api('/api/club-events/current/start', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    });
    expect(eventStarted.status).toBe(200);
    const eventStartedPayload = await eventStarted.json();
    expect(eventStartedPayload.event).toMatchObject({ id: eventId, status: 'active' });
    expect(eventStartedPayload.event.startAt).toBeGreaterThan(Date.now());
    expect(eventStartedPayload.event.startAt).toBeLessThanOrEqual(Date.now() + 8_500);
    expect(eventStartedPayload.event.slots.filter(
      (slot: { athlete: unknown }) => slot.athlete,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceId: firstDevice.device.id, status: 'ready' }),
      expect.objectContaining({ deviceId: secondDevice.device.id, status: 'ready' }),
    ]));
    const replayedStart = await api('/api/club-events/current/start', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    });
    expect(replayedStart.status).toBe(200);
    await expect(replayedStart.json()).resolves.toMatchObject({
      event: { id: eventId, status: 'active', startAt: eventStartedPayload.event.startAt },
    });
    cookie = '';
    expect((await api('/api/club-events/current/join', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ eventId }),
    })).status).toBe(409);

    let eventSocketOne = await openClubTabletSocket(selectedPayload.sessionToken);
    let eventSocketTwo = await openClubTabletSocket(secondSelectedPayload.sessionToken);
    eventSocketOne.socket.send(JSON.stringify({ type: 'join-club-event', eventId }));
    const firstEventRoom = await waitForSocketMessage(
      eventSocketOne,
      (message) => message.type === 'room-state' && message.room?.purpose === 'club-event',
    );
    expect(firstEventRoom.room.hostId).toBeNull();
    cookie = monitorCookie;
    const oneTabletLaunched = await api('/api/club-events/current');
    const oneTabletLaunchedSlots = (await oneTabletLaunched.json()).event.slots;
    expect(oneTabletLaunchedSlots.find(
      (slot: { deviceId: string }) => slot.deviceId === firstDevice.device.id,
    )).toMatchObject({ status: 'active', online: true });
    expect(oneTabletLaunchedSlots.find(
      (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
    )).toMatchObject({ status: 'ready', online: false });
    cookie = '';

    const blockedResetIndex = eventSocketOne.messages.length;
    eventSocketOne.socket.send(JSON.stringify({ type: 'room-reset-lobby' }));
    await waitForSocketMessage(
      eventSocketOne,
      (message) => message.type === 'room-error' && /coach controls/i.test(String(message.message)),
      blockedResetIndex,
    );
    eventSocketTwo.socket.send(JSON.stringify({ type: 'join-club-event', eventId }));
    const secondEventRoom = await waitForSocketMessage(
      eventSocketTwo,
      (message) => message.type === 'room-state' && message.room?.id === firstEventRoom.room.id,
    );
    expect(secondEventRoom.room).toMatchObject({
      private: true,
      purpose: 'club-event',
      racerCount: 2,
      flow: {
        phase: 'race',
        raceToken: eventId,
        raceStartAt: eventStartedPayload.event.startAt,
      },
    });
    cookie = monitorCookie;
    const bothTabletsLaunched = await api('/api/club-events/current');
    const bothTabletsLaunchedSlots = (await bothTabletsLaunched.json()).event.slots;
    expect(bothTabletsLaunchedSlots.filter(
      (slot: { status: string }) => slot.status === 'active',
    )).toHaveLength(2);
    expect(bothTabletsLaunchedSlots.filter(
      (slot: { online: boolean }) => slot.online,
    )).toHaveLength(2);
    cookie = '';

    // Durable launched_at permits a deadline reconnect, but the coach's live
    // status is transport presence: it drops as soon as the socket leaves.
    eventSocketTwo.socket.terminate();
    testSockets.delete(eventSocketTwo.socket);
    let disconnectedSecondSlot: Record<string, any> | undefined;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      cookie = monitorCookie;
      const disconnectedSnapshot = await api('/api/club-events/current');
      disconnectedSecondSlot = (await disconnectedSnapshot.json()).event.slots.find(
        (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
      );
      cookie = '';
      if (disconnectedSecondSlot?.online === false) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(disconnectedSecondSlot).toMatchObject({ status: 'ready', online: false });

    await new Promise((resolve) => setTimeout(
      resolve,
      Math.max(1, eventStartedPayload.event.startAt - Date.now() + 50),
    ));
    eventSocketTwo = await openClubTabletSocket(secondSelectedPayload.sessionToken);
    eventSocketTwo.socket.send(JSON.stringify({ type: 'join-club-event', eventId }));
    await waitForSocketMessage(
      eventSocketTwo,
      (message) => message.type === 'room-state' && message.room?.id === firstEventRoom.room.id,
    );
    cookie = monitorCookie;
    const secondTabletReconnected = await api('/api/club-events/current');
    expect((await secondTabletReconnected.json()).event.slots.find(
      (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
    )).toMatchObject({ status: 'active', online: true });
    cookie = '';
    const replacedEventSocketOne = eventSocketOne;
    const reconnectedEventSocketOne = await openClubTabletSocket(selectedPayload.sessionToken);
    reconnectedEventSocketOne.socket.send(JSON.stringify({ type: 'join-club-event', eventId }));
    const reconnectedEventRoom = await waitForSocketMessage(
      reconnectedEventSocketOne,
      (message) => message.type === 'room-state' && message.room?.id === firstEventRoom.room.id,
    );
    expect(reconnectedEventRoom.room).toMatchObject({
      purpose: 'club-event',
      racerCount: 2,
    });
    testSockets.delete(replacedEventSocketOne.socket);
    eventSocketOne = reconnectedEventSocketOne;

    const ordinaryJoinIndex = eventSocketOne.messages.length;
    eventSocketOne.socket.send(JSON.stringify({ type: 'join-room', roomId: firstEventRoom.room.id }));
    await waitForSocketMessage(
      eventSocketOne,
      (message) => message.type === 'room-error' && /authorized event join/i.test(String(message.message)),
      ordinaryJoinIndex,
    );

    const releasedSocketIndex = eventSocketTwo.messages.length;
    const remainingRoomIndex = eventSocketOne.messages.length;
    const liveSeatRelease = await api('/api/club-events/current/join', {
      method: 'DELETE',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
      body: JSON.stringify({ eventId }),
    });
    expect(liveSeatRelease.status).toBe(200);
    await waitForSocketMessage(
      eventSocketTwo,
      (message) => message.type === 'room-left' && message.reason === 'club-event-seat-released',
      releasedSocketIndex,
    );
    await waitForSocketMessage(
      eventSocketOne,
      (message) => message.type === 'room-state' && message.room?.racerCount === 1,
      remainingRoomIndex,
    );
    eventSocketOne.socket.terminate();
    eventSocketTwo.socket.terminate();
    testSockets.delete(eventSocketOne.socket);
    testSockets.delete(eventSocketTwo.socket);

    cookie = monitorCookie;
    const eventCancelled = await api('/api/club-events/current/cancel', {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    });
    expect(eventCancelled.status).toBe(200);
    await expect(eventCancelled.json()).resolves.toEqual({ event: null, pollAfterMs: 2_000 });
    cookie = '';

    const cancelledEventSocket = await openClubTabletSocket(selectedPayload.sessionToken);
    const cancelledJoinIndex = cancelledEventSocket.messages.length;
    cancelledEventSocket.socket.send(JSON.stringify({ type: 'join-club-event', eventId }));
    await waitForSocketMessage(
      cancelledEventSocket,
      (message) => message.type === 'room-error' && /not authorized|ended/i.test(String(message.message)),
      cancelledJoinIndex,
    );
    cancelledEventSocket.socket.terminate();
    testSockets.delete(cancelledEventSocket.socket);

    // Explore Club Events freeze the owner's route before the lobby opens.
    // Tablets receive that exact snapshot and server start clock; none of the
    // four tablet sockets becomes a host or can mutate/control the ride.
    cookie = monitorCookie;
    expect((await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'explore',
        configuration: { origin: 'Preski Ranch', destination: 'Golden Gate Bridge' },
      }),
    })).status).toBe(400);
    const ownerExploreRoute = {
      id: 'club-owner-explore-route',
      name: 'Preski to Golden Gate',
      origin: { lat: 38.1, lng: -122.2 },
      destination: { lat: 37.8199, lng: -122.4783 },
      originLabel: 'Preski Ranch',
      destinationLabel: 'Golden Gate Bridge',
      travelMode: 'bicycle',
      distanceMeters: 12_345,
      durationSeconds: 2_400,
      encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      createdAt: Date.now(),
      privateToken: 'must-not-survive',
    };
    expect((await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'explore',
        configuration: {
          routeId: ownerExploreRoute.id,
          route: { ...ownerExploreRoute, travelMode: 'hovercraft' },
        },
      }),
    })).status).toBe(400);
    const exploreCreated = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'explore',
        configuration: {
          origin: 'client display must not win',
          destination: 'client display must not win',
          routeName: ownerExploreRoute.name,
          routeId: ownerExploreRoute.id,
          route: ownerExploreRoute,
        },
      }),
    });
    expect(exploreCreated.status).toBe(201);
    const exploreCreatedPayload = await exploreCreated.json();
    expect(exploreCreatedPayload.event.configuration).toMatchObject({
      origin: ownerExploreRoute.originLabel,
      destination: ownerExploreRoute.destinationLabel,
      routeName: ownerExploreRoute.name,
      routeId: ownerExploreRoute.id,
      route: {
        id: ownerExploreRoute.id,
        travelMode: 'bicycle',
        encodedPolyline: ownerExploreRoute.encodedPolyline,
      },
    });
    expect(exploreCreatedPayload.event.configuration.route).not.toHaveProperty('privateToken');
    const exploreEventId = exploreCreatedPayload.event.id;
    cookie = '';
    expect((await api('/api/club-events/current/join', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ eventId: exploreEventId }),
    })).status).toBe(200);
    cookie = monitorCookie;
    const exploreStarted = await api('/api/club-events/current/start', {
      method: 'POST',
      body: JSON.stringify({ eventId: exploreEventId }),
    });
    expect(exploreStarted.status).toBe(200);
    const exploreStartedPayload = await exploreStarted.json();
    cookie = '';
    const exploreSocket = await openClubTabletSocket(selectedPayload.sessionToken);
    exploreSocket.socket.send(JSON.stringify({ type: 'join-club-event', eventId: exploreEventId }));
    const exploreRoom = await waitForSocketMessage(
      exploreSocket,
      (message) => message.type === 'room-state' && message.room?.clubEventId === exploreEventId,
    );
    expect(exploreRoom.room).toMatchObject({
      hostId: null,
      exploreRoute: {
        id: ownerExploreRoute.id,
        encodedPolyline: ownerExploreRoute.encodedPolyline,
      },
      exploreSession: {
        id: exploreEventId,
        routeId: ownerExploreRoute.id,
        status: 'riding',
        startedAt: exploreStartedPayload.event.startAt,
      },
    });
    const preStartExploreSyncIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({
      type: 'explore-sync',
      state: {
        sessionId: exploreEventId,
        routeId: ownerExploreRoute.id,
        riders: [{ id: 'pre-start', distanceMeters: 1, velocityMps: 1 }],
      },
    }));
    const wrongActivitySyncIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({
      type: 'race-sync',
      state: {
        sessionId: exploreEventId,
        trackId: exploreRoom.room.track.id,
        raceState: 'racing',
        riders: [],
        summary: [],
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exploreSocket.messages.slice(preStartExploreSyncIndex).some(
      (message) => message.type === 'explore-sync',
    )).toBe(false);
    expect(exploreSocket.messages.slice(wrongActivitySyncIndex).some(
      (message) => message.type === 'race-sync',
    )).toBe(false);

    await new Promise((resolve) => setTimeout(
      resolve,
      Math.max(1, exploreStartedPayload.event.startAt - Date.now() + 30),
    ));
    const validExploreSyncIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({
      type: 'explore-sync',
      state: {
        sessionId: exploreEventId,
        routeId: ownerExploreRoute.id,
        riders: [{ id: 'server-bound-rider', distanceMeters: 25, velocityMps: 4 }],
      },
    }));
    const acceptedExploreSync = await waitForSocketMessage(
      exploreSocket,
      (message) => message.type === 'explore-sync',
      validExploreSyncIndex,
    );
    expect(acceptedExploreSync.state).toMatchObject({
      sessionId: exploreEventId,
      eventId: exploreEventId,
      activityType: 'explore',
      routeId: ownerExploreRoute.id,
      startedAt: exploreStartedPayload.event.startAt,
    });
    const wrongSessionSyncIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({
      type: 'explore-sync',
      state: {
        sessionId: 'forged-explore-session',
        routeId: ownerExploreRoute.id,
        riders: [{ id: 'wrong-session', distanceMeters: 30, velocityMps: 4 }],
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exploreSocket.messages.slice(wrongSessionSyncIndex).some(
      (message) => message.type === 'explore-sync',
    )).toBe(false);
    const blockedExploreControlIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({ type: 'room-explore-action', action: 'pause' }));
    await waitForSocketMessage(
      exploreSocket,
      (message) => message.type === 'room-error' && /coach controls/i.test(String(message.message)),
      blockedExploreControlIndex,
    );
    const blockedExploreRouteIndex = exploreSocket.messages.length;
    exploreSocket.socket.send(JSON.stringify({
      type: 'room-explore-route',
      route: { ...ownerExploreRoute, id: 'forged-tablet-route' },
    }));
    await waitForSocketMessage(
      exploreSocket,
      (message) => message.type === 'room-error' && /coach controls/i.test(String(message.message)),
      blockedExploreRouteIndex,
    );
    exploreSocket.socket.terminate();
    testSockets.delete(exploreSocket.socket);
    cookie = monitorCookie;
    expect((await api('/api/club-events/current/cancel', {
      method: 'POST',
      body: JSON.stringify({ eventId: exploreEventId }),
    })).status).toBe(200);
    cookie = '';

    const failedAtomicSwitch = await startTabletSession(
      firstDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043952',
    );
    expect(failedAtomicSwitch.status).toBe(409);
    const stillSelected = await api('/api/club-tablet/sessions/current', {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(stillSelected.status).toBe(200);
    const stillSelectedPayload = await stillSelected.json();
    expect(stillSelectedPayload).toMatchObject({
      session: {
        studioRiderId: 'shared-tablet-rider-one',
        bikeDeviceId: 'WattbikePM25043950',
      },
    });

    const wrongOrigin = await api('/api/club-tablet/live', {
      method: 'PUT',
      headers: {
        Origin: 'https://malicious.example',
        ...athleteHeaders(selectedPayload.sessionToken),
      },
      body: JSON.stringify({
        activityType: 'straight-sprint',
        status: 'active',
      }),
    });
    expect(wrongOrigin.status).toBe(403);

    cookie = monitorCookie;
    const revokeRaceTrack = customSprintTrack('revoke-race');
    const revokeRaceEvent = await api('/api/club-events', {
      method: 'POST',
      body: JSON.stringify({
        activityType: 'bmx-race',
        configuration: {
          trackId: revokeRaceTrack.id,
          trackName: revokeRaceTrack.name,
          trackRecord: revokeRaceTrack,
          lapCount: 1,
        },
      }),
    });
    expect(revokeRaceEvent.status).toBe(201);
    const revokeRaceEventId = (await revokeRaceEvent.json()).event.id;
    cookie = '';
    expect((await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: deviceHeaders(secondDevice.deviceToken),
      body: JSON.stringify({ bikeDeviceId: 43_951, bikeLabel: 'WattbikePM25043951' }),
    })).status).toBe(200);
    const heldTabletRevokePublish = await beginHeldJsonRequest('/api/club-tablet/live', {
      authCookie: '',
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
      body: {
        sessionId: 'held-tablet-device-revoke-session',
        activityType: 'bmx-race',
        status: 'active',
        progress: 0.15,
        metrics: { watts: 650, cadence: 100, speedKph: 25 },
      },
    });
    cookie = monitorCookie;
    const [concurrentRejoin, revokeSecond] = await Promise.all([
      api('/api/club-events/current/join', {
        method: 'POST',
        headers: athleteHeaders(secondSelectedPayload.sessionToken),
        body: JSON.stringify({ eventId: revokeRaceEventId }),
      }),
      api('/api/club-tablet/devices', {
        method: 'DELETE',
        body: JSON.stringify({ deviceId: secondDevice.device.id }),
      }),
    ]);
    expect([200, 401]).toContain(concurrentRejoin.status);
    expect(revokeSecond.status).toBe(200);
    heldTabletRevokePublish.release();
    expect([401, 409]).toContain((await heldTabletRevokePublish.responsePromise).status);
    cookie = '';
    expect((await api('/api/club-tablet/bike-presence', {
      method: 'PUT',
      headers: deviceHeaders(secondDevice.deviceToken),
      body: JSON.stringify({ bikeDeviceId: 43_951, bikeLabel: 'WattbikePM25043951' }),
    })).status).toBe(401);
    cookie = monitorCookie;
    const afterConcurrentRevoke = await api('/api/club-events/current');
    expect((await afterConcurrentRevoke.json()).event.slots.some(
      (slot: { deviceId: string }) => slot.deviceId === secondDevice.device.id,
    )).toBe(false);
    expect((await api('/api/club-tablet/sessions/current', {
      headers: athleteHeaders(secondSelectedPayload.sessionToken),
    })).status).toBe(401);
    expect((await api('/api/club-tablet/roster', {
      headers: deviceHeaders(secondDevice.deviceToken),
    })).status).toBe(401);
    expect((await api('/api/club-live/sessions')).status).toBe(200);
    const replacementDevice = await enroll('Studio iPad replacement');
    const replacementSession = await startTabletSession(
      replacementDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043951',
    );
    expect(replacementSession.status).toBe(201);
    const replacementPayload = await replacementSession.json();
    await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(replacementPayload.sessionToken),
    });

    const livePublish = await api('/api/club-tablet/live', {
      method: 'PUT',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({
        clubId: 'forged-club',
        studioRiderId: 'forged-rider',
        riderName: 'Forged Name',
        activityType: 'straight-sprint',
        status: 'active',
        progress: { percent: 50, distanceMeters: 22 },
        metrics: { watts: 800, cadence: 120, speedKph: 36 },
      }),
    });
    expect(livePublish.status).toBe(200);
    const livePublishPayload = await livePublish.json();
    expect(livePublishPayload).toMatchObject({
      session: {
        clubId: firstDevice.device.clubId,
        studioRiderId: 'shared-tablet-rider-one',
        riderName: 'Tablet Rider One',
      },
    });
    expect(livePublishPayload.athleteSessionExpiresAt).toBe(stillSelectedPayload.session.expiresAt);

    const tabletFrame = {
      clubId: 'forged-club',
      studioRiderId: 'forged-rider',
      sessionId: livePublishPayload.session.sessionId,
      jpegDataUrl: onePixelJpegDataUrl,
      width: 1,
      height: 1,
      capturedAt: Date.now(),
    };
    const tabletFrameBurst = await Promise.all(Array.from({ length: 7 }, (_, index) => (
      api('/api/club-live/frames', {
        method: 'PUT',
        headers: {
          ...athleteHeaders(selectedPayload.sessionToken),
          'X-Forwarded-For': `198.51.100.${index + 1}`,
        },
        body: JSON.stringify(tabletFrame),
      })
    )));
    expect(tabletFrameBurst.filter((result) => result.status === 200)).toHaveLength(6);
    expect(tabletFrameBurst.filter((result) => result.status === 429)).toHaveLength(1);
    const acceptedTabletFrame = await tabletFrameBurst.find((result) => result.status === 200)!.json();
    expect(acceptedTabletFrame).toMatchObject({
      frame: {
        clubId: firstDevice.device.clubId,
        studioRiderId: 'shared-tablet-rider-one',
        riderName: 'Tablet Rider One',
        deviceId: firstDevice.device.id,
        contentType: 'image/jpeg',
        byteLength: expect.any(Number),
      },
    });

    cookie = monitorCookie;
    const monitoredTabletFrames = await api('/api/club-live/frames');
    await expect(monitoredTabletFrames.json()).resolves.toMatchObject({
      frames: [expect.objectContaining({
        studioRiderId: 'shared-tablet-rider-one',
        deviceId: firstDevice.device.id,
      })],
    });
    const tabletCredentialWithOwnerCookie = await api('/api/club-live/frames', {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(tabletCredentialWithOwnerCookie.status).toBe(403);
    const invalidTabletCredentialWithOwnerCookie = await api('/api/club-live/frames', {
      headers: athleteHeaders('invalid-tablet-session-that-must-not-fall-back'),
    });
    expect(invalidTabletCredentialWithOwnerCookie.status).toBe(401);
    const deviceCredentialWithOwnerCookie = await api('/api/club-live/frames', {
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(deviceCredentialWithOwnerCookie.status).toBe(403);
    const devicePublishWithOwnerCookie = await api('/api/club-live/frames', {
      method: 'PUT',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify(tabletFrame),
    });
    expect(devicePublishWithOwnerCookie.status).toBe(403);
    const deviceDeleteWithOwnerCookie = await api('/api/club-live/frames', {
      method: 'DELETE',
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(deviceDeleteWithOwnerCookie.status).toBe(403);
    const invalidDeviceCredentialWithOwnerCookie = await api('/api/club-live/frames', {
      headers: deviceHeaders('invalid-device-token-that-must-not-fall-back'),
    });
    expect(invalidDeviceCredentialWithOwnerCookie.status).toBe(401);
    cookie = '';

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const resumedTabletLive = await api('/api/club-tablet/live', {
      method: 'PUT',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({
        sessionId: 'tablet-frame-delete-session',
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.5,
        metrics: { watts: 800, cadence: 120, speedKph: 36 },
      }),
    });
    expect(resumedTabletLive.status).toBe(200);
    const resumedTabletLivePayload = await resumedTabletLive.json();
    const resumedTabletFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({
        ...tabletFrame,
        sessionId: resumedTabletLivePayload.session.sessionId,
        capturedAt: Date.now(),
      }),
    });
    expect(resumedTabletFrame.status).toBe(200);
    const headerOnlyJpegFrame = await api('/api/club-live/frames', {
      method: 'PUT',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({
        ...tabletFrame,
        sessionId: resumedTabletLivePayload.session.sessionId,
        jpegDataUrl: 'data:image/jpeg;base64,/9j/wAAICAABAAEA/9k=',
        capturedAt: Date.now(),
      }),
    });
    expect(headerOnlyJpegFrame.status).toBe(400);
    const staleTabletLiveStop = await api('/api/club-tablet/live', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ sessionId: 'older-tablet-activity-session' }),
    });
    await expect(staleTabletLiveStop.json()).resolves.toEqual({ stopped: false });
    const missingTabletLiveStop = await api('/api/club-tablet/live', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(missingTabletLiveStop.status).toBe(400);
    const staleTabletCleanup = await api('/api/club-live/frames', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ sessionId: 'older-tablet-activity-session' }),
    });
    await expect(staleTabletCleanup.json()).resolves.toEqual({ stopped: false });
    const missingSessionCleanup = await api('/api/club-live/frames', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(missingSessionCleanup.status).toBe(400);
    const stoppedTabletFrame = await api('/api/club-live/frames', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ sessionId: resumedTabletLivePayload.session.sessionId }),
    });
    expect(stoppedTabletFrame.status).toBe(200);
    await expect(stoppedTabletFrame.json()).resolves.toEqual({ stopped: true });
    cookie = monitorCookie;
    await expect((await api('/api/club-live/frames')).json()).resolves.toMatchObject({ frames: [] });
    cookie = '';

    await new Promise((resolve) => setTimeout(resolve, 5));
    const explicitAthleteHeartbeat = await api('/api/club-tablet/sessions/current', {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(explicitAthleteHeartbeat.status).toBe(200);
    const explicitAthleteHeartbeatPayload = await explicitAthleteHeartbeat.json();
    // Ending the Club Event does not end the selected athlete. The kiosk's
    // explicit heartbeat continues renewing the normal idle window until the
    // rider chooses End activity on that tablet.
    expect(explicitAthleteHeartbeatPayload.session.expiresAt).toBeGreaterThan(
      livePublishPayload.athleteSessionExpiresAt,
    );
    expect(explicitAthleteHeartbeatPayload.session.expiresAt).toBeGreaterThan(Date.now() + 14 * 60_000);
    cookie = monitorCookie;
    const monitored = await api('/api/club-live/sessions');
    await expect(monitored.json()).resolves.toMatchObject({
      sessions: [expect.objectContaining({
        studioRiderId: 'shared-tablet-rider-one',
        activityType: 'straight-sprint',
        deviceId: firstDevice.device.id,
      })],
    });
    cookie = '';
    const heldTabletEndSessionId = 'held-tablet-live-end-session';
    const heldTabletEndPublish = await beginHeldJsonRequest('/api/club-tablet/live', {
      authCookie: '',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: {
        sessionId: heldTabletEndSessionId,
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.55,
        metrics: { watts: 825, cadence: 122, speedKph: 37 },
      },
    });
    const heldTabletEnd = await api('/api/club-tablet/live', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ sessionId: heldTabletEndSessionId }),
    });
    await expect(heldTabletEnd.json()).resolves.toEqual({ stopped: false });
    heldTabletEndPublish.release();
    expect((await heldTabletEndPublish.responsePromise).status).toBe(409);
    const stoppedTabletLive = await api('/api/club-tablet/live', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify({ sessionId: resumedTabletLivePayload.session.sessionId }),
    });
    await expect(stoppedTabletLive.json()).resolves.toEqual({ stopped: true });
    cookie = monitorCookie;

    const tabletTicket = await clubTabletSocketTicket(selectedPayload.sessionToken);
    // The explicit tablet ticket remains authoritative even though this test
    // browser also carries the club owner's authenticated cookie.
    const tabletSocket = await openClubTabletSocketWithTicket(tabletTicket.ticket, monitorCookie);
    await expectClubTabletTicketRejected(tabletTicket.ticket, monitorCookie);
    await expectClubTabletTicketRejected(selectedPayload.sessionToken);
    const expiringTabletTicket = await clubTabletSocketTicket(selectedPayload.sessionToken);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await expectClubTabletTicketRejected(expiringTabletTicket.ticket);
    const tabletConnected = await waitForSocketMessage(tabletSocket, (message) => message.type === 'connected');
    tabletSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    const tabletWelcome = await waitForSocketMessage(tabletSocket, (message) => message.type === 'welcome');
    expect(tabletWelcome.riders.find(
      (rider: { id: string }) => rider.id === tabletConnected.clientId,
    )).toMatchObject({ name: 'Tablet Rider One', membershipTier: 'racer', racerSeatCount: 0 });
    const tabletFriendMessageIndex = tabletSocket.messages.length;
    tabletSocket.socket.send(JSON.stringify({ type: 'friend-request', targetId: 'RIDER-forged-target' }));
    await waitForSocketMessage(
      tabletSocket,
      (message) => message.type === 'challenge-status'
        && /personal account/i.test(String(message.message)),
      tabletFriendMessageIndex,
    );
    const tabletFriendResponseIndex = tabletSocket.messages.length;
    tabletSocket.socket.send(JSON.stringify({
      type: 'friend-response',
      requestId: 'forged-tablet-request',
      accepted: true,
    }));
    await waitForSocketMessage(
      tabletSocket,
      (message) => message.type === 'challenge-status'
        && /personal account/i.test(String(message.message)),
      tabletFriendResponseIndex,
    );
    tabletSocket.socket.send(JSON.stringify({
      type: 'create-room',
      private: true,
      racerSeatCount: 4,
      track: { id: 'shared-tablet-track', name: 'Shared Tablet Track' },
    }));
    const tabletRoom = await waitForSocketMessage(
      tabletSocket,
      (message) => message.type === 'room-state'
        && message.room?.members?.some((member: { id: string }) => member.id === tabletConnected.clientId),
    );
    expect(tabletRoom.room.members.find(
      (member: { id: string }) => member.id === tabletConnected.clientId,
    )).toMatchObject({ roomRole: 'racer', racerSeatCount: 1 });

    const tabletTrackId = `shared-tablet-track-${now}`;
    const raceSessionId = `shared-tablet-race-${now}`;
    const raceSyncMessageIndex = tabletSocket.messages.length;
    tabletSocket.socket.send(JSON.stringify({
      type: 'race-sync',
      state: {
        sessionId: raceSessionId,
        trackId: tabletTrackId,
        raceState: 'finished',
        riders: [{ id: 'tablet-local-rider', playerId: 2, name: 'Pseudo Tablet Identity' }],
        summary: [{
          playerId: 2,
          riderName: 'Pseudo Tablet Identity',
          rank: 1,
          finishTimeMs: 700,
          topCadence: 200,
          topWatts: 9_999,
        }],
      },
    }));
    await waitForSocketMessage(
      tabletSocket,
      (message) => message.type === 'race-sync' && message.state?.sessionId === raceSessionId,
      raceSyncMessageIndex,
    );
    const beforeScopedRaceSave = await api(`/api/multiplayer/leaderboards?trackId=${tabletTrackId}`);
    expect(JSON.stringify(await beforeScopedRaceSave.json())).not.toContain('Pseudo Tablet Identity');

    const trainingId = `shared-tablet-training-${now}`;
    const trainingRequestPayload = {
      localPlayerId: 2,
      session: {
        id: trainingId,
        activityType: 'straight-sprint',
        title: 'Shared tablet sprint',
        startedAt: now - 2_000,
        endedAt: now - 1_000,
        durationMs: 1_000,
        distanceMeters: 44.2,
        details: {
          summaries: [
            { playerId: 1, riderName: 'Sibling', finishTimeMs: 900, distanceMeters: 44.2 },
            { playerId: 2, riderName: 'Forged Name', finishTimeMs: 950, distanceMeters: 44.2 },
          ],
          events: [{ label: 'Sibling data must not leave the tablet boundary' }],
          otherRiders: [{ name: 'Private sibling' }],
          privateNotes: 'Owner-only medical note',
        },
      },
    };
    const trainingSave = await api('/api/club-tablet/training-sessions', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(trainingRequestPayload),
    });
    expect(trainingSave.status).toBe(201);
    const trainingPayload = await trainingSave.json();
    expect(trainingPayload.session.details.summaries).toEqual([
      expect.objectContaining({
        playerId: 2,
        riderId: 'shared-tablet-rider-one',
        riderName: 'Tablet Rider One',
      }),
    ]);
    expect(trainingPayload.session.details.events).toEqual([]);
    expect(JSON.stringify(trainingPayload)).not.toContain('Sibling data');
    expect(JSON.stringify(trainingPayload)).not.toContain('Private sibling');
    expect(JSON.stringify(trainingPayload)).not.toContain('medical note');
    const trainingReplay = await api('/api/club-tablet/training-sessions', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(trainingRequestPayload),
    });
    expect(trainingReplay.status).toBe(200);
    await expect(trainingReplay.json()).resolves.toMatchObject({
      replayed: true,
      session: { id: trainingId },
    });

    const raceRequestPayload = {
      sessionId: raceSessionId,
      trackId: tabletTrackId,
      trackName: 'Shared Tablet Track',
      localPlayerId: 2,
      summaries: [
        { playerId: 1, riderName: 'Sibling', rank: 1, finishTimeMs: 800, topWatts: 9999 },
        {
          playerId: 2,
          riderName: 'Forged Name',
          rank: 2,
          finishTimeMs: 950,
          distanceMeters: 44.2,
          topSpeedKph: 35,
          averageSpeedKph: 30,
          topCadence: 120,
          averageCadence: 100,
          topWatts: 800,
          averageWatts: 600,
        },
      ],
    };
    const raceSave = await api('/api/club-tablet/race-results', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(raceRequestPayload),
    });
    expect(raceSave.status).toBe(201);
    await expect(raceSave.json()).resolves.toMatchObject({ saved: 1 });
    const raceReplay = await api('/api/club-tablet/race-results', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(raceRequestPayload),
    });
    expect(raceReplay.status).toBe(200);
    await expect(raceReplay.json()).resolves.toMatchObject({ saved: 1, replayed: true });
    const leaderboardResponse = await api(`/api/multiplayer/leaderboards?trackId=${tabletTrackId}`);
    const leaderboardPayload = await leaderboardResponse.json();
    expect(JSON.stringify(leaderboardPayload)).toContain('Tablet Rider One');
    expect(JSON.stringify(leaderboardPayload)).not.toContain('Sibling');
    expect(JSON.stringify(leaderboardPayload)).not.toContain('Pseudo Tablet Identity');
    expect(JSON.stringify(leaderboardPayload)).not.toMatch(/"[^"]*(?:watts?|power)[^"]*"\s*:/i);
    for (const entries of Object.values(leaderboardPayload.leaderboards) as Array<Array<{ rider: string }>>) {
      expect(entries.filter((entry) => entry.rider === 'Tablet Rider One')).toHaveLength(1);
    }

    const ghostRequestPayload = {
      localPlayerId: 2,
      ghost: {
        id: `shared-tablet-ghost-${now}`,
        trackId: tabletTrackId,
        trackName: 'Shared Tablet Track',
        ownerKey: 'forged-owner',
        ownerName: 'Forged Owner',
        riderName: 'Forged Name',
        colorName: 'blue',
        accent: '#38a8ff',
        raceSource: 'live',
        lapCount: 1,
        finishTimeMs: 950,
        savedAt: now,
        analyticsPublic: true,
        summary: {
          playerId: 2,
          riderName: 'Forged Name',
          rank: 1,
          finishTimeMs: 950,
          distanceMeters: 44.2,
          topCadence: 120,
          topWatts: 800,
        },
        zoneResults: [{
          zoneId: 'zone-one',
          zoneName: 'Zone One',
          zoneType: 'pedal',
          startMeter: 0,
          endMeter: 44.2,
          riders: [
            { playerId: 1, sampleCount: 10, topWatts: 9999 },
            { playerId: 2, sampleCount: 10, topWatts: 800 },
          ],
        }],
        points: [
          { elapsedMs: 0, distanceMeters: 0 },
          { elapsedMs: 950, distanceMeters: 44.2 },
        ],
      },
    };
    const ghostSave = await api('/api/club-tablet/ghosts', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(ghostRequestPayload),
    });
    expect(ghostSave.status).toBe(200);
    await expect(ghostSave.json()).resolves.toMatchObject({ replayed: false });
    const ghostReplay = await api('/api/club-tablet/ghosts', {
      method: 'POST',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: JSON.stringify(ghostRequestPayload),
    });
    expect(ghostReplay.status).toBe(200);
    await expect(ghostReplay.json()).resolves.toMatchObject({ replayed: true });

    const selectedGhosts = await api(`/api/club-tablet/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`, {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(selectedGhosts.status).toBe(200);
    await expect(selectedGhosts.json()).resolves.toMatchObject({
      trackId: tabletTrackId,
      ghosts: [expect.objectContaining({
        source: 'personal',
        riderName: 'Tablet Rider One',
        summary: expect.objectContaining({ playerId: 2, topWatts: 800 }),
      })],
    });
    const cookieBeforePublicGhostRead = cookie;
    cookie = '';
    const publicGhosts = await api(`/api/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`);
    cookie = cookieBeforePublicGhostRead;
    expect(publicGhosts.status).toBe(200);
    const publicGhostPayload = await publicGhosts.json();
    expect(publicGhostPayload.ghosts).toHaveLength(1);
    expect(JSON.stringify(publicGhostPayload)).not.toMatch(/"[^"]*(?:watts?|power)[^"]*"\s*:/i);
    const wrongSprintCategory = await api(
      `/api/club-tablet/ghosts?trackId=${encodeURIComponent(tabletTrackId)}&sprintDistanceFeet=145&sprintAirSetting=5`,
      { headers: athleteHeaders(selectedPayload.sessionToken) },
    );
    await expect(wrongSprintCategory.json()).resolves.toMatchObject({ ghosts: [] });

    const siblingSessionResponse = await startTabletSession(
      replacementDevice.deviceToken,
      'shared-tablet-rider-two',
      'WattbikePM25043951',
    );
    expect(siblingSessionResponse.status).toBe(201);
    const siblingSessionPayload = await siblingSessionResponse.json();
    const siblingGhostPayload = {
      localPlayerId: 1,
      ghost: {
        ...ghostRequestPayload.ghost,
        id: `shared-tablet-sibling-ghost-${now}`,
        riderName: 'Forged sibling',
        finishTimeMs: 900,
        summary: {
          ...ghostRequestPayload.ghost.summary,
          playerId: 1,
          topWatts: 777,
        },
        zoneResults: [],
      },
    };
    expect((await api('/api/club-tablet/ghosts', {
      method: 'POST',
      headers: athleteHeaders(siblingSessionPayload.sessionToken),
      body: JSON.stringify(siblingGhostPayload),
    })).status).toBe(200);
    const selectedAfterSiblingSave = await api(
      `/api/club-tablet/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`,
      { headers: athleteHeaders(selectedPayload.sessionToken) },
    );
    const selectedAfterSiblingPayload = await selectedAfterSiblingSave.json();
    expect(selectedAfterSiblingPayload.ghosts).toHaveLength(1);
    expect(JSON.stringify(selectedAfterSiblingPayload)).not.toContain('Tablet Rider Two');
    expect(selectedAfterSiblingPayload.ghosts[0]).toMatchObject({
      riderName: 'Tablet Rider One',
      summary: { topWatts: 800 },
    });
    const siblingGhosts = await api(
      `/api/club-tablet/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`,
      { headers: athleteHeaders(siblingSessionPayload.sessionToken) },
    );
    await expect(siblingGhosts.json()).resolves.toMatchObject({
      ghosts: [expect.objectContaining({ riderName: 'Tablet Rider Two', source: 'personal' })],
    });
    await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(siblingSessionPayload.sessionToken),
    });

    const heldTabletIdentityEndPublish = await beginHeldJsonRequest('/api/club-tablet/live', {
      authCookie: '',
      headers: athleteHeaders(selectedPayload.sessionToken),
      body: {
        sessionId: 'held-tablet-identity-end-session',
        activityType: 'explore',
        status: 'active',
        progress: 0.2,
        metrics: { speedKph: 19, distanceMeters: 400 },
      },
    });
    const ended = await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(ended.status).toBe(200);
    heldTabletIdentityEndPublish.release();
    expect([401, 409]).toContain((await heldTabletIdentityEndPublish.responsePromise).status);
    const replay = await api('/api/club-tablet/sessions/current', {
      headers: athleteHeaders(selectedPayload.sessionToken),
    });
    expect(replay.status).toBe(401);
    tabletSocket.socket.close();

    // Ending an athlete identity releases both locks while preserving the
    // durable tablet enrollment (and therefore its independent BLE pairing).
    expect((await api('/api/club-live/sessions')).status).toBe(200);
    const reuse = await startTabletSession(
      firstDevice.deviceToken,
      'shared-tablet-rider-one',
      'WattbikePM25043950',
    );
    expect(reuse.status).toBe(201);
    const reusePayload = await reuse.json();
    await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(reusePayload.sessionToken),
    });
    const enrolledAfterIdentityEnd = await api('/api/club-tablet/roster', {
      headers: deviceHeaders(firstDevice.deviceToken),
    });
    expect(enrolledAfterIdentityEnd.status).toBe(200);

    // An unclaimed tablet workout follows the studio rider when that athlete
    // later claims their account, without exposing the sibling's result.
    cookie = monitorCookie;
    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'shared-tablet-rider-one' }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json();
    cookie = secondaryCookie;
    const claim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token, fullName: 'Tablet Athlete Claimed' }),
    });
    expect(claim.status).toBe(200);
    const claimedAccountExploreRoute = exploreRoute('EXPLORE-CLAIMED-ACCOUNT');
    const claimedAccountRouteSave = await api('/api/explore/recent-routes', {
      method: 'POST',
      body: JSON.stringify({ routes: [claimedAccountExploreRoute] }),
    });
    expect(claimedAccountRouteSave.status).toBe(200);
    const claimedHistory = await api(`/api/training-sessions?from=${now - 5_000}&to=${Date.now() + 1_000}`);
    const claimedHistoryPayload = await claimedHistory.json();
    const claimedTrainingSession = claimedHistoryPayload.sessions.find(
      (session: { id: string }) => session.id.includes(trainingId),
    );
    expect(claimedTrainingSession).toMatchObject({
      club: { studioRiderId: 'shared-tablet-rider-one', role: 'athlete' },
      details: {
        summaries: [expect.objectContaining({ riderId: 'shared-tablet-rider-one' })],
      },
    });
    expect(JSON.stringify(claimedTrainingSession)).not.toContain('Sibling');
    expect(claimedHistoryPayload.sessions.filter(
      (session: { id: string }) => session.id.includes(trainingId),
    )).toHaveLength(1);
    const claimedGhosts = await api(`/api/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`);
    expect(claimedGhosts.status).toBe(200);
    const claimedGhostPayload = await claimedGhosts.json();
    const claimedPersonalGhost = claimedGhostPayload.ghosts.find(
      (ghost: { riderName: string }) => ghost.riderName === 'Tablet Rider One',
    );
    expect(claimedPersonalGhost).toMatchObject({
      source: 'personal',
      riderName: 'Tablet Rider One',
      summary: expect.objectContaining({ playerId: 2, riderName: 'Tablet Rider One' }),
      zoneResults: [expect.objectContaining({
        riders: [expect.objectContaining({ playerId: 2, topWatts: 800 })],
      })],
    });
    expect(JSON.stringify(claimedPersonalGhost)).not.toContain('9999');
    expect(JSON.stringify(claimedPersonalGhost)).not.toContain('Forged Owner');

    // A newly selected claimed athlete sees both future account-key ghosts and
    // the exact pre-claim tablet-history alias, never a sibling's private lap.
    cookie = monitorCookie;
    expect((await api('/api/club-live/sessions')).status).toBe(200);
    const claimedTabletSession = await startTabletSession(
      firstDevice.deviceToken,
      'shared-tablet-rider-one',
      'WattbikePM25043950',
    );
    expect(claimedTabletSession.status).toBe(201);
    const claimedTabletSessionPayload = await claimedTabletSession.json();
    const claimedTabletRoutes = await api('/api/explore/recent-routes', {
      headers: athleteHeaders(claimedTabletSessionPayload.sessionToken),
    });
    expect(claimedTabletRoutes.status).toBe(200);
    await expect(claimedTabletRoutes.json()).resolves.toMatchObject({
      routes: [{ id: claimedAccountExploreRoute.id }],
    });
    const claimedTabletGhosts = await api(
      `/api/club-tablet/ghosts?trackId=${encodeURIComponent(tabletTrackId)}`,
      { headers: athleteHeaders(claimedTabletSessionPayload.sessionToken) },
    );
    const claimedTabletGhostPayload = await claimedTabletGhosts.json();
    expect(claimedTabletGhostPayload.ghosts).toEqual([
      expect.objectContaining({ riderName: 'Tablet Rider One', source: 'personal' }),
    ]);
    expect(JSON.stringify(claimedTabletGhostPayload)).not.toContain('Tablet Rider Two');
    await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: athleteHeaders(claimedTabletSessionPayload.sessionToken),
    });
    cookie = originalCookie;
  });

  it('serializes shared tablet athlete selection across concurrent club requests', async () => {
    const originalCookie = cookie;
    let loginSequence = 80;
    const signInOwner = async () => {
      loginSequence += 1;
      const ownerLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `203.0.113.${loginSequence}` },
        body: JSON.stringify({
          email: 'club-owner-admin@tracklab.test',
          password: 'correct-horse-battery-staple',
        }),
      });
      expect(ownerLogin.status).toBe(200);
      const signedInCookie = String(ownerLogin.headers.get('set-cookie')).split(';')[0];
      cookie = signedInCookie;
      return signedInCookie;
    };
    const monitorCookie = await signInOwner();

    const now = Date.now();
    const riders = Array.from({ length: 5 }, (_, index) => ({
      id: `atomic-tablet-rider-${index + 1}`,
      name: `Atomic Tablet Rider ${index + 1}`,
      createdAt: now,
      updatedAt: now,
    }));
    expect((await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ studioRiders: riders }),
    })).status).toBe(200);

    // One stolen/replayed enrollment cookie may create at most one durable
    // tablet credential, even when both requests clear authentication before
    // either caller observes the response.
    const duplicateEnrollmentCookie = await signInOwner();
    const duplicateEnrollmentResponses = await Promise.all([
      'Atomic duplicate enrollment A',
      'Atomic duplicate enrollment B',
    ].map((name) => fetch(`${baseUrl}/api/club-tablet/devices`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        Cookie: duplicateEnrollmentCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })));
    expect(duplicateEnrollmentResponses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(duplicateEnrollmentResponses.filter((response) => response.status !== 201)).toHaveLength(1);
    const successfulDuplicateEnrollment = duplicateEnrollmentResponses.find(
      (response) => response.status === 201,
    );
    expect(successfulDuplicateEnrollment?.headers.get('set-cookie')).toContain('Max-Age=0');
    cookie = monitorCookie;
    const devicesAfterDuplicateAttempt = await api('/api/club-tablet/devices');
    expect(devicesAfterDuplicateAttempt.status).toBe(200);
    const devicesAfterDuplicatePayload = await devicesAfterDuplicateAttempt.json();
    expect(devicesAfterDuplicatePayload.devices.filter(
      (device: { name: string }) => device.name.startsWith('Atomic duplicate enrollment'),
    )).toHaveLength(1);

    const devices = [];
    for (let index = 0; index < 5; index += 1) {
      cookie = await signInOwner();
      const response = await api('/api/club-tablet/devices', {
        method: 'POST',
        body: JSON.stringify({ name: `Atomic Studio iPad ${index + 1}` }),
      });
      expect(response.status).toBe(201);
      devices.push(await response.json());
      cookie = '';
    }

    const refreshOwnerMonitor = async () => {
      cookie = monitorCookie;
      expect((await api('/api/club-live/sessions')).status).toBe(200);
    };
    const startSession = (deviceIndex: number, riderIndex: number, bikeDeviceId: string) => (
      api('/api/club-tablet/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${devices[deviceIndex].deviceToken}` },
        body: JSON.stringify({
          studioRiderId: riders[riderIndex].id,
          bikeDeviceId,
        }),
      })
    );
    const readResponses = (responses: Response[]) => Promise.all(responses.map(async (response) => ({
      status: response.status,
      body: await response.json(),
    })));
    const stopSuccessfulSessions = async (records: Array<{
      status: number;
      body: { sessionToken?: string };
    }>) => {
      for (const record of records) {
        if (record.status !== 201 || !record.body.sessionToken) continue;
        const stopped = await api('/api/club-tablet/sessions', {
          method: 'DELETE',
          headers: { 'X-TrackLab-Club-Tablet-Session': record.body.sessionToken },
        });
        expect(stopped.status).toBe(200);
      }
    };

    await refreshOwnerMonitor();
    let records = await readResponses(await Promise.all([
      startSession(0, 0, 'atomic-bike-a'),
      startSession(1, 0, 'atomic-bike-b'),
    ]));
    expect(records.map((record) => record.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(records.find((record) => record.status === 409)?.body).toMatchObject({
      error: 'That athlete is already active on another club tablet.',
    });
    await stopSuccessfulSessions(records);

    await refreshOwnerMonitor();
    records = await readResponses(await Promise.all([
      startSession(0, 0, 'atomic-bike-shared'),
      startSession(1, 1, 'atomic-bike-shared'),
    ]));
    expect(records.map((record) => record.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(records.find((record) => record.status === 409)?.body).toMatchObject({
      error: 'That Wattbike is already assigned to another active club tablet.',
    });
    await stopSuccessfulSessions(records);

    await refreshOwnerMonitor();
    records = await readResponses(await Promise.all(devices.map((_, index) => (
      startSession(index, index, `atomic-cap-bike-${index + 1}`)
    ))));
    expect(records.filter((record) => record.status === 201)).toHaveLength(4);
    expect(records.filter((record) => record.status === 409)).toHaveLength(1);
    expect(records.find((record) => record.status === 409)?.body).toMatchObject({
      error: 'This club is already using all 4 purchased bike seats.',
    });
    await stopSuccessfulSessions(records);
    cookie = originalCookie;
  });

  it('publishes one developer-locked camera view for every account and device', async () => {
    const nonAdminCookie = cookie;
    const forbidden = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: true,
          earthCamerasByTrack: {
            'north-bay-bmx': { angle: 10, heading: 20, zoom: 18, updatedAt: 100 },
          },
        },
      }),
    });
    expect(forbidden.status).toBe(403);

    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Developer',
        email: 'global-view-admin@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(registration.status).toBe(201);
    cookie = String(registration.headers.get('set-cookie')).split(';')[0];

    const saved = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 700,
          earthCamerasByTrack: {
            'north-bay-bmx': {
              angle: 53,
              heading: 215,
              center: { lat: 38.2445, lng: -122.2825 },
              zoom: 20,
              updatedAt: 750,
            },
          },
          riderOverlaysByTrack: {
            'north-bay-bmx': {
              xPct: 0.04,
              yPct: 0.64,
              width: 940,
              height: 190,
              locked: true,
            },
          },
          riderOverlayUpdatedAtByTrack: { 'north-bay-bmx': 750 },
          demoRiderNames: { 1: 'Must stay private' },
        },
      }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      raceViewPreferences: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 750,
        earthCamerasByTrack: {
          'north-bay-bmx': {
            angle: 53,
            heading: 215,
            zoom: 20,
            updatedAt: 750,
          },
        },
        riderOverlaysByTrack: {
          'north-bay-bmx': {
            xPct: 0.04,
            yPct: 0.64,
            width: 940,
            height: 190,
            locked: true,
          },
        },
        riderOverlayUpdatedAtByTrack: { 'north-bay-bmx': 750 },
      },
    });

    const globalRaceViewDeveloperCookie = cookie;
    cookie = '';
    const publicView = await api('/api/global-race-view');
    expect(publicView.status).toBe(200);
    const publicPayload = await publicView.json();
    expect(publicPayload.raceViewPreferences).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'north-bay-bmx': { angle: 53, heading: 215, zoom: 20 },
      },
      riderOverlaysByTrack: {
        'north-bay-bmx': {
          xPct: 0.04,
          yPct: 0.64,
          width: 940,
          height: 190,
          locked: true,
        },
      },
    });
    expect(publicPayload.raceViewPreferences).not.toHaveProperty('demoRiderNames');

    cookie = globalRaceViewDeveloperCookie;
    const overlayOnlySave = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 0,
          earthCamerasByTrack: {},
          riderOverlaysByTrack: {
            'new-custom-sprint:straight-sprint:100ft': {
              xPct: 0.08,
              yPct: 0.7,
              width: 820,
              height: 190,
              locked: true,
            },
          },
          riderOverlayUpdatedAtByTrack: {
            'new-custom-sprint:straight-sprint:100ft': 900,
          },
        },
      }),
    });
    expect(overlayOnlySave.status).toBe(200);
    await expect(overlayOnlySave.json()).resolves.toMatchObject({
      raceViewPreferences: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 900,
        earthCamerasByTrack: {},
        riderOverlaysByTrack: {
          'new-custom-sprint:straight-sprint:100ft': {
            width: 820,
            height: 190,
            locked: true,
          },
        },
      },
    });
    cookie = nonAdminCookie;
  });

  it('prepares a truthful local pre-race briefing when hosted AI is unavailable', async () => {
    const response = await api('/api/commentary/pre-race', {
      method: 'POST',
      body: JSON.stringify({
        track: {
          id: 'north-bay-bmx',
          name: 'North Bay BMX',
          country: 'United States',
          countryCode: 'US',
          state: 'California',
          region: 'North America',
          city: 'Napa',
          surface: 'dirt',
          lengthMeters: 340,
          source: 'USA BMX',
          sourceUrl: 'https://www.usabmx.com/tracks/1946',
          zoneCount: 4,
          pedalZoneCount: 3,
          pedalMeters: 180,
          recoveryZoneCount: 1,
          recoveryMeters: 40,
          technicalZoneCount: 0,
          technicalMeters: 0,
          splitCount: 1,
          hasProSet: true,
          lapCount: 1,
          riders: [
            { playerId: 1, name: 'Maya Torres', colorName: 'lime' },
            { playerId: 2, name: 'Jordan Lee', colorName: 'blue' },
          ],
        },
        model: 'gpt-5.6-terra',
        voicePreset: 'american-man',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      line: expect.stringMatching(/Maya Torres and Jordan Lee.*North Bay BMX/),
      source: 'local',
      supportedVariableCount: 73,
      weather: { available: false },
      sources: [{
        title: 'USA BMX',
        url: 'https://www.usabmx.com/tracks/1946',
        kind: 'track',
      }],
    });
  });

  it('refuses to turn telemetry figures into spoken commentary', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery is holding 120 RPM and 35 KPH.',
        voicePreset: 'american-man',
        eventKind: 'final-push',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('refuses repetitive mapped-zone jargon in live race speech', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery attacks Pedal Zone 4.',
        voicePreset: 'american-man',
        eventKind: 'pedal-zone',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('refuses demeaning sarcasm about a racer', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery is a pathetic rider who does not belong.',
        voicePreset: 'american-man',
        eventKind: 'pedal-zone',
        deliveryStyle: 'wry',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('blocks spectator publication and exposes no legacy external-payment completion route', async () => {
    const publishing = await api('/api/public-track-mappings', {
      method: 'POST',
      body: JSON.stringify({ trackMappings: {} }),
    });
    expect(publishing.status).toBe(403);

    const billing = await api('/api/auth/billing-return', {
      method: 'POST',
      body: JSON.stringify({ billingState: 'forged-checkout-state' }),
    });
    expect(billing.status).toBe(404);
    const checkout = await api('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ bikeSeats: 4 }),
    });
    expect(checkout.status).toBe(404);
    const config = await api('/api/billing/config');
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toMatchObject({
      provider: 'apple-app-store',
      enabled: false,
      configured: false,
    });
  });

  it('records idempotent 3D scene loads and restricts usage totals to administrators', async () => {
    const eventId = `3d-test-${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      trackId: 'north-bay-bmx-napa-valley',
      trackName: 'North Bay BMX - Napa Valley',
      context: 'edit',
    });
    const firstLoad = await api('/api/map-3d-loads', { method: 'POST', body: payload });
    const retriedLoad = await api('/api/map-3d-loads', { method: 'POST', body: payload });
    expect(firstLoad.status).toBe(201);
    expect(retriedLoad.status).toBe(201);

    const forbidden = await api('/api/admin/map-3d-usage');
    expect(forbidden.status).toBe(403);
    const removedAppleMapConfig = await api('/api/admin/apple-map-config');
    expect(removedAppleMapConfig.status).toBe(404);

    const regularCookie = cookie;
    const adminRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Operator',
        email: 'usage-admin@tracklab.test',
        password: 'admin-correct-horse-battery-staple',
      }),
    });
    expect(adminRegistration.status).toBe(201);
    cookie = String(adminRegistration.headers.get('set-cookie')).split(';')[0];

    try {
      const usageResponse = await api('/api/admin/map-3d-usage');
      expect(usageResponse.status).toBe(200);
      expect(usageResponse.headers.get('cache-control')).toBe('no-store');
      await expect(usageResponse.json()).resolves.toMatchObject({
        monthlyAllowance: 5000,
        thisMonth: { count: 1, remaining: 4999 },
        today: 1,
        lifetime: 1,
        byContext: [{ context: 'edit', count: 1 }],
        topTracks: [{
          trackId: 'north-bay-bmx-napa-valley',
          trackName: 'North Bay BMX - Napa Valley',
          count: 1,
        }],
      });
      const removedAppleMapConfigAsAdmin = await api('/api/admin/apple-map-config');
      expect(removedAppleMapConfigAsAdmin.status).toBe(404);
    } finally {
      cookie = regularCookie;
    }
  });

  it('restricts track mapping edits and publication to the developer account', async () => {
    const privateMapping = trackMapping('private-north-bay-map');
    const privateSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: privateMapping }),
    });
    expect(privateSave.status).toBe(403);
    await expect(privateSave.json()).resolves.toMatchObject({
      error: 'Only the TrackLab developer can edit track routes and pedal zones.',
    });

    const privateProfile = await api('/api/user-data');
    const privateProfilePayload = await privateProfile.json() as { trackMappings: Record<string, unknown> };
    expect(privateProfilePayload.trackMappings[privateMapping.trackId]).toBeUndefined();

    const genericMappingPatch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ trackMappings: { [privateMapping.trackId]: privateMapping } }),
    });
    expect(genericMappingPatch.status).toBe(403);

    const publicBeforeAdmin = await api('/api/public-track-mappings');
    const publicBeforePayload = await publicBeforeAdmin.json() as { trackMappings: Record<string, unknown> };
    expect(publicBeforePayload.trackMappings[privateMapping.trackId]).toBeUndefined();

    const adminRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Admin',
        email: 'admin-only@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(adminRegistration.status).toBe(201);
    cookie = String(adminRegistration.headers.get('set-cookie')).split(';')[0];

    const sharedMapping = {
      ...trackMapping('shared-north-bay-map'),
      raceViewMode: '3d',
    };
    const sharedSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: sharedMapping }),
    });
    expect(sharedSave.status).toBe(200);
    await expect(sharedSave.json()).resolves.toMatchObject({
      mapping: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
      published: true,
      publicMapping: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
    });

    const publicAfterAdmin = await api('/api/public-track-mappings');
    await expect(publicAfterAdmin.json()).resolves.toMatchObject({
      trackMappings: {
        [sharedMapping.trackId]: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
      },
    });

    const legacyGameMapping = {
      ...trackMapping('north-bay-bmx-napa-valley'),
      trackName: 'North Bay BMX - Napa Valley',
      raceViewMode: 'game',
      gameRoute: {
        id: 'amateur',
        name: 'Game Track',
        restAfterSeconds: 1,
        lengthMeters: 380,
        centerline: [{ lat: -0.0001, lng: 0.0002 }, { lat: -0.0004, lng: 0.001 }],
        startGate: { lat: -0.0001, lng: 0.0002 },
        finishLine: { lat: -0.0004, lng: 0.001 },
        zoneBoundaryMeters: [0, 45],
        zones: [{ id: 'game-pedal-1', name: 'Pedal Zone 1', startMeter: 0, endMeter: 45, type: 'pedal' }],
        splitSections: [],
      },
    };
    const gameSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: legacyGameMapping }),
    });
    expect(gameSave.status).toBe(200);
    await expect(gameSave.json()).resolves.toMatchObject({
      mapping: { trackId: legacyGameMapping.trackId, raceViewMode: 'satellite' },
      published: true,
      publicMapping: { trackId: legacyGameMapping.trackId, raceViewMode: 'satellite' },
    });

    const gameProfile = await api('/api/user-data');
    const gameProfilePayload = await gameProfile.json() as { trackMappings: Record<string, Record<string, unknown>> };
    expect(gameProfilePayload.trackMappings[legacyGameMapping.trackId]).toMatchObject({
      trackId: legacyGameMapping.trackId,
      raceViewMode: 'satellite',
    });
    expect(gameProfilePayload.trackMappings[legacyGameMapping.trackId].gameRoute).toBeUndefined();
    const publicAfterGameSave = await api('/api/public-track-mappings');
    const publicAfterGameSavePayload = await publicAfterGameSave.json() as { trackMappings: Record<string, Record<string, unknown>> };
    expect(publicAfterGameSavePayload.trackMappings[legacyGameMapping.trackId]).toMatchObject({
      trackId: legacyGameMapping.trackId,
      raceViewMode: 'satellite',
    });
    expect(publicAfterGameSavePayload.trackMappings[legacyGameMapping.trackId].gameRoute).toBeUndefined();

    const customTrack = customSprintTrack(`custom-drag-strip-${Date.now()}`);
    const customMapping = {
      ...trackMapping(customTrack.id),
      trackName: customTrack.name,
      country: customTrack.country,
      state: customTrack.state,
      lengthMeters: customTrack.lengthMeters,
    };
    const customSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: customMapping, track: customTrack }),
    });
    expect(customSave.status).toBe(200);
    await expect(customSave.json()).resolves.toMatchObject({
      mapping: { trackId: customTrack.id },
      published: true,
      publicMapping: { trackId: customTrack.id },
      publicCustomRoute: {
        id: customTrack.id,
        name: 'Drag Strip',
        state: 'New Hampshire',
        address: 'Drag Strip, Epping, NH 03042, USA',
      },
    });

    const publicCustomRoutes = await api('/api/public-custom-routes');
    await expect(publicCustomRoutes.json()).resolves.toMatchObject({
      customRoutes: [{ id: customTrack.id, name: 'Drag Strip', state: 'New Hampshire' }],
      count: 1,
    });

    const previewTrack = customSprintTrack(`custom-preview-drag-strip-${Date.now()}`);
    const permanentPreviewTrackId = previewTrack.id.replace('custom-preview-', 'custom-');
    const previewMapping = {
      ...trackMapping(previewTrack.id),
      trackName: previewTrack.name,
      country: previewTrack.country,
      state: previewTrack.state,
      lengthMeters: previewTrack.lengthMeters,
    };
    const previewSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: previewMapping, track: previewTrack }),
    });
    expect(previewSave.status).toBe(200);
    await expect(previewSave.json()).resolves.toMatchObject({
      mapping: { trackId: permanentPreviewTrackId },
      published: true,
      publicMapping: { trackId: permanentPreviewTrackId },
      publicCustomRoute: { id: permanentPreviewTrackId, name: 'Drag Strip' },
    });

    const publicAfterPreviewRecovery = await api('/api/public-track-mappings');
    const publicAfterPreviewPayload = await publicAfterPreviewRecovery.json() as {
      customRoutes: Array<{ id: string }>;
      trackMappings: Record<string, unknown>;
    };
    expect(publicAfterPreviewPayload.trackMappings[permanentPreviewTrackId]).toBeDefined();
    expect(publicAfterPreviewPayload.trackMappings[previewTrack.id]).toBeUndefined();
    expect(publicAfterPreviewPayload.customRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: permanentPreviewTrackId }),
    ]));
  });

  it('rejects cross-site mutations and does not cache mutable manifests immutably', async () => {
    const crossSite = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(crossSite.status).toBe(403);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('authorizes commentary for only the exact active club-tablet athlete session', async () => {
    const originalCookie = cookie;
    const now = Date.now();
    let loginSequence = 210;
    const signInOwner = async () => {
      loginSequence += 1;
      const login = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `192.0.2.${loginSequence}` },
        body: JSON.stringify({
          email: 'club-owner-admin@tracklab.test',
          password: 'correct-horse-battery-staple',
        }),
      });
      expect(login.status).toBe(200);
      const signedInCookie = String(login.headers.get('set-cookie')).split(';')[0];
      cookie = signedInCookie;
      return signedInCookie;
    };

    const monitorCookie = await signInOwner();
    const riders = [
      {
        id: `commentary-tablet-one-${now}`,
        name: 'Commentary Tablet One',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `commentary-tablet-two-${now}`,
        name: 'Commentary Tablet Two',
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ];
    expect((await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ studioRiders: riders }),
    })).status).toBe(200);

    const enroll = async (name: string) => {
      await signInOwner();
      const response = await api('/api/club-tablet/devices', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      expect(response.status).toBe(201);
      const device = await response.json();
      cookie = '';
      return device;
    };
    const firstDevice = await enroll(`Commentary iPad A ${now}`);
    const secondDevice = await enroll(`Commentary iPad B ${now}`);
    const startSession = async (
      device: { deviceToken: string },
      studioRiderId: string,
      bikeDeviceId: string,
    ) => {
      const response = await api('/api/club-tablet/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${device.deviceToken}` },
        body: JSON.stringify({ studioRiderId, bikeDeviceId }),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<{ sessionToken: string }>;
    };
    const firstSession = await startSession(firstDevice, riders[0].id, `commentary-bike-a-${now}`);
    const secondSession = await startSession(secondDevice, riders[1].id, `commentary-bike-b-${now}`);
    const tabletHeaders = (sessionToken: string): HeadersInit => ({
      'X-TrackLab-Club-Tablet-Session': sessionToken,
    });
    const deviceHeaders = (deviceToken: string): HeadersInit => ({
      Authorization: `Bearer ${deviceToken}`,
    });

    const trackId = `commentary-tablet-scope-${now}`;
    const track = {
      id: trackId,
      name: 'Commentary Scope Track',
      country: 'United States',
      countryCode: 'US',
      state: 'California',
      region: 'North America',
      city: 'Napa',
      surface: 'dirt',
      lengthMeters: 320,
      zoneCount: 1,
      pedalZoneCount: 1,
      pedalMeters: 45,
      recoveryZoneCount: 0,
      recoveryMeters: 0,
      technicalZoneCount: 0,
      technicalMeters: 0,
      splitCount: 0,
      hasProSet: false,
      lapCount: 1,
      riders: [
        { playerId: 1, name: riders[0].name, colorName: 'lime' },
        { playerId: 2, name: riders[1].name, colorName: 'blue' },
      ],
    };
    const preRace = (sessionToken?: string) => api('/api/commentary/pre-race', {
      method: 'POST',
      ...(sessionToken ? { headers: tabletHeaders(sessionToken) } : {}),
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });

    const baseline = await preRace(firstSession.sessionToken);
    expect(baseline.status).toBe(200);
    const baselinePayload = await baseline.json() as { variableCount: number };

    const demoPreRace = await api('/api/commentary/pre-race', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(demoPreRace.status).toBe(200);
    const demoPreRacePayload = await demoPreRace.json() as { variableCount: number };
    expect(demoPreRacePayload.variableCount).toBe(baselinePayload.variableCount);

    const nativeDemoPreRace = await fetch(`${baseUrl}/api/commentary/pre-race`, {
      method: 'POST',
      headers: {
        Origin: 'capacitor://localhost',
        'Content-Type': 'application/json',
        'X-TrackLab-Native-Session': '1',
        ...deviceHeaders(firstDevice.deviceToken),
      },
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(nativeDemoPreRace.status).toBe(200);
    await expect(nativeDemoPreRace.json()).resolves.toMatchObject({
      variableCount: demoPreRacePayload.variableCount,
    });

    const demoProtectedSpeech = await api('/api/commentary/speech', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({
        line: `${riders[0].name} is holding 120 RPM.`,
        voicePreset: 'american-man',
        eventKind: 'final-push',
        riderNames: [riders[0].name],
      }),
    });
    expect(demoProtectedSpeech.status).toBe(400);

    const protectedSpeech = await api('/api/commentary/speech', {
      method: 'POST',
      headers: tabletHeaders(firstSession.sessionToken),
      body: JSON.stringify({
        line: `${riders[0].name} is holding 120 RPM.`,
        voicePreset: 'american-man',
        eventKind: 'final-push',
        riderNames: [riders[0].name],
      }),
    });
    expect(protectedSpeech.status).toBe(400);
    await expect(protectedSpeech.json()).resolves.toMatchObject({
      error: expect.stringMatching(/safe, natural race action/i),
    });

    cookie = monitorCookie;
    const wrongExplicitToken = await preRace('wrong-commentary-tablet-session-token-1234567890');
    expect(wrongExplicitToken.status).toBe(401);
    cookie = '';
    const wrongSessionWithValidDevice = await api('/api/commentary/pre-race', {
      method: 'POST',
      headers: {
        ...deviceHeaders(firstDevice.deviceToken),
        ...tabletHeaders('wrong-commentary-tablet-session-token-1234567890'),
      },
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(wrongSessionWithValidDevice.status).toBe(401);
    expect((await preRace()).status).toBe(401);

    const saveRace = (
      sessionToken: string,
      sessionId: string,
      localPlayerId: number,
      finishTimeMs: number,
    ) => api('/api/club-tablet/race-results', {
      method: 'POST',
      headers: tabletHeaders(sessionToken),
      body: JSON.stringify({
        sessionId,
        trackId,
        trackName: track.name,
        localPlayerId,
        summaries: [{
          playerId: localPlayerId,
          riderName: 'Forged tablet name',
          rank: 1,
          finishTimeMs,
          distanceMeters: 320,
          topSpeedKph: 35,
          averageSpeedKph: 30,
          topCadence: 120,
          averageCadence: 100,
          topWatts: 800,
          averageWatts: 600,
        }],
      }),
    });
    expect((await saveRace(
      firstSession.sessionToken,
      `commentary-selected-race-${now}`,
      1,
      1_050,
    )).status).toBe(201);
    const selectedWithHistory = await preRace(firstSession.sessionToken);
    expect(selectedWithHistory.status).toBe(200);
    const selectedWithHistoryPayload = await selectedWithHistory.json() as { variableCount: number };
    expect(selectedWithHistoryPayload.variableCount).toBe(baselinePayload.variableCount + 4);

    const demoAfterAthleteHistory = await api('/api/commentary/pre-race', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(demoAfterAthleteHistory.status).toBe(200);
    await expect(demoAfterAthleteHistory.json()).resolves.toMatchObject({
      variableCount: demoPreRacePayload.variableCount,
    });

    expect((await saveRace(
      secondSession.sessionToken,
      `commentary-sibling-race-${now}`,
      2,
      1_100,
    )).status).toBe(201);
    const selectedAfterSiblingSave = await preRace(firstSession.sessionToken);
    expect(selectedAfterSiblingSave.status).toBe(200);
    await expect(selectedAfterSiblingSave.json()).resolves.toMatchObject({
      variableCount: selectedWithHistoryPayload.variableCount,
    });
    const siblingWithHistory = await preRace(secondSession.sessionToken);
    expect(siblingWithHistory.status).toBe(200);
    await expect(siblingWithHistory.json()).resolves.toMatchObject({
      variableCount: baselinePayload.variableCount + 4,
    });
    const demoAfterSiblingHistory = await api('/api/commentary/pre-race', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(demoAfterSiblingHistory.status).toBe(200);
    await expect(demoAfterSiblingHistory.json()).resolves.toMatchObject({
      variableCount: demoPreRacePayload.variableCount,
    });

    expect((await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: tabletHeaders(firstSession.sessionToken),
    })).status).toBe(200);
    expect((await preRace(firstSession.sessionToken)).status).toBe(401);
    expect((await api('/api/club-tablet/sessions', {
      method: 'DELETE',
      headers: tabletHeaders(secondSession.sessionToken),
    })).status).toBe(200);

    cookie = monitorCookie;
    expect((await api('/api/club-tablet/devices', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: firstDevice.device.id }),
    })).status).toBe(200);
    cookie = '';
    const revokedDemoPreRace = await api('/api/commentary/pre-race', {
      method: 'POST',
      headers: deviceHeaders(firstDevice.deviceToken),
      body: JSON.stringify({ track, voicePreset: 'american-man' }),
    });
    expect(revokedDemoPreRace.status).toBe(401);
    cookie = originalCookie;
  });

  it('returns actionable client errors for malformed and oversized JSON', async () => {
    const malformed = await api('/api/auth/login', {
      method: 'POST',
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: 'Request body must be valid JSON.' });

    const oversized = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'rider@tracklab.test', password: 'x'.repeat(33_000) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ error: 'Request body is too large.' });
  });
});
