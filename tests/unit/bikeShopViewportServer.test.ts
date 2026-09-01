import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let child: ChildProcess;
let overpassServer: HttpServer;
let baseUrl = '';
let overpassUrls: string[] = [];

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error
        ? reject(error)
        : resolve(address && typeof address === 'object' ? address.port : 0));
    });
  });
}

async function request(
  pathname: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) {
  return fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Origin: baseUrl,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function register(email: string, name: string) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    body: { email, name, password: 'bike-shop-viewport-test-password' },
  });
  expect(response.status).toBe(201);
  return String(response.headers.get('set-cookie')).split(';')[0];
}

const viewport = {
  north: 38.4,
  south: 38.3,
  east: -121.9,
  west: -122,
  zoom: 14,
};

beforeAll(async () => {
  const overpassPort = await availablePort();
  overpassUrls = [];
  overpassServer = createHttpServer((incoming, response) => {
    overpassUrls.push(String(incoming.url || ''));
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk) => { body += chunk; });
    incoming.on('end', () => {
      const query = new URLSearchParams(body).get('data') || '';
      const canonical = /\bnode\(7001\)/u.test(query);
      const elements = canonical ? [{
        type: 'node', id: 7001, lat: 38.35, lon: -121.95,
        tags: { shop: 'bicycle', name: 'Viewport Bicycle Works' },
      }] : [{
        type: 'node', id: 7001, lat: 38.35, lon: -121.95,
        tags: { shop: 'bicycle', name: 'Viewport Bicycle Works' },
      }, {
        type: 'node', id: 7002, lat: 38.35, lon: -121.89,
        tags: { shop: 'bicycle', name: 'Outside Bicycle Works' },
      }];
      const payload = JSON.stringify({ elements });
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
      TRACKLAB_ADMIN_EMAILS: 'viewport-admin@example.com',
      TRACKLAB_OVERPASS_ENDPOINT: `http://127.0.0.1:${overpassPort}/api/interpreter`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (!ready) throw new Error('TrackLab test server did not start.');
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

describe('public bike shop viewport API', () => {
  it('serves a public data-attribution page and the complete bundled license texts', async () => {
    const page = await request('/legal/bike-shop-directory-data');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const markup = await page.text();
    expect(markup).toContain('Global Bike Shop Directory data and licenses');
    expect(markup).toContain('September 1, 2026');
    expect(markup).toContain('/legal/bike-shop-directory-data/cdla-permissive-2.0.txt');
    const cdla = await request('/legal/bike-shop-directory-data/cdla-permissive-2.0.txt');
    expect(cdla.status).toBe(200);
    expect(cdla.headers.get('content-type')).toContain('text/plain');
    expect(await cdla.text()).toContain('Community Data License Agreement - Permissive - Version 2.0');
    const apache = await request('/legal/bike-shop-directory-data/apache-2.0.txt');
    expect(await apache.text()).toContain('Apache License');
    const foursquare = await request('/legal/bike-shop-directory-data/foursquare-notice.txt');
    expect(await foursquare.text()).toContain('TrackLab further filtered');
  });

  it('uses a bounded body-only contract with exact post-filtering and private responses', async () => {
    expect((await request('/api/bike-shops/viewport')).status).toBe(405);
    expect((await request('/api/bike-shops/viewport?north=38.4', {
      method: 'POST', body: viewport,
    })).status).toBe(400);
    expect((await request('/api/bike-shops/viewport', {
      method: 'POST', body: { ...viewport, zoom: 10 },
    })).status).toBe(400);
    expect((await request('/api/bike-shops/viewport', {
      method: 'POST', body: { ...viewport, padding: 'x'.repeat(1_200) },
    })).status).toBe(413);

    const response = await request('/api/bike-shops/viewport', { method: 'POST', body: viewport });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('ratelimit-limit')).toBe('60');
    const body = await response.json() as any;
    expect(Object.keys(body).sort()).toEqual(['attribution', 'attributions', 'bounds', 'shops', 'truncated']);
    expect(body).toMatchObject({
      bounds: viewport,
      truncated: false,
      attribution: { text: '© OpenStreetMap contributors', license: 'ODbL' },
    });
    expect(body.shops).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'osm:node:7001', claimed: false }),
    ]));
    expect(body).not.toHaveProperty('cache');
    expect(body).not.toHaveProperty('fetchedAt');
    expect(overpassUrls).toEqual(['/api/interpreter']);
  });

  it('overlays only the approved claim badge on the cached public viewport', async () => {
    const ownerCookie = await register('viewport-owner@example.com', 'Viewport Owner');
    const adminCookie = await register('viewport-admin@example.com', 'Viewport Admin');
    const created = await request('/api/bike-shops/claim-requests', {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        shop: { id: 'osm:node:7001', name: 'Caller Name Must Not Win' },
        claimantRole: 'owner',
        verificationMethod: 'business-email',
        businessEmail: 'owner@viewport.example',
      },
    });
    expect(created.status).toBe(201);
    const claimId = String((await created.json() as any).claim.id);
    const approved = await request(`/api/admin/bike-shop-claims/${claimId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { decision: 'approved', reviewNote: 'Business identity verified.' },
    });
    expect(approved.status).toBe(200);

    const response = await request('/api/bike-shops/viewport', { method: 'POST', body: viewport });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.shops).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'osm:node:7001', claimed: true }),
    ]));
    expect(JSON.stringify(body)).not.toContain('owner@viewport.example');
    expect(JSON.stringify(body)).not.toContain('Business identity verified');
    expect(overpassUrls).toEqual(['/api/interpreter', '/api/interpreter']);
  });
});
