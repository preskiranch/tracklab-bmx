import type {
  ExploreElevationSample,
  ExploreRoute,
  ExploreTravelMode,
  TrackPoint,
} from '../types';

type ExploreRouteRequest = {
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: ExploreTravelMode;
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
