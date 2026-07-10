import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';
let temporaryHome = '';
const tracklabOrigin = 'https://tracklab-bmx.onrender.com';

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

async function waitForConnector() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/bridge/status`, { headers: { Origin: tracklabOrigin } });
      if (response.ok) {
        return;
      }
    } catch {
      // Connector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Local connector test server did not start.');
}

beforeAll(async () => {
  temporaryHome = await mkdtemp(path.join(tmpdir(), 'tracklab-connector-'));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['bridge/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: temporaryHome,
      WATTBIKE_BRIDGE_PORT: String(port),
      WATTBIKE_INPUT: 'sim',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForConnector();
});

afterAll(async () => {
  if (child?.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  await rm(temporaryHome, { recursive: true, force: true });
});

function connectorRequest(pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: tracklabOrigin,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

describe('local connector persistence', () => {
  it('rejects unapproved website origins', async () => {
    const response = await fetch(`${baseUrl}/api/bridge/status`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(response.status).toBe(403);
  });

  it('preserves every field across concurrent partial updates', async () => {
    const responses = await Promise.all([
      connectorRequest('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({ bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }] }),
      }),
      connectorRequest('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({ customRoutes: [{ id: 'route-one', name: 'Route One' }] }),
      }),
      connectorRequest('/api/user-data', {
        method: 'PATCH',
        body: JSON.stringify({ trackMappings: { 'track-one': { trackId: 'track-one' } } }),
      }),
    ]);
    expect(responses.every((response) => response.ok)).toBe(true);

    const loaded = await connectorRequest('/api/user-data');
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }],
      customRoutes: [{ id: 'route-one', name: 'Route One' }],
      trackMappings: { 'track-one': { trackId: 'track-one' } },
    });
  });

  it('classifies malformed and oversized profile requests', async () => {
    const malformed = await connectorRequest('/api/user-data', {
      method: 'PATCH',
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ message: 'Request body must be valid JSON.' });

    const oversized = await connectorRequest('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ value: 'x'.repeat(2_000_001) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ message: 'Request body is too large.' });
  });
});
