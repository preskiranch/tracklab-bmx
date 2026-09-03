import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';
let serverLog = '';

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
      // The isolated server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Club Event route test server did not start.\n${serverLog}`);
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

function routeVariant(id: 'amateur' | 'pro', startLatitude: number) {
  const centerline = [
    { lat: startLatitude, lng: -122.1 },
    { lat: startLatitude + 0.001, lng: -122.099 },
  ];
  return {
    id,
    name: id === 'pro' ? 'Pro Track' : 'Amateur Track',
    restAfterSeconds: 1,
    lengthMeters: id === 'pro' ? 360 : 320,
    centerline,
    startGate: centerline[0],
    finishLine: centerline[1],
    zones: [],
  };
}

function trackRecord(routeVariants = [
  routeVariant('amateur', 38.1),
  routeVariant('pro', 38.2),
]) {
  const primaryRoute = routeVariants[0];
  return {
    id: 'club-event-dual-route',
    name: 'Club Event Dual Route',
    country: 'United States',
    countryCode: 'US',
    state: 'California',
    region: 'California',
    source: 'TrackLab test',
    sourceUrl: 'https://example.test/club-event-dual-route',
    surface: 'Dirt',
    lengthMeters: primaryRoute.lengthMeters,
    elevationMeters: 4,
    centerline: primaryRoute.centerline,
    outline: [],
    zones: [],
    routeVariants,
    leaderboards: { rpm: [], speed: [] },
  };
}

function eventRequest(routeVariantId: unknown, routeVariants?: ReturnType<typeof routeVariant>[]) {
  return {
    activityType: 'bmx-race',
    configuration: {
      trackId: 'club-event-dual-route',
      trackName: 'Club Event Dual Route',
      trackRecord: trackRecord(routeVariants),
      lapCount: 1,
      routeVariantId,
      raceView: { mode: 'satellite' },
    },
  };
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
      GOOGLE_ROUTES_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'club-route-admin@tracklab.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data) => { serverLog += String(data); });
  child.stderr?.on('data', (data) => { serverLog += String(data); });
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

describe('Club Event Race Intervals route synchronization', () => {
  it('preserves a valid Pro/Amateur route and rejects choices absent from the shared track', async () => {
    const registration = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.210' },
      body: JSON.stringify({
        name: 'Club Route Admin',
        email: 'club-route-admin@tracklab.test',
        password: 'club-route-correct-horse-battery-staple',
      }),
    });
    expect(registration.status).toBe(201);
    const cookie = String(registration.headers.get('set-cookie')).split(';')[0];
    const headers = { Cookie: cookie };

    const proResponse = await api('/api/club-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(eventRequest('pro')),
    });
    expect(proResponse.status).toBe(201);
    await expect(proResponse.json()).resolves.toMatchObject({
      event: {
        activityType: 'bmx-race',
        configuration: {
          trackId: 'club-event-dual-route',
          routeVariantId: 'pro',
        },
      },
    });

    const amateurResponse = await api('/api/club-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(eventRequest('amateur')),
    });
    expect(amateurResponse.status).toBe(201);
    await expect(amateurResponse.json()).resolves.toMatchObject({
      event: { configuration: { routeVariantId: 'amateur' } },
    });

    const noRouteResponse = await api('/api/club-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(eventRequest(null)),
    });
    expect(noRouteResponse.status).toBe(201);
    await expect(noRouteResponse.json()).resolves.toMatchObject({
      event: { configuration: { routeVariantId: null } },
    });

    const missingProResponse = await api('/api/club-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(eventRequest('pro', [routeVariant('amateur', 38.1)])),
    });
    expect(missingProResponse.status).toBe(400);

    const invalidRouteResponse = await api('/api/club-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(eventRequest('expert')),
    });
    expect(invalidRouteResponse.status).toBe(400);
  });
});
