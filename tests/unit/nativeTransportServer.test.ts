import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const capacitorOrigin = 'capacitor://localhost';
let child: ChildProcess;
let baseUrl = '';
let childError = '';
const sockets = new Set<WebSocket>();

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
      // The child can still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Native transport test server did not start. ${childError}`);
}

function nativeHeaders(token = '', extras: HeadersInit = {}) {
  return {
    Origin: capacitorOrigin,
    'Sec-Fetch-Site': 'cross-site',
    'X-TrackLab-Native-Session': '1',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extras,
  };
}

async function openTicketSocket(ticket: string) {
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/u, 'ws')}/multiplayer?authTicket=${encodeURIComponent(ticket)}`,
    { headers: { Origin: capacitorOrigin } },
  );
  sockets.add(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function expectTicketRejected(ticket: string) {
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/u, 'ws')}/multiplayer?authTicket=${encodeURIComponent(ticket)}`,
    { headers: { Origin: capacitorOrigin } },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => reject(new Error('A consumed or revoked auth ticket was accepted.')));
    socket.once('unexpected-response', (_request, response) => {
      expect(response.statusCode).toBe(401);
      response.resume();
      resolve();
    });
    socket.once('error', () => resolve());
  });
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
      TRACKLAB_AUTH_WS_TICKET_TTL_MS: '2000',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    childError = `${childError}${String(chunk)}`.slice(-8_000);
  });
  await waitForHealth();
}, 25_000);

afterAll(async () => {
  sockets.forEach((socket) => socket.terminate());
  sockets.clear();
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

describe('bundled native service boundary', () => {
  it('allows only the exact Capacitor CORS preflight contract', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: capacitorOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, x-tracklab-native-session',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(capacitorOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();

    const rejected = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: capacitorOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, x-tracklab-secret',
      },
    });
    expect(rejected.status).toBe(403);
  });

  it('uses device-only Bearer auth, one-use scoped sockets, and session-bound streams', async () => {
    const email = `native-${Date.now()}@tracklab.test`;
    const password = 'native-correct-horse-battery-staple';
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: nativeHeaders('', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'Native Rider', email, password }),
    });
    expect(registration.status).toBe(201);
    expect(registration.headers.get('set-cookie')).toBeNull();
    expect(registration.headers.get('access-control-allow-origin')).toBe(capacitorOrigin);
    const registered = await registration.json() as Record<string, any>;
    expect(registered.user).toMatchObject({ email });
    expect(registered.nativeSessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const nativeToken = String(registered.nativeSessionToken);

    const nativeMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: nativeHeaders(nativeToken),
    });
    await expect(nativeMe.json()).resolves.toMatchObject({ user: { email } });

    // Authorization is not a generic browser-session escape hatch. The exact
    // native origin and explicit marker are both required.
    const browserBearer = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: baseUrl, Authorization: `Bearer ${nativeToken}` },
    });
    await expect(browserBearer.json()).resolves.toEqual({ user: null });

    const browserLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(browserLogin.status).toBe(200);
    expect(browserLogin.headers.get('set-cookie')).toContain('tracklab_session=');
    const browserPayload = await browserLogin.json() as Record<string, unknown>;
    expect(browserPayload).not.toHaveProperty('nativeSessionToken');
    const browserCookie = String(browserLogin.headers.get('set-cookie')).split(';')[0];

    const createTicket = async (scope: 'multiplayer' | 'live-audio') => {
      const response = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
        method: 'POST',
        headers: nativeHeaders(nativeToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ scope }),
      });
      expect(response.status).toBe(201);
      return response.json() as Promise<{ ticket: string; expiresAt: number }>;
    };

    const multiplayerTicket = await createTicket('multiplayer');
    const multiplayerSocket = await openTicketSocket(multiplayerTicket.ticket);
    multiplayerSocket.close();
    await new Promise<void>((resolve) => multiplayerSocket.once('close', () => resolve()));
    sockets.delete(multiplayerSocket);
    await expectTicketRejected(multiplayerTicket.ticket);

    const liveTicket = await createTicket('live-audio');
    const liveSocket = await openTicketSocket(liveTicket.ticket);
    liveSocket.send(JSON.stringify({ type: 'hello', available: false, bikeCount: 0 }));
    const liveMessages: Array<Record<string, unknown>> = [];
    liveSocket.on('message', (data) => {
      try {
        liveMessages.push(JSON.parse(data.toString()));
      } catch {
        // Protocol assertions inspect JSON only.
      }
    });
    const welcomeDeadline = Date.now() + 2_000;
    while (!liveMessages.some((message) => message.type === 'welcome') && Date.now() < welcomeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(liveMessages.some((message) => message.type === 'welcome')).toBe(true);
    const closeCode = new Promise<number>((resolve) => liveSocket.once('close', resolve));
    liveSocket.send(JSON.stringify({ type: 'create-room', private: true }));
    await expect(closeCode).resolves.toBe(1008);
    sockets.delete(liveSocket);

    const stream = await fetch(`${baseUrl}/api/training-sessions/stream`, {
      headers: nativeHeaders(nativeToken, { Accept: 'text/event-stream' }),
    });
    expect(stream.status).toBe(200);
    const streamReader = stream.body?.getReader();
    expect(streamReader).toBeDefined();
    const firstChunk = await streamReader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain('event: ready');

    const pendingTicket = await createTicket('multiplayer');
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: nativeHeaders(nativeToken),
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toBeNull();
    await expectTicketRejected(pendingTicket.ticket);
    await expect(Promise.race([
      streamReader!.read(),
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('Training stream survived native logout.')),
        2_000,
      )),
    ])).resolves.toMatchObject({ done: true });

    const signedOutNative = await fetch(`${baseUrl}/api/auth/me`, {
      headers: nativeHeaders(nativeToken),
    });
    await expect(signedOutNative.json()).resolves.toEqual({ user: null });

    // Browser auth remains an independent HttpOnly-cookie session.
    const browserMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Origin: baseUrl, Cookie: browserCookie },
    });
    await expect(browserMe.json()).resolves.toMatchObject({ user: { email } });
  }, 20_000);
});
