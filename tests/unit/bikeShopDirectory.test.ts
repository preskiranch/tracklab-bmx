import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedBikeShopClaims,
  createBikeShopDirectory,
  normalizeOverpassBikeShops,
  parseBikeShopClaimRequest,
  parseBikeShopSearch,
} from '../../cloud/bikeShops.mjs';

describe('bike shop directory backend', () => {
  it('accepts only valid coordinates and a five-to-fifty-mile radius', () => {
    expect(parseBikeShopSearch({ lat: '38.3', lng: '-121.9', radiusMiles: '25' })).toEqual({
      latitude: 38.3,
      longitude: -121.9,
      radiusMiles: 25,
    });
    expect(() => parseBikeShopSearch({ lat: '91', lng: '0', radiusMiles: '5' })).toThrow(/latitude/);
    expect(() => parseBikeShopSearch({ lng: '0', radiusMiles: '5' })).toThrow(/latitude/);
    expect(() => parseBikeShopSearch({ lat: '0', lng: '0', radiusMiles: '4.9' })).toThrow(/radiusMiles/);
    expect(() => parseBikeShopSearch({ lat: '0', lng: '0', radiusMiles: '12' })).toThrow(/radiusMiles/);
    expect(() => parseBikeShopSearch({ lat: '0', lng: '0', radiusMiles: '51' })).toThrow(/radiusMiles/);
  });

  it('normalizes nodes and ways, sorts by distance, and bounds the result set', () => {
    const shops = normalizeOverpassBikeShops({
      elements: [{
        type: 'way',
        id: 12,
        center: { lat: 38.31, lon: -121.91 },
        tags: {
          shop: 'bicycle',
          name: 'Pedal House',
          'addr:housenumber': '12',
          'addr:street': 'Main St',
          'addr:city': 'Vacaville',
          website: 'https://pedal.example',
          'service:bicycle:repair': 'yes',
        },
      }, {
        type: 'node',
        id: 9,
        lat: 38.3001,
        lon: -121.9001,
        tags: { shop: 'bicycle', name: 'Near Bikes' },
      }, {
        type: 'node', id: 'not-an-osm-id', lat: 200, lon: -121, tags: { name: 'Invalid' },
      }],
    }, { latitude: 38.3, longitude: -121.9 }, 1);

    expect(shops).toHaveLength(1);
    expect(shops[0]).toMatchObject({
      id: 'osm:node:9',
      name: 'Near Bikes',
      source: { provider: 'OpenStreetMap', elementId: '9' },
      services: { sales: true },
    });
    expect(shops[0].links.directions).toContain('google.com/maps/dir');
  });

  it('uses a bounded cache for repeated nearby searches and sends a bounded Overpass query', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const query = new URLSearchParams(String(init.body)).get('data') || '';
      expect(query).toContain('[timeout:10]');
      expect(query).toContain('shop');
      expect(query).toContain('around:16094,38.3,-121.9');
      return new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const directory = createBikeShopDirectory({ fetchImpl, now: () => 1_700_000_000_000 });

    const first = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 10 });
    const second = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 10 });

    expect(first).not.toHaveProperty('cache');
    expect(first).not.toHaveProperty('fetchedAt');
    expect(second).not.toHaveProperty('cache');
    expect(second).not.toHaveProperty('fetchedAt');
    expect(first.attribution).toMatchObject({ text: '© OpenStreetMap contributors', license: 'ODbL' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not share an upstream search circle between distinct exact origins', async () => {
    const payload = {
      elements: [{
        type: 'node',
        id: 42,
        lat: 38.300751,
        lon: -121.9,
        tags: { shop: 'bicycle', name: 'Precision Bikes' },
      }, {
        type: 'node',
        id: 44,
        lat: 38.22765,
        lon: -121.9,
        tags: { shop: 'bicycle', name: 'Boundary Bikes' },
      }],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const directory = createBikeShopDirectory({ fetchImpl });
    const firstOrigin = { lat: 38.300001, lng: -121.9, radiusMiles: 5 };
    const secondOrigin = { lat: 38.300049, lng: -121.9, radiusMiles: 5 };
    expect(firstOrigin.lat.toFixed(4)).toBe(secondOrigin.lat.toFixed(4));

    const first = await directory.search(firstOrigin);
    const second = await directory.search(secondOrigin);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.origin).toEqual({ latitude: firstOrigin.lat, longitude: firstOrigin.lng, radiusMiles: 5 });
    expect(second.origin).toEqual({ latitude: secondOrigin.lat, longitude: secondOrigin.lng, radiusMiles: 5 });
    expect(first.shops[0].distanceMiles).toBe(0.1);
    expect(second.shops[0].distanceMiles).toBe(0);
    expect(first.shops.map((shop) => shop.id)).toContain('osm:node:44');
    expect(second.shops.map((shop) => shop.id)).not.toContain('osm:node:44');
  });

  it('coalesces identical in-flight searches', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({
        elements: [{
          type: 'node', id: 43, lat: 38.300751, lon: -121.9,
          tags: { shop: 'bicycle', name: 'In Flight Bikes' },
        }],
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });
    const firstOrigin = { lat: 38.300001, lng: -121.9, radiusMiles: 5 };
    const secondOrigin = { ...firstOrigin };
    const first = directory.search(firstOrigin);
    const second = directory.search(secondOrigin);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.origin.latitude).toBe(firstOrigin.lat);
    expect(secondResult.origin.latitude).toBe(secondOrigin.lat);
    expect(firstResult.shops[0].distanceMiles).toBe(0.1);
    expect(secondResult.shops[0].distanceMiles).toBe(0.1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sorts using exact distance before rounding display miles', () => {
    const shops = normalizeOverpassBikeShops({
      elements: [{
        type: 'node', id: 90, lat: 38.30065, lon: -121.9,
        tags: { shop: 'bicycle', name: 'Farther But Same Display Mile' },
      }, {
        type: 'node', id: 91, lat: 38.30055, lon: -121.9,
        tags: { shop: 'bicycle', name: 'Nearer But Same Display Mile' },
      }],
    }, { latitude: 38.3, longitude: -121.9, radiusMiles: 5 });
    expect(shops.map((shop) => shop.id)).toEqual(['osm:node:91', 'osm:node:90']);
    expect(shops[0].distanceMiles).toBe(shops[1].distanceMiles);
  });

  it('accepts only bounded OpenStreetMap claim evidence', () => {
    const claim = parseBikeShopClaimRequest({
      shop: { id: 'osm:way:99', name: 'Bike Shop', latitude: 1, longitude: 2, services: { repair: true } },
      claimantRole: 'manager',
      verificationMethod: 'business-phone',
      businessPhone: '+1 555 555 0100',
    });
    expect(claim).toMatchObject({ osmElementType: 'way', osmElementId: '99', claimantRole: 'manager' });
    expect(() => parseBikeShopClaimRequest({
      shop: { id: 'google:place:secret', name: 'Shop', latitude: 1, longitude: 2 },
      claimantRole: 'owner', verificationMethod: 'business-email', businessEmail: 'owner@example.com',
    })).toThrow(/OpenStreetMap/);
  });

  it('rehydrates claim identity from the exact canonical OpenStreetMap element', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const query = new URLSearchParams(String(init.body)).get('data') || '';
      expect(query).toContain('way(99)');
      return new Response(JSON.stringify({
        elements: [{
          type: 'way',
          id: 99,
          center: { lat: 38.31, lon: -121.91 },
          tags: {
            shop: 'bicycle',
            name: 'Canonical Pedal House',
            'addr:housenumber': '12',
            'addr:street': 'Main St',
            website: 'https://canonical.example',
          },
        }],
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });
    const parsed = parseBikeShopClaimRequest({
      shop: {
        id: 'osm:way:99',
        name: 'Attacker Supplied Name',
        latitude: 0,
        longitude: 0,
        website: 'https://attacker.example',
      },
      claimantRole: 'owner',
      verificationMethod: 'business-email',
      businessEmail: 'owner@example.com',
    });
    const claim = await directory.resolveClaim(parsed);
    expect(claim).toMatchObject({
      shopName: 'Canonical Pedal House',
      latitude: 38.31,
      longitude: -121.91,
      shopSnapshot: {
        website: 'https://canonical.example',
        source: { url: 'https://www.openstreetmap.org/way/99' },
      },
    });
    expect(JSON.stringify(claim)).not.toContain('Attacker Supplied Name');
    expect(JSON.stringify(claim)).not.toContain('attacker.example');
    await directory.resolveClaim(parsed);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a canonical element that is no longer a bike shop', async () => {
    const directory = createBikeShopDirectory({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        elements: [{ type: 'node', id: 77, lat: 38.3, lon: -121.9, tags: { amenity: 'cafe' } }],
      }), { status: 200 })),
    });
    const parsed = parseBikeShopClaimRequest({
      shop: { id: 'osm:node:77' },
      claimantRole: 'owner',
      verificationMethod: 'business-email',
      businessEmail: 'owner@example.com',
    });
    await expect(directory.resolveClaim(parsed)).rejects.toThrow(/no longer identifies/);
  });

  it('adds only a non-sensitive claimed badge to approved public shops', () => {
    const shops = normalizeOverpassBikeShops({
      elements: [{
        type: 'node', id: 77, lat: 38.3, lon: -121.9,
        tags: { shop: 'bicycle', name: 'Verified Bikes' },
      }],
    }, { latitude: 38.3, longitude: -121.9 });
    const marked = applyApprovedBikeShopClaims(shops, [{
      source: 'openstreetmap',
      osmElementType: 'node',
      osmElementId: '77',
      claimantUserId: 'private-user-id',
      businessEmail: 'private@example.com',
      verificationNote: 'private evidence',
      reviewerUserId: 'private-reviewer',
    }]);
    expect(marked).toMatchObject([{ id: 'osm:node:77', claimed: true }]);
    expect(JSON.stringify(marked)).not.toContain('private');
  });

  it('does not cache an unsuccessful upstream response', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const directory = createBikeShopDirectory({ fetchImpl });
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/failed \(429\)/);
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/failed \(429\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized upstream response before parsing it', async () => {
    const directory = createBikeShopDirectory({
      fetchImpl: async () => new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(3 * 1024 * 1024) },
      }),
    });
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/size limit/);
  });

  it('rejects excess distinct upstream work with a retryable busy error', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const directory = createBikeShopDirectory({
      fetchImpl: vi.fn(async () => {
        await gate;
        return new Response(JSON.stringify({ elements: [] }), { status: 200 });
      }),
    });
    const active = [0, 1, 2, 3].map((offset) => directory.search({
      lat: 38 + offset / 100,
      lng: -121,
      radiusMiles: 5,
    }));
    await expect(directory.search({ lat: 39, lng: -121, radiusMiles: 5 })).rejects.toMatchObject({
      code: 'OVERPASS_BUSY', retryAfterSeconds: 3,
    });
    release();
    await Promise.all(active);
  });
});
