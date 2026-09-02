import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createOvertureBikeShopCatalog } from '../../cloud/overtureBikeShops.mjs';
import { createBikeShopDirectory } from '../../cloud/bikeShops.mjs';

const gzipAsync = promisify(gzip);
const catalogFormat = 'tracklab-overture-bike-shop-ndjson-v1';

async function encodedCatalog(shops: unknown[][], overrides: Record<string, unknown> = {}) {
  const metadata = {
    schemaVersion: 2,
    format: catalogFormat,
    release: '2026-08-19.0',
    generatedAt: '2026-09-01T00:00:00.000Z',
    minimumConfidence: 0.7,
    recordCount: shops.length,
    catalogSha256: createHash('sha256').update(JSON.stringify(shops)).digest('hex'),
    license: 'Overture Maps data',
    ...overrides,
  };
  return gzipAsync(`${[metadata, ...shops].map((record) => JSON.stringify(record)).join('\n')}\n`);
}

describe('preloaded Overture bike shop catalog', () => {
  it('searches, browses, resolves, and builds the global country hierarchy from one pinned artifact', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tracklab-bike-shops-'));
    const artifactPath = path.join(directory, 'catalog.json.gz');
    const rayId = '11111111-1111-4111-8111-111111111111';
    const precisionId = '22222222-2222-4222-8222-222222222222';
    const shops = [
      [rayId, "Ray's Cycle", 38.356, -121.987, '400 Main St, Vacaville', 'Vacaville', 'California', '95688', 'US', 'https://rays.example/', '555-0100', 'bike_store', 0.91, ['meta|CDLA-Permissive-2.0|meta|2026-08-01T00:00:00Z', 'fsq|Apache-2.0|foursquare|2026-08-02T00:00:00Z']],
      [precisionId, 'Precision Bicycle', 38.359, -121.981, '', 'Vacaville', 'California', '95688', 'US', '', '', 'bike_repair_maintenance', 0.84],
      ['33333333-3333-4333-8333-333333333333', 'Toronto Bikes', 43.65, -79.38, '', 'Toronto', 'Ontario', '', 'CA', '', '', 'bike_store', 0.8],
      ['44444444-4444-4444-8444-444444444444', 'Unlocated Region Bikes', 1.29, 103.85, '', 'Singapore', '', '', 'SG', '', '', 'bike_store', 0.81],
    ];
    await writeFile(artifactPath, await encodedCatalog(shops));

    try {
      const catalog = createOvertureBikeShopCatalog({ artifactUrl: artifactPath });
      const nearby = await catalog.search({ latitude: 38.35, longitude: -121.99, radiusMiles: 5 });
      expect(nearby.map((shop: any) => shop.name)).toEqual(["Ray's Cycle", 'Precision Bicycle']);
      expect(nearby[0]).toMatchObject({
        id: `overture:${rayId}`,
        address: { formatted: '400 Main St, Vacaville, California, 95688' },
        source: {
          provider: 'Overture Maps',
          elementType: 'place',
          elementId: rayId,
          provenance: ['Overture Maps', 'Foursquare', 'Meta'],
          catalogProvenance: ['fsq|Apache-2.0|foursquare|2026-08-02T00:00:00Z', 'meta|CDLA-Permissive-2.0|meta|2026-08-01T00:00:00Z'],
        },
      });
      expect(await catalog.searchViewport({ north: 38.4, south: 38.3, west: -122, east: -121.9 }))
        .toHaveLength(2);
      expect(await catalog.resolve(rayId)).toMatchObject({ name: "Ray's Cycle" });
      expect(await catalog.hierarchy()).toMatchObject({
        level: 'country',
        items: [{ value: 'CA', count: 1 }, { value: 'SG', count: 1 }, { value: 'US', count: 2 }],
      });
      expect(await catalog.hierarchy({ countryCode: 'US' })).toMatchObject({
        level: 'region', items: [{ value: 'California', count: 2 }],
      });
      expect(await catalog.hierarchy({ countryCode: 'US', region: 'California' })).toMatchObject({
        level: 'city', items: [{ value: 'Vacaville', count: 2 }],
      });
      expect(await catalog.hierarchy({ countryCode: 'SG' })).toMatchObject({
        level: 'region', items: [{ value: '__region-not-listed__', count: 1 }],
      });
      expect(await catalog.hierarchy({ countryCode: 'SG', region: '__region-not-listed__' }))
        .toMatchObject({ level: 'city', items: [{ value: 'Singapore', count: 1 }] });
      expect(await catalog.browse({ countryCode: 'US', region: 'California', locality: 'Vacaville' }))
        .toMatchObject({
          total: 2,
          truncated: false,
          shops: [{ name: 'Precision Bicycle' }, { name: "Ray's Cycle" }],
        });
      expect(await catalog.stats()).toMatchObject({ count: 4, release: '2026-08-19.0' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects null coordinates instead of coercing them to zero', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tracklab-bike-shops-invalid-'));
    const artifactPath = path.join(directory, 'catalog.json.gz');
    const shops = [[
      '55555555-5555-4555-8555-555555555555',
      'Invalid Coordinate Bikes',
      null,
      -121.98,
      '',
      'Vacaville',
      'California',
      '',
      'US',
      '',
      '',
      'bike_store',
      0.8,
    ]];
    await writeFile(artifactPath, await encodedCatalog(shops));
    try {
      const catalog = createOvertureBikeShopCatalog({ artifactUrl: artifactPath });
      await expect(catalog.stats()).rejects.toThrow('contains invalid records');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns compact city bounds across the antimeridian', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tracklab-bike-shops-dateline-'));
    const artifactPath = path.join(directory, 'catalog.json.gz');
    const shops = [
      ['66666666-6666-4666-8666-666666666666', 'West Dateline Bikes', 1, 179.5, '', 'Dateline', 'Province', '', 'FJ', '', '', 'bike_store', 0.8],
      ['77777777-7777-4777-8777-777777777777', 'East Dateline Bikes', 1.1, -179.5, '', 'Dateline', 'Province', '', 'FJ', '', '', 'bike_store', 0.8],
    ];
    await writeFile(artifactPath, await encodedCatalog(shops));
    try {
      const catalog = createOvertureBikeShopCatalog({ artifactUrl: artifactPath });
      const result = await catalog.browse({
        countryCode: 'FJ',
        region: 'Province',
        locality: 'Dateline',
      });
      expect(result.bounds).toEqual({ north: 1.1, south: 1, west: 179.5, east: -179.5 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the complete worldwide hierarchy browseable at country and region level', async () => {
    const catalog = createOvertureBikeShopCatalog();
    const australia = await catalog.browse({ countryCode: 'AU' });
    expect(australia.total).toBeGreaterThan(0);
    expect(australia.shops.length).toBeLessThanOrEqual(500);
    expect(australia.shops.every((shop) => shop.address.countryCode === 'AU')).toBe(true);
    expect(australia.truncated).toBe(australia.total > australia.shops.length);

    const regions = await catalog.hierarchy({ countryCode: 'AU' });
    expect(regions.items.some(({ value, count }) => value === 'NSW' && count > 0)).toBe(true);
    const newSouthWales = await catalog.browse({ countryCode: 'AU', region: 'NSW' });
    expect(newSouthWales.total).toBeGreaterThan(0);
    expect(newSouthWales.truncated).toBe(false);
    expect(newSouthWales.shops.every((shop) => (
      shop.address.countryCode === 'AU' && shop.address.region === 'NSW'
    ))).toBe(true);

    const nextPage = await catalog.browse({ countryCode: 'AU', offset: 500 });
    expect(nextPage.offset).toBe(500);
    expect(nextPage.shops[0]?.address.countryCode).toBe('AU');
    expect(nextPage.shops.every((shop) => shop.address.countryCode === 'AU')).toBe(true);
  });

  it('propagates a dense real-catalog viewport as truncated through the public directory', async () => {
    const catalog = createOvertureBikeShopCatalog();
    const directory = createBikeShopDirectory({
      fetchImpl: async () => new Response(JSON.stringify({ elements: [] }), { status: 200 }),
      loadViewport: (viewport: Record<string, number>) => catalog.searchViewport(viewport),
      catalogLiveWaitMs: 2_000,
    });
    const result = await directory.searchViewport({
      north: 41,
      south: 40.4,
      west: -74.3,
      east: -73.5,
      zoom: 11,
    });
    expect(result.shops).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
});
