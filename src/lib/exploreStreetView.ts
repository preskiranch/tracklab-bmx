import { exploreRoutePoint, exploreRoutePoints } from './explore';
import { loadGoogleStreetViewLibrary } from './googleMaps';
import type { ExploreRoute, TrackPoint } from '../types';

export const exploreStreetViewCountdownSeconds = 30;
export const exploreStreetViewCheckpointLimit = 12;

export type ExploreStreetViewCheckpoint = {
  distanceMeters: number;
  point: TrackPoint;
};

export type ExploreStreetViewReadiness = {
  available: number;
  checked: number;
  coverageRatio: number;
};

export function exploreStreetViewRouteCheckpoints(
  route: ExploreRoute,
  limit = exploreStreetViewCheckpointLimit,
): ExploreStreetViewCheckpoint[] {
  const routePoints = exploreRoutePoints(route);
  if (routePoints.length === 0) {
    return [];
  }

  const safeLimit = Math.max(2, Math.floor(limit));
  const count = Math.min(
    safeLimit,
    Math.max(2, Math.ceil(Math.max(1, route.distanceMeters) / 500) + 1),
  );
  return Array.from({ length: count }, (_, index) => {
    const distanceMeters = count === 1
      ? 0
      : route.distanceMeters * index / (count - 1);
    return {
      distanceMeters,
      point: exploreRoutePoint(routePoints, distanceMeters, route.distanceMeters) ?? routePoints[0],
    };
  });
}

export async function scanExploreStreetViewCoverage(
  route: ExploreRoute,
): Promise<ExploreStreetViewReadiness> {
  const checkpoints = exploreStreetViewRouteCheckpoints(route);
  if (checkpoints.length === 0) {
    return { available: 0, checked: 0, coverageRatio: 0 };
  }

  const google = await loadGoogleStreetViewLibrary();
  const StreetViewService = google.maps.StreetViewService;
  if (!StreetViewService) {
    throw new Error('Google Street View coverage checks are unavailable.');
  }
  const service = new StreetViewService();
  const source = google.maps.StreetViewSource?.OUTDOOR;
  let available = 0;

  for (let index = 0; index < checkpoints.length; index += 3) {
    const batch = checkpoints.slice(index, index + 3);
    const results = await Promise.all(batch.map(async ({ point }) => {
      try {
        const result = await service.getPanorama({
          location: point,
          radius: 80,
          ...(source ? { sources: [source] } : {}),
        });
        return Boolean(result.data?.location?.pano);
      } catch {
        return false;
      }
    }));
    available += results.filter(Boolean).length;
  }

  return {
    available,
    checked: checkpoints.length,
    coverageRatio: available / checkpoints.length,
  };
}
