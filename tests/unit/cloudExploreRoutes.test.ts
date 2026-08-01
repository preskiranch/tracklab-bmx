import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCloudExploreRoutes, saveCloudExploreRoutes } from '../../src/lib/cloudExploreRoutes';
import type { ExploreRoute } from '../../src/types';

const route: ExploreRoute = {
  id: 'EXPLORE-CLOUD-1',
  name: 'Account route',
  origin: { lat: 37.7749, lng: -122.4194 },
  destination: { lat: 37.8024, lng: -122.4058 },
  originLabel: 'Market Street',
  destinationLabel: 'Fisherman’s Wharf',
  travelMode: 'bicycle',
  distanceMeters: 5_200,
  durationSeconds: 1_320,
  encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  createdAt: 1_700_000_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('personal Explore route cloud client', () => {
  it('loads authenticated account routes without a client-controlled profile key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [route] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadCloudExploreRoutes()).resolves.toEqual([route]);
    expect(fetchMock).toHaveBeenCalledWith('/api/explore/recent-routes', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('saves recent routes to the signed-in account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [route] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(saveCloudExploreRoutes([route])).resolves.toEqual([route]);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toEqual({ routes: [route] });
  });
});
