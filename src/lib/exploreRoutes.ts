import type {
  ExploreElevationSample,
  ExploreRoute,
  ExploreRouteWaypoint,
  ExploreTravelMode,
  TrackPoint,
} from '../types';

type ExploreRouteRequest = {
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: ExploreTravelMode;
  routeName?: string;
  waypoints?: ExploreRouteWaypoint[];
};

type ExploreRouteBuilder = (request: ExploreRouteRequest) => Promise<ExploreRoute>;

export type ExploreRouteUpgradeResult = {
  routes: ExploreRoute[];
  upgradedCount: number;
  failedCount: number;
};

export type ExploreSmartRoutePlan = {
  name: string;
  summary: string;
  originQuery: string;
  destinationQuery: string;
  waypointQueries: string[];
  targetDistanceMiles: number;
  routeKind: 'point-to-point' | 'loop' | 'event-stage';
  disclaimer: string;
  sources: Array<{ title: string; url: string }>;
};

export type ExploreElevationProfile = {
  elevationSamples: ExploreElevationSample[];
  elevationGainMeters: number;
  elevationLossMeters: number;
};

export async function fetchExploreRoute(request: ExploreRouteRequest) {
  const response = await fetch('/api/explore/route', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null) as {
    route?: ExploreRoute;
    error?: string;
  } | null;

  if (!response.ok || !payload?.route) {
    throw new Error(payload?.error || `Explore route request failed (${response.status}).`);
  }

  return payload.route;
}

export async function upgradeExploreRoutesToBicycleRoads(
  routes: readonly ExploreRoute[],
  rebuildRoute: ExploreRouteBuilder = fetchExploreRoute,
): Promise<ExploreRouteUpgradeResult> {
  const upgradedRoutes: ExploreRoute[] = [];
  let upgradedCount = 0;
  let failedCount = 0;

  for (const route of routes) {
    if (route.travelMode === 'bicycle') {
      upgradedRoutes.push(route);
      continue;
    }
    try {
      const rebuilt = await rebuildRoute({
        origin: route.origin,
        destination: route.destination,
        originLabel: route.originLabel,
        destinationLabel: route.destinationLabel,
        travelMode: 'bicycle',
        routeName: route.name,
        waypoints: route.waypoints,
      });
      upgradedRoutes.push({
        ...rebuilt,
        // Keep the saved-route identity and date so the bicycle-safe version
        // replaces the driving geometry instead of appearing as a duplicate.
        id: route.id,
        createdAt: route.createdAt,
      });
      upgradedCount += 1;
    } catch {
      upgradedRoutes.push(route);
      failedCount += 1;
    }
  }

  return { routes: upgradedRoutes, upgradedCount, failedCount };
}

export async function fetchSmartExploreRoutePlan(description: string) {
  const response = await fetch('/api/explore/smart-route', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const payload = await response.json().catch(() => null) as {
    plan?: ExploreSmartRoutePlan;
    error?: string;
  } | null;
  if (!response.ok || !payload?.plan) {
    throw new Error(payload?.error || `Smart route request failed (${response.status}).`);
  }
  return payload.plan;
}

export async function fetchExploreElevationProfile(
  route: Pick<ExploreRoute, 'encodedPolyline' | 'distanceMeters'>,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/explore/elevation', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      encodedPolyline: route.encodedPolyline,
      distanceMeters: route.distanceMeters,
    }),
    signal,
  });
  const payload = await response.json().catch(() => null) as {
    elevation?: ExploreElevationProfile;
    error?: string;
  } | null;
  const elevation = payload?.elevation;

  if (!response.ok || !elevation || elevation.elevationSamples.length < 2) {
    throw new Error(payload?.error || `Explore elevation request failed (${response.status}).`);
  }

  return elevation;
}
