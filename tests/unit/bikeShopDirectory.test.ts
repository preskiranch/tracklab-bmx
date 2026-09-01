import { describe, expect, it, vi } from 'vitest';
import {
  createBikeShopDirectory,
  normalizeOverpassBikeShops,
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
      return new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const directory = createBikeShopDirectory({ fetchImpl, now: () => 1_700_000_000_000 });

    const first = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 10 });
    const second = await directory.search({ lat: 38.3, lng: -121.9, radiusMiles: 10 });

    expect(first.cache).toBe('miss');
    expect(second.cache).toBe('hit');
    expect(first.attribution).toMatchObject({ text: '© OpenStreetMap contributors', license: 'ODbL' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not cache an unsuccessful upstream response', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const directory = createBikeShopDirectory({ fetchImpl });
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/failed \(429\)/);
    await expect(directory.search({ lat: 38, lng: -121, radiusMiles: 5 })).rejects.toThrow(/failed \(429\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
