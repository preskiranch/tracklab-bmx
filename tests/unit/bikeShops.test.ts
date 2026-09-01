import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicBikeShopDirectory } from '../../src/components/PublicBikeShopDirectory';
import {
  bikeShopClaimSourceUrl,
  nearbyTracksForShop,
  listBikeShopClaimsForAdmin,
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
    expect(markup).toContain('Google Maps');
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

  it('loads and withdraws personal claims and supports the private administrator review contract', async () => {
    const claim = {
      id: '44444444-4444-4444-8444-444444444444',
      source: 'openstreetmap',
      osmElementType: 'node',
      osmElementId: '12345',
      shopName: 'Trackside Bikes',
      latitude: 38.3,
      longitude: -121.8,
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
    await expect(listMyBikeShopClaimRequests(myFetcher, myController.signal)).resolves.toMatchObject([{ status: 'pending' }]);
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
