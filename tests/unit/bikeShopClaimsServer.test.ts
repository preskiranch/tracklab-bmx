import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let overpassServer: HttpServer;
let baseUrl = '';
let ownerCookie = '';
let otherCookie = '';
let adminCookie = '';

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address && typeof address === 'object' ? address.port : 0));
    });
  });
}

async function request(pathname: string, options: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
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

async function register(email: string, name: string) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { email, name, password: 'bike-shop-claim-test-password' },
  });
  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

const validClaim = {
  shop: {
    id: 'osm:node:123456789',
    name: 'Caller Supplied Wrong Name',
    latitude: 0,
    longitude: 0,
    website: 'https://caller-supplied.invalid',
  },
  claimantRole: 'owner',
  verificationMethod: 'business-email',
  businessEmail: 'owner@neighborhood.example',
};

beforeAll(async () => {
  const overpassPort = await availablePort();
  overpassServer = createHttpServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const query = new URLSearchParams(body).get('data') || '';
      const match = /\b(node|way|relation)\(([1-9][0-9]*)\)/u.exec(query);
      const canonical = match?.[1] === 'node' && match[2] === '123456789'
        ? {
          type: 'node', id: 123456789, lat: 38.356, lon: -121.987,
          tags: {
            shop: 'bicycle', name: 'Neighborhood Bikes',
            'addr:housenumber': '12', 'addr:street': 'Main St',
            'addr:city': 'Vacaville', 'addr:state': 'CA',
          },
        }
        : match?.[1] === 'way' && match[2] === '987654321'
          ? {
            type: 'way', id: 987654321, center: { lat: 38.4, lon: -121.8 },
            tags: {
              shop: 'bicycle', name: 'Review Queue Bikes',
              website: 'https://review-queue.example',
            },
          }
          : null;
      const payload = JSON.stringify({ elements: canonical ? [canonical] : [] });
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      response.end(payload);
    });
  });
  await new Promise<void>((resolve, reject) => {
    overpassServer.once('error', reject);
    overpassServer.listen(overpassPort, '127.0.0.1', resolve);
  });
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      TRACKLAB_ADMIN_EMAILS: 'bike-shop-admin@example.com',
      TRACKLAB_OVERPASS_ENDPOINT: `http://127.0.0.1:${overpassPort}/api/interpreter`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) break;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  ownerCookie = await register('shop-owner@example.com', 'Shop Owner');
  otherCookie = await register('other-rider@example.com', 'Other Rider');
  adminCookie = await register('bike-shop-admin@example.com', 'Directory Admin');
}, 25_000);

afterAll(async () => {
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
  if (overpassServer) await new Promise<void>((resolve) => overpassServer.close(() => resolve()));
});

describe('moderated bike shop claims API', () => {
  it('preserves bounded JSON request errors on the public nearby endpoint', async () => {
    const invalidJson = await fetch(`${baseUrl}/api/bike-shops/nearby`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({ error: 'Request body must be valid JSON.' });

    const oversized = await request('/api/bike-shops/nearby', {
      method: 'POST',
      body: { padding: 'x'.repeat(3_000) },
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: 'Request body is too large.' });
  });

  it('requires a personal account and validates verification evidence', async () => {
    expect((await request('/api/bike-shops/claim-requests')).status).toBe(401);
    expect((await request('/api/bike-shops/claim-requests', {
      cookie: ownerCookie,
      headers: { 'X-TrackLab-Club-Tablet-Session': 'presented-device-credential' },
    })).status).toBe(403);
    const invalid = await request('/api/bike-shops/claim-requests', {
      method: 'POST', cookie: ownerCookie, body: { ...validClaim, businessEmail: 'not-an-email' },
    });
    expect(invalid.status).toBe(400);
  });

  it('creates only a private pending request, lists mine, and rejects a duplicate', async () => {
    const created = await request('/api/bike-shops/claim-requests', {
      method: 'POST', cookie: ownerCookie, body: validClaim,
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as any;
    expect(createdBody.claim).toMatchObject({ status: 'pending', shopName: 'Neighborhood Bikes' });
    expect(createdBody.claim).toMatchObject({
      latitude: 38.356,
      longitude: -121.987,
      shopSnapshot: {
        id: 'osm:node:123456789',
        source: { url: 'https://www.openstreetmap.org/node/123456789' },
      },
    });
    expect(createdBody.claim).not.toHaveProperty('claimantUserId');
    expect(createdBody.claim).not.toHaveProperty('reviewerUserId');

    const listed = await request('/api/bike-shops/claim-requests', { cookie: ownerCookie });
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).claims).toHaveLength(1);
    expect((await request('/api/bike-shops/claim-requests', {
      method: 'POST', cookie: ownerCookie, body: validClaim,
    })).status).toBe(409);

    expect((await request(`/api/bike-shops/claim-requests/${createdBody.claim.id}`, {
      method: 'DELETE', cookie: otherCookie,
    })).status).toBe(404);
    expect((await request(`/api/bike-shops/claim-requests/${createdBody.claim.id}`, {
      method: 'DELETE', cookie: ownerCookie,
    })).status).toBe(204);
    expect((await request('/api/bike-shops/claim-requests', { cookie: ownerCookie }).then((response) => response.json()) as any).claims).toMatchObject([
      { id: createdBody.claim.id, status: 'withdrawn' },
    ]);
  });

  it('provides a private admin queue, records one final decision, and returns it to the claimant', async () => {
    const reviewClaim = {
      ...validClaim,
      shop: { ...validClaim.shop, id: 'osm:way:987654321', name: 'Review Queue Bikes' },
      businessEmail: 'manager@review-queue.example',
    };
    const created = await request('/api/bike-shops/claim-requests', {
      method: 'POST', cookie: otherCookie, body: reviewClaim,
    });
    expect(created.status).toBe(201);
    const claimId = String((await created.json() as any).claim.id);

    expect((await request('/api/admin/bike-shop-claims')).status).toBe(401);
    expect((await request('/api/admin/bike-shop-claims', { cookie: ownerCookie })).status).toBe(403);
    expect((await request('/api/admin/bike-shop-claims?status=invalid', { cookie: adminCookie })).status).toBe(400);
    const queueResponse = await request('/api/admin/bike-shop-claims?status=pending', { cookie: adminCookie });
    expect(queueResponse.status).toBe(200);
    expect(queueResponse.headers.get('cache-control')).toContain('no-store');
    const queueBody = await queueResponse.json() as any;
    expect(queueBody).toMatchObject({
      status: 'pending',
      items: [expect.objectContaining({
        id: claimId,
        claimant: { displayName: 'Other Rider', email: 'other-rider@example.com' },
        businessEmail: 'manager@review-queue.example',
      })],
    });
    expect(queueBody.items[0].shopSnapshot).toMatchObject({
      id: 'osm:way:987654321',
      website: 'https://review-queue.example',
      source: { url: 'https://www.openstreetmap.org/way/987654321' },
    });

    expect((await request(`/api/admin/bike-shop-claims/${claimId}`, {
      method: 'PATCH', cookie: adminCookie, body: { decision: 'approved', reviewNote: '' },
    })).status).toBe(400);
    const reviewed = await request(`/api/admin/bike-shop-claims/${claimId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { decision: 'approved', reviewNote: 'Verified against the business email.' },
    });
    expect(reviewed.status).toBe(200);
    const reviewedBody = await reviewed.json() as any;
    expect(reviewedBody.claim).toMatchObject({
      id: claimId,
      status: 'approved',
      reviewNote: 'Verified against the business email.',
      reviewedAt: expect.any(String),
    });
    expect(reviewedBody.claim).not.toHaveProperty('reviewerUserId');
    expect((await request(`/api/admin/bike-shop-claims/${claimId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { decision: 'rejected', reviewNote: 'Attempted overwrite.' },
    })).status).toBe(409);

    const mine = await request('/api/bike-shops/claim-requests', { cookie: otherCookie });
    expect(await mine.json()).toMatchObject({
      claims: [expect.objectContaining({
        id: claimId,
        status: 'approved',
        reviewNote: 'Verified against the business email.',
      })],
    });
  });
});
