import type { ExploreRoute } from '../types';
import { sanitizeRecentExploreRoutes } from './exploreRecentRoutes';

type ExploreRouteHistoryResponse = {
  routes?: unknown;
  error?: string;
};

async function routeHistoryRequest(options?: RequestInit) {
  const response = await fetch('/api/explore/recent-routes', {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as ExploreRouteHistoryResponse;
  if (!response.ok) {
    throw new Error(payload.error || `Personal Explore routes returned ${response.status}`);
  }
  return sanitizeRecentExploreRoutes(payload.routes);
}

export function loadCloudExploreRoutes() {
  return routeHistoryRequest();
}

export function saveCloudExploreRoutes(routes: readonly ExploreRoute[]) {
  return routeHistoryRequest({
    method: 'POST',
    body: JSON.stringify({ routes }),
  });
}
