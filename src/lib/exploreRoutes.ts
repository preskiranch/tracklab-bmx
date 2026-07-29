import type { ExploreRoute, ExploreTravelMode, TrackPoint } from '../types';

type ExploreRouteRequest = {
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: ExploreTravelMode;
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
