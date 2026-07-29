import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

type SocketMessage = Record<string, unknown>;

type TestSocket = {
  messages: SocketMessage[];
  socket: WebSocket;
  waitFor: (predicate: (message: SocketMessage) => boolean) => Promise<SocketMessage>;
};

let child: ChildProcess;
let baseUrl = '';
let websocketUrl = '';
const sockets: WebSocket[] = [];

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
      if (response.ok) {
        return;
      }
    } catch {
      // Server may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Explore multiplayer test server did not start.');
}

async function register(name: string, email: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      password: 'explore-correct-horse-battery-staple',
    }),
  });
  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

async function connect(cookie: string): Promise<TestSocket> {
  const socket = new WebSocket(websocketUrl, {
    headers: {
      Cookie: cookie,
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
    waitFor: async (predicate) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const match = messages.find(predicate);
        if (match) {
          return match;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Expected WebSocket message was not received. Saw: ${messages.map((message) => message.type).join(', ')}`);
    },
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
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      GOOGLE_ROUTES_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'explore-host@tracklab.test,explore-guest@tracklab.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  sockets.forEach((socket) => socket.close());
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

describe('Explore private multiplayer', () => {
  it('shares one host route and reserves up to four local/remote bike seats', async () => {
    const hostCookie = await register('Explore Host', 'explore-host@tracklab.test');
    const guestCookie = await register('Explore Guest', 'explore-guest@tracklab.test');
    const host = await connect(hostCookie);
    const guest = await connect(guestCookie);

    host.socket.send(JSON.stringify({
      type: 'hello',
      bikeCount: 2,
      track: { id: 'explore', name: 'Explore', country: 'Global', state: 'Route' },
    }));
    guest.socket.send(JSON.stringify({
      type: 'hello',
      bikeCount: 2,
      track: { id: 'explore', name: 'Explore', country: 'Global', state: 'Route' },
    }));
    await host.waitFor((message) => message.type === 'welcome');
    await guest.waitFor((message) => message.type === 'welcome');

    host.socket.send(JSON.stringify({
      type: 'create-room',
      private: true,
      racerSeatCount: 2,
      track: { id: 'explore', name: 'Explore', country: 'Global', state: 'Route' },
    }));
    const created = await host.waitFor((message) => {
      const room = message.room as { memberCount?: number } | undefined;
      return message.type === 'room-state' && room?.memberCount === 1;
    });
    const createdRoom = created.room as {
      id: string;
      racerSeatCount: number;
    };
    expect(createdRoom.racerSeatCount).toBe(2);

    guest.socket.send(JSON.stringify({ type: 'join-room', roomId: createdRoom.id }));
    const joined = await host.waitFor((message) => {
      const room = message.room as { memberCount?: number } | undefined;
      return message.type === 'room-state' && room?.memberCount === 2;
    });
    expect((joined.room as { racerSeatCount: number }).racerSeatCount).toBe(4);

    const route = {
      id: 'EXPLORE-shared-test',
      origin: { lat: 38.5, lng: -120.2 },
      destination: { lat: 43.252, lng: -126.453 },
      originLabel: 'Shared start',
      destinationLabel: 'Shared finish',
      travelMode: 'bicycle',
      distanceMeters: 1_000,
      durationSeconds: 300,
      encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      createdAt: Date.now(),
    };
    host.socket.send(JSON.stringify({ type: 'room-explore-route', route }));

    const routeState = await guest.waitFor((message) => {
      const room = message.room as { exploreRoute?: { id?: string } } | undefined;
      return message.type === 'room-state' && room?.exploreRoute?.id === route.id;
    });
    expect((routeState.room as {
      exploreSession: { status: string };
    }).exploreSession.status).toBe('ready');

    host.socket.send(JSON.stringify({ type: 'room-explore-action', action: 'start' }));
    const ridingState = await guest.waitFor((message) => {
      const room = message.room as { exploreSession?: { status?: string } } | undefined;
      return message.type === 'room-state' && room?.exploreSession?.status === 'riding';
    });
    expect((ridingState.room as {
      exploreSession: { startedAt: number };
    }).exploreSession.startedAt).toBeGreaterThan(Date.now());

    guest.socket.send(JSON.stringify({
      type: 'explore-sync',
      state: {
        routeId: route.id,
        sessionId: 'shared-session',
        riders: [
          {
            id: 'guest:1',
            playerId: 1,
            name: 'Guest One',
            colorName: 'blue',
            accent: '#2388e8',
            distanceMeters: 120,
            velocityMps: 8,
            cadence: 90,
            watts: 400,
            signal: 0.9,
            finishedAt: null,
          },
          {
            id: 'guest:2',
            playerId: 2,
            name: 'Guest Two',
            colorName: 'yellow',
            accent: '#f5b824',
            distanceMeters: 115,
            velocityMps: 7.8,
            cadence: 88,
            watts: 380,
            signal: 0.88,
            finishedAt: null,
          },
        ],
      },
    }));
    const synced = await host.waitFor((message) => {
      const state = message.state as { riders?: unknown[] } | undefined;
      return message.type === 'explore-sync' && state?.riders?.length === 2;
    });
    expect((synced.state as { riders: Array<{ name: string }> }).riders.map((rider) => rider.name))
      .toEqual(['Guest One', 'Guest Two']);
  });
});
