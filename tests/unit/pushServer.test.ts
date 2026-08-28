import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let baseUrl = '';

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

async function waitForServer(origin: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200 || response.status === 503) return response;
    } catch {
      // Child may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Push test server did not bind in time.');
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

async function register(label: string) {
  const email = `push-${label}-${randomUUID()}@example.com`;
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { email, name: `${label} Rider`, password: 'push-test-password' },
  });
  expect(response.status).toBe(201);
  return {
    email,
    cookie: String(response.headers.get('set-cookie')).split(';')[0],
  };
}

async function login(email: string) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'push-test-password' },
  });
  expect(response.status).toBe(200);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

function credential() {
  return randomBytes(32).toString('base64url');
}

function installationBody(installationCredential: string, deviceToken = 'ab'.repeat(32)) {
  return {
    credential: installationCredential,
    deviceToken,
    environment: 'sandbox',
    permissionStatus: 'granted',
    protocolVersion: 1,
    appBuild: '12',
    osVersion: '26.0',
  };
}

describe('personal APNs installation API', () => {
  beforeAll(async () => {
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['cloud/server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        TRACKLAB_REQUIRE_DATABASE: '0',
        TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
        TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY: Buffer.alloc(32, 23).toString('base64'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await waitForServer(baseUrl);
  }, 25_000);

  afterAll(async () => {
    child?.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode != null) resolve();
      else child.once('exit', () => resolve());
    });
  });

  it('requires a personal cookie and rejects Bearer or kiosk/mixed authority', async () => {
    expect((await request('/api/push/preferences')).status).toBe(401);
    const rider = await register('Authority');

    const bearer = await request('/api/push/preferences', {
      cookie: rider.cookie,
      headers: { Authorization: 'Bearer not-a-personal-session' },
    });
    expect(bearer.status).toBe(403);

    const tablet = await request('/api/push/preferences', {
      cookie: rider.cookie,
      headers: { 'X-TrackLab-Club-Tablet-Session': 'not-a-tablet-secret' },
    });
    expect(tablet.status).toBe(403);
  });

  it('returns all four preferences and applies strict atomic partial patches', async () => {
    const rider = await register('Preferences');
    const loaded = await request('/api/push/preferences', { cookie: rider.cookie });
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toEqual({
      preferences: {
        liveAudio: true,
        friendRequests: true,
        friendConnections: true,
        trackShares: true,
      },
    });

    const patched = await request('/api/push/preferences', {
      cookie: rider.cookie,
      method: 'PATCH',
      body: { liveAudio: false, trackShares: false },
    });
    await expect(patched.json()).resolves.toEqual({
      preferences: {
        liveAudio: false,
        friendRequests: true,
        friendConnections: true,
        trackShares: false,
      },
    });
    expect((await request('/api/push/preferences', {
      cookie: rider.cookie,
      method: 'PATCH',
      body: { liveAudio: 'no' },
    })).status).toBe(400);
    expect((await request('/api/push/preferences', {
      cookie: rider.cookie,
      method: 'PATCH',
      body: { presence: true },
    })).status).toBe(400);
  });

  it('sanitizes installation responses and makes owner/credential conflicts generic', async () => {
    const first = await register('InstallFirst');
    const second = await register('InstallSecond');
    const installationId = randomUUID();
    const installationCredential = credential();
    const deviceToken = 'cd'.repeat(32);
    const saved = await request(`/api/push/installations/${installationId}`, {
      cookie: first.cookie,
      method: 'PUT',
      body: installationBody(installationCredential, deviceToken),
    });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    const savedBody = JSON.parse(savedText);
    expect(savedBody).toMatchObject({
      installation: {
        id: installationId,
        environment: 'sandbox',
        permissionStatus: 'granted',
      },
    });
    expect(Object.keys(savedBody.installation).sort()).toEqual([
      'environment', 'id', 'lastSeenAt', 'permissionStatus', 'registeredAt',
    ]);
    expect(savedText).not.toContain(deviceToken);
    expect(savedText).not.toContain(installationCredential);
    expect(savedText).not.toMatch(/fingerprint|cipher|accountId|userId|appBuild|osVersion/iu);

    const conflict = await request(`/api/push/installations/${installationId}`, {
      cookie: second.cookie,
      method: 'PUT',
      body: installationBody(credential(), deviceToken),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'That notification installation is unavailable.' });

    const wrongDelete = await request(`/api/push/installations/${installationId}`, {
      cookie: first.cookie,
      method: 'DELETE',
      body: { credential: credential() },
    });
    expect(wrongDelete.status).toBe(404);
    expect(await wrongDelete.json()).toEqual({ error: 'That notification installation is unavailable.' });

    const removed = await request(`/api/push/installations/${installationId}`, {
      cookie: first.cookie,
      method: 'DELETE',
      body: { credential: installationCredential },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true });
  });

  it('rejects malformed installation fields and releases a token fingerprint on logout cascade', async () => {
    const rider = await register('Logout');
    const deviceToken = 'ef'.repeat(32);
    const firstId = randomUUID();
    expect((await request(`/api/push/installations/${firstId}`, {
      cookie: rider.cookie,
      method: 'PUT',
      body: { ...installationBody(credential(), deviceToken), extra: true },
    })).status).toBe(400);
    expect((await request(`/api/push/installations/${randomUUID()}`, {
      cookie: rider.cookie,
      method: 'PUT',
      body: { ...installationBody(credential(), 'not-hex'), protocolVersion: 2 },
    })).status).toBe(400);

    const firstCredential = credential();
    expect((await request(`/api/push/installations/${firstId}`, {
      cookie: rider.cookie,
      method: 'PUT',
      body: installationBody(firstCredential, deviceToken),
    })).status).toBe(200);
    expect((await request('/api/auth/logout', {
      cookie: rider.cookie,
      method: 'POST',
      body: {},
    })).status).toBe(200);

    const nextCookie = await login(rider.email);
    const rebound = await request(`/api/push/installations/${randomUUID()}`, {
      cookie: nextCookie,
      method: 'PUT',
      body: installationBody(credential(), deviceToken),
    });
    expect(rebound.status).toBe(200);
  });
});

describe('required APNs health configuration', () => {
  it('wakes the bounded outbox at startup, periodically, after saturation, and after coalesced producer kicks', () => {
    const source = readFileSync(new URL('../../cloud/server.mjs', import.meta.url), 'utf8');
    const worker = source.slice(
      source.indexOf('async function dispatchPushOutbox'),
      source.indexOf('function rememberRaceResultKey'),
    );
    expect(source).toContain('persistence.initPersistence().finally(() => {');
    expect(source).toContain('kickPushWorker();');
    expect(source).toContain('kickAppleBillingReconciliation(0);');
    expect(source).toContain('setInterval(kickPushWorker, 5_000)');
    expect(worker).toContain('moreWorkLikely ||= events.length >= 20');
    expect(worker).toContain('moreWorkLikely ||= deliveries.length >= 12');
    expect(worker).toContain('pushWorkerNeedsRerun = true');
    expect(worker).toContain('if (moreWorkLikely || pushWorkerNeedsRerun)');
    expect(worker).toContain('leaseMs: 3 * 60 * 1000');
    expect(worker).toContain('persistence.withCurrentPushDeliveryLease({');
    expect(worker.indexOf('persistence.withCurrentPushDeliveryLease({'))
      .toBeLessThan(worker.indexOf('apnsProvider.send({'));
    const protectedSend = worker.slice(
      worker.indexOf('const protectedDispatch ='),
      worker.indexOf('const result = protectedDispatch.value?.result'),
    );
    expect(protectedSend).toContain('runtimePushEventIsEligible(event)');
    expect(protectedSend).toContain('persistence.pushEventIsEligible(');
    expect(protectedSend.indexOf('persistence.pushEventIsEligible('))
      .toBeLessThan(protectedSend.indexOf('apnsProvider.send({'));
    expect(protectedSend.indexOf('runtimePushEventIsEligible(event)'))
      .toBeGreaterThan(protectedSend.indexOf('persistence.pushEventIsEligible('));
    expect(protectedSend.indexOf('runtimePushEventIsEligible(event)'))
      .toBeLessThan(protectedSend.indexOf('apnsProvider.send({'));
    expect(worker).toContain("state: canRetryAfterOperatorRecovery ? 'pending' : 'dead'");
    expect(worker).toContain('nextAttemptAt: retryAt');
  });

  it('is unready when APNs is explicitly enabled without provider secrets', async () => {
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const processUnderTest = spawn(process.execPath, ['cloud/server.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        TRACKLAB_REQUIRE_DATABASE: '0',
        TRACKLAB_APNS_ENABLED: '1',
        TRACKLAB_APNS_TEAM_ID: '',
        TRACKLAB_APNS_KEY_ID: '',
        TRACKLAB_APNS_PRIVATE_KEY: '',
        TRACKLAB_APNS_PRIVATE_KEY_PATH: '',
        TRACKLAB_PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64'),
        TRACKLAB_PUSH_TOKEN_FINGERPRINT_KEY: Buffer.alloc(32, 23).toString('base64'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      const response = await waitForServer(origin);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: 'unavailable',
        push: { enabled: true, ready: false, degraded: true, reason: 'apns-provider-not-configured' },
      });
    } finally {
      processUnderTest.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (processUnderTest.exitCode != null) resolve();
        else processUnderTest.once('exit', () => resolve());
      });
    }
  }, 25_000);
});
