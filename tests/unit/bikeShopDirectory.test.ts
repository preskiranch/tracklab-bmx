import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedBikeShopClaims,
  applyApprovedBikeShopClaimsBestEffort,
  bikeShopClaimIdentities,
  bikeShopSearchLimits,
  createBikeShopDirectory,
  normalizeOverpassBikeShops,
  parseBikeShopClaimRequest,
  parseBikeShopSearch,
  parseBikeShopViewport,
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

  it('accepts only bounded Web Mercator viewports and strict numeric zooms', () => {
    expect(parseBikeShopViewport({
      north: 39,
      south: 38,
      west: -122,
      east: -121,
      zoom: 11.5,
    })).toEqual({ north: 39, south: 38, west: -122, east: -121, zoom: 11.5 });
    expect(parseBikeShopViewport({
      north: 10,
      south: 9,
      west: 179.5,
      east: -179.5,
      zoom: 11,
    })).toEqual({ north: 10, south: 9, west: 179.5, east: -179.5, zoom: 11 });
    expect(() => parseBikeShopViewport({
      north: '39', south: 38, west: -122, east: -121, zoom: 11,
    })).toThrow(/north and south/);
    expect(() => parseBikeShopViewport({
      north: 86, south: 84, west: -122, east: -121, zoom: 11,
    })).toThrow(/Web Mercator/);
    expect(() => parseBikeShopViewport({
      north: 38, south: 39, west: -122, east: -121, zoom: 11,
    })).toThrow(/latitude span/);
    expect(() => parseBikeShopViewport({
      north: 39, south: 38, west: -122, east: -122, zoom: 11,
    })).toThrow(/longitude span/);
    expect(() => parseBikeShopViewport({
      north: 39, south: 38, west: 180, east: -180, zoom: 11,
    })).toThrow(/too large/);
    expect(() => parseBikeShopViewport({
      north: 39, south: 38, west: -122, east: -121, zoom: 7,
    })).toThrow(/zoom/);
    expect(() => parseBikeShopViewport({
      north: 39, south: 38, west: -122, east: -121, zoom: '10',
    })).toThrow(/zoom/);
    expect(() => parseBikeShopViewport({
      north: 3, south: 0, west: 0, east: 1, zoom: 11,
    })).toThrow(/too large/);
    expect(() => parseBikeShopViewport({
      north: 1, south: 0, west: 0, east: 4, zoom: 11,
    })).toThrow(/too large/);
    expect(() => parseBikeShopViewport({
      north: 1.9, south: 0, west: 0, east: 2.5, zoom: 11,
    })).toThrow(/too large/);
  });

  it('queries a viewport in the POST body, exactly filters it, caps results, and caches repeats', async () => {
    const inside = Array.from({ length: 105 }, (_, index) => ({
      type: 'node',
      id: 10_000 + index,
      lat: 38.1 + (index % 10) / 100,
      lon: -121.9 + (index % 10) / 100,
      tags: { shop: 'bicycle', name: `Viewport Bikes ${String(index).padStart(3, '0')}` },
    }));
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://overpass.example/api/interpreter');
      expect(url).not.toContain('38');
      expect(url).not.toContain('-122');
      const query = new URLSearchParams(String(init.body)).get('data') || '';
      expect(query).toContain('[timeout:10]');
      expect(query).toContain('nwr["shop"="bicycle"](38,-122,39,-121)');
      return new Response(JSON.stringify({
        elements: [
          ...inside,
          {
            type: 'node', id: 99_999, lat: 37.999, lon: -121.5,
            tags: { shop: 'bicycle', name: 'Outside Latitude' },
          },
          {
            type: 'node', id: 99_998, lat: 38.5, lon: -120.999,
            tags: { shop: 'bicycle', name: 'Outside Longitude' },
          },
        ],
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl, endpoint: 'https://overpass.example/api/interpreter' });
    const viewport = { north: 39, south: 38, west: -122, east: -121, zoom: 11 };

    const first = await directory.searchViewport(viewport);
    const second = await directory.searchViewport(viewport);

    expect(Object.keys(first).sort()).toEqual(['attribution', 'attributions', 'bounds', 'shops', 'truncated']);
    expect(first.bounds).toEqual(viewport);
    expect(first.shops).toHaveLength(100);
    expect(first.truncated).toBe(true);
    expect(first.shops.map((shop) => shop.id)).not.toContain('osm:node:99999');
    expect(first.shops.map((shop) => shop.id)).not.toContain('osm:node:99998');
    expect(first.attribution).toMatchObject({ text: '© OpenStreetMap contributors', license: 'ODbL' });
    expect(first).not.toHaveProperty('cache');
    expect(first).not.toHaveProperty('fetchedAt');
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('safely reuses an outward-rounded cache envelope while applying each exact viewport', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const query = new URLSearchParams(String(init.body)).get('data') || '';
      expect(query).toContain('(38.3,-121.91,38.31,-121.9)');
      return new Response(JSON.stringify({
        elements: [{
          type: 'node', id: 51, lat: 38.3015, lon: -121.905,
          tags: { shop: 'bicycle', name: 'Envelope Edge Bikes' },
        }, {
          type: 'node', id: 52, lat: 38.305, lon: -121.905,
          tags: { shop: 'bicycle', name: 'Shared Center Bikes' },
        }],
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });

    const wider = await directory.searchViewport({
      north: 38.309, south: 38.301, west: -121.909, east: -121.901, zoom: 14,
    });
    const narrower = await directory.searchViewport({
      north: 38.308, south: 38.302, west: -121.908, east: -121.902, zoom: 15,
    });

    expect(wider.shops.map((shop) => shop.id).sort()).toEqual(['osm:node:51', 'osm:node:52']);
    expect(narrower.shops.map((shop) => shop.id)).toEqual(['osm:node:52']);
    expect(narrower.bounds.zoom).toBe(15);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('splits an antimeridian viewport and retains shops on both sides only', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const query = new URLSearchParams(String(init.body)).get('data') || '';
      expect(query).toContain('(9,179.5,10,180)');
      expect(query).toContain('(9,-180,10,-179.5)');
      return new Response(JSON.stringify({
        elements: [{
          type: 'node', id: 1, lat: 9.5, lon: 179.7,
          tags: { shop: 'bicycle', name: 'West Dateline Bikes' },
        }, {
          type: 'node', id: 2, lat: 9.5, lon: -179.7,
          tags: { shop: 'bicycle', name: 'East Dateline Bikes' },
        }, {
          type: 'node', id: 3, lat: 9.5, lon: 0,
          tags: { shop: 'bicycle', name: 'Outside Dateline Bikes' },
        }],
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });

    const result = await directory.searchViewport({
      north: 10, south: 9, west: 179.5, east: -179.5, zoom: 11,
    });

    expect(result.shops.map((shop) => shop.id).sort()).toEqual(['osm:node:1', 'osm:node:2']);
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

  it('uses only trustworthy source-tag fallbacks for address hierarchy', () => {
    const shops = normalizeOverpassBikeShops({
      elements: [{
        type: 'node', id: 61, lat: 38.3, lon: -121.9,
        tags: {
          shop: 'bicycle',
          name: 'Fallback Address Bikes',
          'is_in:city': 'Vacaville',
          'is_in:state': 'California',
          'addr:country': 'United States',
          'ISO3166-1:alpha2': 'us',
        },
      }, {
        type: 'node', id: 62, lat: 38.31, lon: -121.91,
        tags: {
          shop: 'bicycle',
          name: 'Invalid Country Bikes',
          'is_in:town': 'Elmira',
          'is_in:province': 'California',
          'is_in:country_code': 'USA',
        },
      }],
    }, { latitude: 38.3, longitude: -121.9 });

    expect(shops.find((shop) => shop.id === 'osm:node:61')?.address).toMatchObject({
      locality: 'Vacaville',
      region: 'California',
      countryCode: 'US',
      formatted: 'Vacaville, California',
    });
    expect(shops.find((shop) => shop.id === 'osm:node:62')?.address).toMatchObject({
      locality: 'Elmira',
      region: 'California',
      countryCode: '',
    });
  });

  it('evicts old viewport candidate sets at the dedicated cache-entry bound', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    const directory = createBikeShopDirectory({ fetchImpl });
    const viewportAt = (index: number) => {
      const south = 30 + index * 0.02;
      return {
        north: south + 0.005,
        south,
        west: -120,
        east: -119.995,
        zoom: 15,
      };
    };

    for (let index = 0; index <= bikeShopSearchLimits.maximumViewportCacheEntries; index += 1) {
      await directory.searchViewport(viewportAt(index));
    }
    expect(fetchImpl).toHaveBeenCalledTimes(bikeShopSearchLimits.maximumViewportCacheEntries + 1);

    await directory.searchViewport(viewportAt(0));
    expect(fetchImpl).toHaveBeenCalledTimes(bikeShopSearchLimits.maximumViewportCacheEntries + 2);
  });

  it('serves but does not retain oversized viewport candidate arrays', async () => {
    const fetchImpl = vi.fn(async () => {
      const generation = fetchImpl.mock.calls.length;
      return new Response(JSON.stringify({
        elements: Array.from({
          length: bikeShopSearchLimits.maximumViewportCachedCandidates + 1,
        }, (_, index) => ({
          type: 'node',
          id: generation * 10_000 + index + 1,
          lat: 38.35,
          lon: -121.95,
          tags: { shop: 'bicycle', name: `Generation ${generation} Bike ${index}` },
        })),
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });
    const viewport = { north: 38.4, south: 38.3, west: -122, east: -121.9, zoom: 14 };

    const first = await directory.searchViewport(viewport);
    const second = await directory.searchViewport(viewport);

    expect(first.shops).toHaveLength(bikeShopSearchLimits.maximumResults);
    expect(second.shops).toHaveLength(bikeShopSearchLimits.maximumResults);
    expect(first.truncated).toBe(true);
    expect(second.truncated).toBe(true);
    expect(first.shops[0].id).not.toBe(second.shops[0].id);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retain a byte-heavy viewport entry below the candidate-count ceiling', async () => {
    const candidateCount = bikeShopSearchLimits.maximumViewportCachedCandidates - 100;
    const fetchImpl = vi.fn(async () => {
      const generation = fetchImpl.mock.calls.length;
      return new Response(JSON.stringify({
        elements: Array.from({ length: candidateCount }, (_, index) => ({
          type: 'node',
          id: generation * 10_000 + index + 1,
          lat: 38.35,
          lon: -121.95,
          tags: {
            shop: 'bicycle',
            name: `Generation ${generation} ${'N'.repeat(160)} ${index}`,
            website: `https://example.test/${'w'.repeat(470)}`,
            opening_hours: 'o'.repeat(300),
            phone: '1'.repeat(80),
            'addr:street': 's'.repeat(220),
          },
        })),
      }), { status: 200 });
    });
    const directory = createBikeShopDirectory({ fetchImpl });
    const viewport = { north: 38.4, south: 38.3, west: -122, east: -121.9, zoom: 14 };

    const first = await directory.searchViewport(viewport);
    const second = await directory.searchViewport(viewport);

    expect(candidateCount).toBeLessThan(bikeShopSearchLimits.maximumViewportCachedCandidates);
    expect(first.shops[0].id).not.toBe(second.shops[0].id);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
    })).toThrow(/directory bike shop ID/);
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

  it('treats a matching cross-catalog identity alias as the same approved shop', async () => {
    const shop = {
      id: 'overture:11111111-1111-4111-8111-111111111111',
      claimed: false,
      source: {
        provider: 'Overture Maps',
        elementType: 'place',
        elementId: '11111111-1111-4111-8111-111111111111',
        aliases: [{
          provider: 'OpenStreetMap', elementType: 'node', elementId: '77',
          url: 'https://www.openstreetmap.org/node/77',
        }],
      },
    };
    expect(bikeShopClaimIdentities(shop)).toEqual([
      { source: 'overture', osmElementType: 'place', osmElementId: '11111111-1111-4111-8111-111111111111' },
      { source: 'openstreetmap', osmElementType: 'node', osmElementId: '77' },
    ]);
    expect(applyApprovedBikeShopClaims([shop], [{
      source: 'openstreetmap', osmElementType: 'node', osmElementId: '77',
    }])).toMatchObject([{ claimed: true }]);
    const loader = vi.fn(async () => [{
      source: 'openstreetmap', osmElementType: 'node', osmElementId: '77',
    }]);
    await expect(applyApprovedBikeShopClaimsBestEffort([shop], loader)).resolves.toMatchObject([
      { claimed: true },
    ]);
    expect(loader).toHaveBeenCalledWith([
      { source: 'overture', osmElementType: 'place', osmElementId: '11111111-1111-4111-8111-111111111111' },
      { source: 'openstreetmap', osmElementType: 'node', osmElementId: '77' },
    ]);
  });

  it('keeps the public directory available without unverified badges when claim storage fails', async () => {
    const shops = [{
      id: 'osm:node:77',
      claimed: true,
      source: { provider: 'OpenStreetMap', elementType: 'node', elementId: '77' },
    }];
    const report = vi.fn();
    await expect(applyApprovedBikeShopClaimsBestEffort(
      shops,
      vi.fn(async () => { throw new Error('database unavailable'); }),
      report,
    )).resolves.toEqual([{ ...shops[0], claimed: false }]);
    expect(report).toHaveBeenCalledOnce();
  });

  it('cools down an unsuccessful upstream endpoint instead of retrying on every search', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const directory = createBikeShopDirectory({
      fetchImpl,
      endpoint: 'https://overpass.example/api/interpreter',
    });
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/failed \(429\)/);
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toMatchObject({
      code: 'OVERPASS_COOLDOWN',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails over to a healthy OpenStreetMap mirror and cools down a failed mirror', async () => {
    const fetchImpl = vi.fn(async (url: string) => (
      url.includes('primary')
        ? new Response('', { status: 504 })
        : new Response(JSON.stringify({ elements: [{
          type: 'node', id: 701, lat: 38.3, lon: -121.9,
          tags: { shop: 'bicycle', name: 'Mirror Bikes' },
        }] }), { status: 200 })
    ));
    const directory = createBikeShopDirectory({
      fetchImpl,
      endpoints: [
        'https://primary.example/api/interpreter',
        'https://secondary.example/api/interpreter',
      ],
    });
    const first = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 5 });
    const second = await directory.search({ lat: 38.31, lng: -121.9, radiusMiles: 5 });
    expect(first.shops.map((shop) => shop.name)).toContain('Mirror Bikes');
    expect(second.shops.map((shop) => shop.name)).toContain('Mirror Bikes');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://primary.example/api/interpreter',
      'https://secondary.example/api/interpreter',
      'https://secondary.example/api/interpreter',
    ]);
  });

  it('serves the preloaded catalog during an upstream outage and merges OSM when live', async () => {
    const catalogShop = {
      id: 'overture:11111111-1111-4111-8111-111111111111',
      name: "Ray's Cycle",
      latitude: 38.356,
      longitude: -121.987,
      address: { line1: '', locality: 'Vacaville', region: 'CA', postalCode: '', countryCode: 'US', formatted: 'Vacaville, CA' },
      phone: '', website: '', openingHours: '',
      services: { sales: true, repair: false, rental: false, ebike: false },
      source: { provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111', url: 'https://docs.overturemaps.org/guides/places/' },
      links: {},
    };
    const offlineFetch = vi.fn(async () => new Response('', { status: 503 }));
    const offline = createBikeShopDirectory({
      endpoint: 'https://overpass.example/api/interpreter',
      fetchImpl: offlineFetch,
      loadSearch: vi.fn(async () => [catalogShop]),
    });
    const fallback = await offline.search({ lat: 38.35, lng: -121.99, radiusMiles: 5 });
    expect(fallback).toMatchObject({
      degraded: true,
      shops: [{ name: "Ray's Cycle", source: { provider: 'Overture Maps' } }],
    });
    expect(fallback.notice).toMatch(/recently known/i);
    await expect(offline.search({ lat: 38.36, lng: -121.99, radiusMiles: 5 })).resolves.toMatchObject({
      degraded: true,
      shops: [{ name: "Ray's Cycle" }],
    });
    expect(offlineFetch).toHaveBeenCalledTimes(1);

    const online = createBikeShopDirectory({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ elements: [{
        type: 'node', id: 702, lat: 38.3561, lon: -121.9871,
        tags: { shop: 'bicycle', name: "Ray's Cycle", phone: '555-0100' },
      }] }), { status: 200 })),
      loadSearch: vi.fn(async () => [catalogShop]),
    });
    const merged = await online.search({ lat: 38.35, lng: -121.99, radiusMiles: 5 });
    expect(merged.shops).toHaveLength(1);
    expect(merged.shops[0]).toMatchObject({
      id: 'overture:11111111-1111-4111-8111-111111111111',
      phone: '',
      address: { locality: 'Vacaville' },
      source: {
        provider: 'Overture Maps',
        aliases: [{ provider: 'OpenStreetMap', elementType: 'node', elementId: '702' }],
      },
    });
    expect(JSON.stringify(merged.shops[0])).not.toContain('555-0100');
  });

  it('returns the preloaded catalog promptly while slow OSM mirrors enrich in the background', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    });
    const directory = createBikeShopDirectory({
      fetchImpl,
      catalogLiveWaitMs: 25,
      loadSearch: vi.fn(async () => [{
        id: 'overture:11111111-1111-4111-8111-111111111111',
        name: 'Immediate Catalog Bikes',
        latitude: 38.3,
        longitude: -121.9,
        address: {}, services: {}, phone: '', website: '', openingHours: '', links: {},
        source: { provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111' },
      }]),
    });
    const startedAt = performance.now();
    const result = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 5 });
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(result).toMatchObject({
      degraded: true,
      shops: [{ name: 'Immediate Catalog Bikes' }],
    });
    release();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  });

  it('merges a dense preloaded catalog without quadratic search latency', async () => {
    const catalog = Array.from({ length: 5_000 }, (_, index) => ({
      id: `overture:${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      name: `Catalog Bikes ${index}`,
      latitude: 38.3 + (index % 50) / 10_000,
      longitude: -121.9 + Math.floor(index / 50) / 10_000,
      address: {}, services: {}, phone: '', website: '', openingHours: '', links: {},
      source: {
        provider: 'Overture Maps',
        elementType: 'place',
        elementId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
      },
    }));
    const directory = createBikeShopDirectory({
      endpoint: 'https://overpass.example/api/interpreter',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ elements: [{
        type: 'node',
        id: 704,
        lat: catalog[2_500].latitude,
        lon: catalog[2_500].longitude,
        tags: { shop: 'bicycle', name: catalog[2_500].name },
      }] }), { status: 200 })),
      loadSearch: vi.fn(async () => catalog),
    });
    const startedAt = performance.now();
    const result = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 5 });
    expect(performance.now() - startedAt).toBeLessThan(1_200);
    expect(result.shops).toHaveLength(100);
  });

  it('caches only the bounded exact nearby result instead of every dense-radius candidate', async () => {
    let coordinateReads = 0;
    const denseCatalog = Array.from({ length: 1_000 }, (_, index) => {
      const latitude = 38.3 + (index % 20) / 100_000;
      const longitude = -121.9 + Math.floor(index / 20) / 100_000;
      return {
        id: `overture:${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
        name: `Dense Cache Bikes ${String(index).padStart(4, '0')}`,
        get latitude() { coordinateReads += 1; return latitude; },
        get longitude() { coordinateReads += 1; return longitude; },
        address: {}, services: {}, phone: '', website: '', openingHours: '', links: {},
        source: {
          provider: 'Overture Maps',
          elementType: 'place',
          elementId: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
        },
      };
    });
    const loadSearch = vi.fn(async () => denseCatalog);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    const directory = createBikeShopDirectory({ loadSearch, fetchImpl });
    const input = { lat: 38.3, lng: -121.9, radiusMiles: 5 };
    const first = await directory.search(input);
    expect(first.shops).toHaveLength(100);
    coordinateReads = 0;
    const second = await directory.search(input);
    expect(second).toEqual(first);
    expect(coordinateReads).toBeLessThan(1_000);
    expect(loadSearch).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves an expired successful response as stale when refresh fails', async () => {
    let timestamp = 1_700_000_000_000;
    let online = true;
    const directory = createBikeShopDirectory({
      endpoint: 'https://overpass.example/api/interpreter',
      now: () => timestamp,
      fetchImpl: vi.fn(async () => online
        ? new Response(JSON.stringify({ elements: [{
          type: 'node', id: 703, lat: 38.3, lon: -121.9,
          tags: { shop: 'bicycle', name: 'Stale Bikes' },
        }] }), { status: 200 })
        : new Response('', { status: 503 })),
    });
    const input = { lat: 38.3, lng: -121.9, radiusMiles: 5 };
    await directory.search(input);
    timestamp += bikeShopSearchLimits.cacheTtlMs + 1;
    online = false;
    const stale = await directory.search(input);
    expect(stale).toMatchObject({ degraded: true, shops: [{ name: 'Stale Bikes' }] });
  });

  it('canonically verifies an Overture catalog claim without trusting the client snapshot', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const canonical = {
      id: `overture:${id}`,
      name: 'Canonical Catalog Bikes', latitude: 38.3, longitude: -121.9,
      address: {}, services: {}, phone: '', website: '', openingHours: '', links: {},
      source: { provider: 'Overture Maps', elementType: 'place', elementId: id, url: 'https://docs.overturemaps.org/guides/places/' },
    };
    const resolveCatalogShop = vi.fn(async () => canonical);
    const directory = createBikeShopDirectory({ resolveCatalogShop });
    const parsed = parseBikeShopClaimRequest({
      shop: { id: `overture:${id}`, name: 'Attacker Name' },
      claimantRole: 'owner', verificationMethod: 'business-email', businessEmail: 'owner@example.com',
    });
    const claim = await directory.resolveClaim(parsed);
    expect(claim).toMatchObject({ source: 'overture', shopName: 'Canonical Catalog Bikes' });
    expect(JSON.stringify(claim)).not.toContain('Attacker Name');
    expect(resolveCatalogShop).toHaveBeenCalledWith(id);
  });

  it('resolves an OSM claim through the durable Overture canonical alias', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const directory = createBikeShopDirectory({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ elements: [{
        type: 'node', id: 702, lat: 38.3561, lon: -121.9871,
        tags: { shop: 'bicycle', name: "Ray's Cycle", phone: '555-0100' },
      }] }), { status: 200 })),
      loadSearch: vi.fn(async () => [{
        id: `overture:${id}`,
        name: "Ray's Cycle",
        latitude: 38.356,
        longitude: -121.987,
        address: { locality: 'Vacaville' },
        phone: '', website: '', openingHours: '', services: {}, links: {},
        source: { provider: 'Overture Maps', elementType: 'place', elementId: id },
      }]),
    });
    const claim = await directory.resolveClaim(parseBikeShopClaimRequest({
      shop: { id: 'osm:node:702' },
      claimantRole: 'owner', verificationMethod: 'business-email', businessEmail: 'owner@example.com',
    }));
    expect(claim).toMatchObject({
      source: 'openstreetmap',
      shopName: "Ray's Cycle",
      shopSnapshot: { id: `overture:${id}`, source: { provider: 'Overture Maps' } },
      claimAliases: [
        { source: 'overture', osmElementType: 'place', osmElementId: id },
        { source: 'openstreetmap', osmElementType: 'node', osmElementId: '702' },
      ],
    });
    expect(JSON.stringify(claim.shopSnapshot)).not.toContain('555-0100');
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
