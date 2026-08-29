import type { ExploreRoute } from '../types';
import { sanitizeRecentExploreRoutes } from './exploreRecentRoutes';
import { exploreRequestHeaders, type ExploreRequestAccess } from './exploreRoutes';

type ExploreRouteHistoryResponse = {
  routes?: unknown;
  error?: string;
};

async function routeHistoryRequest(
  options?: RequestInit,
  access?: ExploreRequestAccess | null,
) {
  const response = await fetch('/api/explore/recent-routes', {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...exploreRequestHeaders(access),
      ...options?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as ExploreRouteHistoryResponse;
  if (!response.ok) {
    throw new Error(payload.error || `Personal Explore routes returned ${response.status}`);
  }
  return sanitizeRecentExploreRoutes(payload.routes);
}

export function loadCloudExploreRoutes(access?: ExploreRequestAccess | null) {
  return routeHistoryRequest(undefined, access);
}

export function saveCloudExploreRoutes(
  routes: readonly ExploreRoute[],
  access?: ExploreRequestAccess | null,
) {
  return routeHistoryRequest({
    method: 'POST',
    body: JSON.stringify({ routes }),
  }, access);
}
