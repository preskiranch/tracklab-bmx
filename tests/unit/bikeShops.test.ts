import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicBikeShopDirectory } from '../../src/components/PublicBikeShopDirectory';
import {
  bikeShopClaimSourceUrl,
  browseBikeShopsByScope,
  browseBikeShopsByCity,
  nearbyTracksForShop,
  listBikeShopClaimsForAdmin,
  listBikeShopHierarchy,
  listMyBikeShopClaimRequests,
  reviewBikeShopClaimRequest,
  searchNearbyBikeShops,
  submitBikeShopClaimRequest,
  withdrawBikeShopClaimRequest,
  type BikeShopRecord,
} from '../../src/lib/bikeShops';
import { trackLocatorRelativeUrl } from '../../src/lib/mapLinks';
import type { TrackLocatorRecord } from '../../src/types';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function track(id: string, latitude: number, longitude: number): TrackLocatorRecord {
  return {
    id,
    name: id,
    country: 'United States',
    countryCode: 'US',
    state: 'CA',
    region: 'West',
    source: 'Test',
    latitude,
    longitude,
  };
}

describe('public bike shop directory client', () => {
  it('is integrated as a public landing section with the exact navigation label and account gate', () => {
    const source = readFileSync(new URL('../../src/components/MembershipLanding.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Global Bike Shop Directory');
    expect(source).toContain('<PublicBikeShopDirectory');
    expect(source).toContain('onRequireFreeAccount');
    expect(source).toContain('id="free-account-gate"');
  });

  it('renders public search, every five-mile radius, attribution, and free-account claiming', () => {
    const markup = renderToStaticMarkup(createElement(PublicBikeShopDirectory, { tracks: [] }));
    const source = readFileSync(new URL('../../src/components/PublicBikeShopDirectory.tsx', import.meta.url), 'utf8');
    expect(markup).toContain('No TrackLab account is needed to search');
    expect(markup).toContain('Use current location');
    expect(markup).toContain('5 miles');
    expect(markup).toContain('50 miles');
    expect(markup).toContain('OpenStreetMap contributors');
    expect(markup).toContain('Overture Maps');
    expect(markup).toContain('Google Maps');
    expect(source).toContain("claim.source === 'overture'");
    expect(source).toContain('Overture Maps place');
    expect(source).not.toContain('Additional details (optional)');
  });

  it('renders private claimant status and administrator review surfaces only for signed-in roles', () => {
    const anonymous = renderToStaticMarkup(createElement(PublicBikeShopDirectory, { tracks: [] }));
    expect(anonymous).not.toContain('My shop claims');
    expect(anonymous).not.toContain('Bike shop claim review');
    const claimant = renderToStaticMarkup(createElement(PublicBikeShopDirectory, {
      tracks: [], accountId: 'claimant-account',
    }));
    expect(claimant).toContain('My shop claims');
    expect(claimant).not.toContain('Bike shop claim review');
    const administrator = renderToStaticMarkup(createElement(PublicBikeShopDirectory, {
      tracks: [], accountId: 'admin-account', isAdmin: true,
    }));
    expect(administrator).toContain('My shop claims');
    expect(administrator).toContain('Bike shop claim review');
  });

  it('uses a bounded public query and preserves the backend exact-distance ordering', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      shops: [
        { id: 'near', name: 'Near Bikes', latitude: 38.3, longitude: -121.8, distanceMiles: 2, website: 'javascript:alert(1)', links: {} },
        { id: 'far', name: 'Far Bikes', latitude: 38.4, longitude: -121.9, distanceMiles: 8, links: {} },
        { id: 'near', name: 'Duplicate', latitude: 38.3, longitude: -121.8, distanceMiles: 1 },
        { id: '', name: 'Invalid', latitude: 38.3, longitude: -121.8 },
      ],
    }));
    const result = await searchNearbyBikeShops({ latitude: 38.3, longitude: -121.8 }, 25, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/bike-shops/nearby',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ latitude: 38.3, longitude: -121.8, radiusMiles: 25 }),
      },
    );
    expect(result.shops.map((shop) => shop.id)).toEqual(['near', 'far']);
    expect(result.shops[0].website).toBe('');
    expect(result.attribution.text).toContain('OpenStreetMap');
    expect(result).not.toHaveProperty('fetchedAt');
  });

  it('does not reorder shops that share the same displayed distance bucket', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      shops: [
        { id: 'exact-first', name: 'Exact First', latitude: 38.3, longitude: -121.8, distanceMiles: 2.04 },
        { id: 'exact-second', name: 'Exact Second', latitude: 38.3, longitude: -121.8, distanceMiles: 2.01 },
      ],
    }));
    const result = await searchNearbyBikeShops({ latitude: 38.3, longitude: -121.8 }, 25, fetcher);
    expect(result.shops.map((shop) => [shop.id, shop.distanceMiles])).toEqual([
      ['exact-first', 2],
      ['exact-second', 2],
    ]);
  });

  it('requires a five-mile increment between 5 and 50 without making a request', async () => {
    const fetcher = vi.fn();
    await expect(searchNearbyBikeShops({ latitude: 38, longitude: -121 }, 12, fetcher)).rejects.toMatchObject({ status: 400 });
    await expect(searchNearbyBikeShops({ latitude: 91, longitude: -121 }, 25, fetcher)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes an abort signal through public directory searches', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => jsonResponse({ shops: [] }));
    await searchNearbyBikeShops(
      { latitude: 38, longitude: -121 },
      25,
      fetcher,
      controller.signal,
    );
    expect(fetcher).toHaveBeenCalledWith('/api/bike-shops/nearby', expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('finds tracks within 50 miles of the selected shop and sorts them nearest first', () => {
    const nearby = nearbyTracksForShop(
      { latitude: 38, longitude: -121 },
      [track('far-away', 40, -121), track('second', 38.2, -121), track('first', 38.05, -121)],
      50,
    );
    expect(nearby.map((entry) => entry.track.id)).toEqual(['first', 'second']);
    expect(nearby.every((entry) => entry.distanceMiles <= 50)).toBe(true);
    const source = readFileSync(new URL('../../src/components/PublicBikeShopDirectory.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('nearbyTracksForShop(selectedShop, tracks, 50).slice');
  });

  it('keeps nearby track navigation inside the current app', () => {
    expect(trackLocatorRelativeUrl('nearby-bmx')).toBe('/?locator=nearby-bmx#track-locator');
    expect(trackLocatorRelativeUrl('track/private')).toBe('');
  });

  it('submits an authenticated, reviewable OpenStreetMap ownership claim', async () => {
    const shop: BikeShopRecord = {
      id: 'osm:node:12345',
      name: 'Trackside Bikes',
      claimed: false,
      latitude: 38.3,
      longitude: -121.8,
      distanceMiles: 1.2,
      address: { line1: '1 Main St', locality: 'Vacaville', region: 'CA', postalCode: '95688', countryCode: 'US', formatted: '1 Main St, Vacaville, CA' },
      phone: '555-555-1212',
      website: 'https://example.com/',
      openingHours: 'Mo-Fr 09:00-17:00',
      services: { sales: true, repair: true, rental: false, ebike: false },
      source: { provider: 'OpenStreetMap', elementType: 'node', elementId: '12345', url: 'https://www.openstreetmap.org/node/12345' },
      links: { maps: 'https://maps.google.com/', directions: 'https://maps.google.com/', streetView: 'https://maps.google.com/' },
    };
    const fetcher = vi.fn(async () => jsonResponse({
      claim: { id: '44444444-4444-4444-8444-444444444444', status: 'pending', shopName: shop.name, createdAt: '2026-08-31T00:00:00.000Z' },
    }, 201));
    await expect(submitBikeShopClaimRequest({
      shop,
      claimantRole: 'owner',
      verificationMethod: 'business-email',
      businessEmail: 'Owner@Trackside.example',
    }, fetcher)).resolves.toMatchObject({ status: 'pending', shopName: shop.name });
    const [, request] = fetcher.mock.calls[0];
    expect(String(request?.body)).toContain('"id":"osm:node:12345"');
    expect(String(request?.body)).toContain('"businessEmail":"owner@trackside.example"');
  });

  it('submits a canonical Overture ownership claim without relabeling it as OpenStreetMap', async () => {
    const shop = {
      id: 'overture:11111111-1111-4111-8111-111111111111',
      name: "Ray's Cycle",
      claimed: false,
      latitude: 38.356,
      longitude: -121.987,
      distanceMiles: 1,
      address: { line1: '', locality: 'Vacaville', region: 'California', postalCode: '', countryCode: 'US', formatted: 'Vacaville, California' },
      phone: '', website: '', openingHours: '',
      services: { sales: true, repair: false, rental: false, ebike: false },
      source: { provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111', url: 'https://docs.overturemaps.org/guides/places/' },
      links: { maps: 'https://maps.google.com/', directions: 'https://maps.google.com/', streetView: 'https://maps.google.com/' },
    } satisfies BikeShopRecord;
    const fetcher = vi.fn(async () => jsonResponse({
      claim: { id: '55555555-5555-4555-8555-555555555555', status: 'pending', shopName: shop.name },
    }, 201));
    await submitBikeShopClaimRequest({
      shop,
      claimantRole: 'owner',
      verificationMethod: 'business-email',
      businessEmail: 'owner@example.com',
    }, fetcher);
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain(`"id":"${shop.id}"`);
    expect(bikeShopClaimSourceUrl({
      source: 'overture',
      osmElementType: 'place',
      osmElementId: '11111111-1111-4111-8111-111111111111',
    })).toBe('https://docs.overturemaps.org/guides/places/');
  });

  it('loads the global country hierarchy and browses a selected city', async () => {
    const hierarchyFetcher = vi.fn(async () => jsonResponse({
      level: 'region',
      items: [{ value: 'California', count: 42 }],
      attributions: [{ text: 'Overture Maps Foundation', url: 'https://docs.overturemaps.org/attribution/', license: 'CDLA-Permissive-2.0' }],
    }));
    await expect(listBikeShopHierarchy({ countryCode: 'us' }, hierarchyFetcher)).resolves.toMatchObject({
      level: 'region', items: [{ value: 'California', count: 42 }],
    });
    expect(hierarchyFetcher).toHaveBeenCalledWith(
      '/api/bike-shops/hierarchy?countryCode=US',
      expect.objectContaining({ credentials: 'same-origin' }),
    );

    const browseFetcher = vi.fn(async () => jsonResponse({
      location: { countryCode: 'US', region: 'California', locality: 'Vacaville' },
      shops: [{
        id: 'overture:11111111-1111-4111-8111-111111111111',
        name: "Ray's Cycle",
        latitude: 38.356,
        longitude: -121.987,
        source: { provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111' },
      }],
      total: 1,
      truncated: false,
      bounds: { north: 38.356, south: 38.356, east: -121.987, west: -121.987 },
    }));
    await expect(browseBikeShopsByCity({
      countryCode: 'US', region: 'California', locality: 'Vacaville',
    }, browseFetcher)).resolves.toMatchObject({
      shops: [{ name: "Ray's Cycle" }], total: 1, truncated: false,
    });
  });

  it('browses country and state pages without requiring a city selection', async () => {
    const fetcher = vi.fn(async (_url: string, request?: RequestInit) => {
      expect(JSON.parse(String(request?.body))).toEqual({ countryCode: 'AU', offset: 500 });
      return jsonResponse({
        location: { countryCode: 'AU', region: '', locality: '' },
        shops: [{
          id: 'overture:11111111-1111-4111-8111-111111111111',
          name: 'Australia Cycle Center',
          latitude: -33.87,
          longitude: 151.21,
          address: { locality: 'Sydney', region: 'NSW', countryCode: 'AU' },
          source: { provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111' },
        }],
        offset: 500,
        limit: 1,
        total: 1466,
        truncated: true,
        bounds: { north: -33.87, south: -33.87, east: 151.21, west: 151.21 },
      });
    });
    await expect(browseBikeShopsByScope({ countryCode: 'au', offset: 500 }, fetcher)).resolves.toMatchObject({
      location: { countryCode: 'AU', region: '', locality: '' },
      shops: [{ name: 'Australia Cycle Center' }],
      offset: 500,
      total: 1466,
      truncated: true,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/bike-shops/browse', expect.objectContaining({ method: 'POST' }));
    await expect(browseBikeShopsByScope({ countryCode: 'AU', locality: 'Sydney' }, fetcher)).rejects.toMatchObject({ status: 400 });
  });

  it('loads and withdraws personal claims and supports the private administrator review contract', async () => {
    const claim = {
      id: '44444444-4444-4444-8444-444444444444',
      source: 'openstreetmap',
      osmElementType: 'node',
      osmElementId: '12345',
      shopName: 'Trackside Bikes',
      latitude: 38.3,
      longitude: -121.8,
      shopSnapshot: {
        id: 'overture:11111111-1111-4111-8111-111111111111',
        name: 'Canonical Trackside Bikes',
        address: { line1: '12 Main St', locality: 'Vacaville', region: 'CA', postalCode: '95688', countryCode: 'us', formatted: '' },
        phone: '555-0100',
        website: 'https://trackside.example',
        openingHours: 'Mo-Fr 09:00-17:00',
        services: { sales: true, repair: true, rental: false, ebike: false },
        source: {
          provider: 'Overture Maps', elementType: 'place', elementId: '11111111-1111-4111-8111-111111111111',
          url: 'https://docs.overturemaps.org/guides/places/',
          aliases: [{ provider: 'OpenStreetMap', elementType: 'node', elementId: '12345', url: 'https://www.openstreetmap.org/node/12345' }],
        },
      },
      claimantRole: 'owner',
      verificationMethod: 'business-email',
      businessEmail: 'owner@trackside.example',
      businessPhone: '',
      verificationNote: '',
      status: 'pending',
      reviewNote: '',
      reviewedAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    };
    const myController = new AbortController();
    const myFetcher = vi.fn(async () => jsonResponse({ claims: [claim] }));
    await expect(listMyBikeShopClaimRequests(myFetcher, myController.signal)).resolves.toMatchObject([{
      status: 'pending',
      shopSnapshot: {
        name: 'Canonical Trackside Bikes',
        address: { countryCode: 'US' },
        source: {
          provider: 'Overture Maps',
          aliases: [{ provider: 'OpenStreetMap', elementType: 'node', elementId: '12345' }],
        },
      },
    }]);
    expect(myFetcher).toHaveBeenCalledWith('/api/bike-shops/claim-requests', expect.objectContaining({
      credentials: 'same-origin',
      signal: myController.signal,
    }));
    const withdrawFetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await withdrawBikeShopClaimRequest(claim.id, withdrawFetcher);
    expect(withdrawFetcher).toHaveBeenCalledWith(
      `/api/bike-shops/claim-requests/${claim.id}`,
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }),
    );

    const adminClaim = { ...claim, claimant: { displayName: 'Shop Owner', email: 'owner@example.com' } };
    const adminController = new AbortController();
    const adminFetcher = vi.fn(async () => jsonResponse({
      items: [adminClaim], total: 52, offset: 25, limit: 25, status: 'pending',
    }));
    await expect(listBikeShopClaimsForAdmin('pending', {
      offset: 25,
      limit: 25,
      fetcher: adminFetcher,
      signal: adminController.signal,
    })).resolves.toMatchObject({
      items: [{ claimant: { displayName: 'Shop Owner' } }],
      total: 52,
      offset: 25,
      limit: 25,
      status: 'pending',
    });
    expect(adminFetcher).toHaveBeenCalledWith(
      '/api/admin/bike-shop-claims?status=pending&offset=25&limit=25',
      expect.objectContaining({ credentials: 'same-origin', signal: adminController.signal }),
    );
    expect(bikeShopClaimSourceUrl(adminClaim)).toBe('https://www.openstreetmap.org/node/12345');
    const reviewFetcher = vi.fn(async () => jsonResponse({
      claim: { ...adminClaim, status: 'approved', reviewNote: 'Verified by business email.' },
    }));
    await expect(reviewBikeShopClaimRequest(
      claim.id,
      'approved',
      'Verified by business email.',
      reviewFetcher,
    )).resolves.toMatchObject({ status: 'approved' });
  });

  it('surfaces bounded server errors', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'Directory temporarily unavailable.' }, 502));
    await expect(searchNearbyBikeShops({ latitude: 38, longitude: -121 }, 25, fetcher)).rejects.toMatchObject({
      status: 502,
      message: 'Directory temporarily unavailable.',
    });
  });
});
