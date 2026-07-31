import type { ExploreElevationSample, ExploreRoute, TrackPoint } from '../types';

const recentExploreRouteLimit = 8;
const recentExploreRoutesStoragePrefix = 'tracklab-explore-recent-routes-v1';

function storageKey(profileKey: string) {
  const normalizedProfile = profileKey.trim().toLowerCase().replace(/[^a-z0-9@._-]+/g, '-');
  return `${recentExploreRoutesStoragePrefix}:${normalizedProfile || 'local'}`;
}

function validPoint(value: unknown): value is TrackPoint {
  const point = value as Partial<TrackPoint> | null;
  return Boolean(
    point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Number(point.lat) >= -90
    && Number(point.lat) <= 90
    && Number(point.lng) >= -180
    && Number(point.lng) <= 180,
  );
}

function sanitizeElevationSamples(value: unknown, distanceMeters: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((sample): ExploreElevationSample[] => {
      const candidate = sample as Partial<ExploreElevationSample> | null;
      if (!candidate || !Number.isFinite(candidate.distanceMeters) || !Number.isFinite(candidate.elevationMeters)) {
        return [];
      }
      return [{
        distanceMeters: Math.max(0, Math.min(distanceMeters, Number(candidate.distanceMeters))),
        elevationMeters: Number(candidate.elevationMeters),
      }];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 256);
}

function sanitizeRecentRoute(value: unknown): ExploreRoute | null {
  const route = value as Partial<ExploreRoute> | null;
  const distanceMeters = Number(route?.distanceMeters);
  const durationSeconds = Number(route?.durationSeconds);
  const createdAt = Number(route?.createdAt);
  const encodedPolyline = typeof route?.encodedPolyline === 'string'
    ? route.encodedPolyline.slice(0, 120_000)
    : '';
  if (
    !route
    || typeof route.id !== 'string'
    || !route.id.trim()
    || !validPoint(route.origin)
    || !validPoint(route.destination)
    || !encodedPolyline
    || !Number.isFinite(distanceMeters)
    || distanceMeters <= 1
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) {
    return null;
  }

  const elevationSamples = sanitizeElevationSamples(route.elevationSamples, distanceMeters);
  return {
    id: route.id.slice(0, 96),
    origin: route.origin,
    destination: route.destination,
    originLabel: String(route.originLabel || 'Selected start').slice(0, 160),
    destinationLabel: String(route.destinationLabel || 'Selected destination').slice(0, 160),
    travelMode: route.travelMode === 'drive' ? 'drive' : 'bicycle',
    distanceMeters,
    durationSeconds,
    encodedPolyline,
    ...(elevationSamples.length >= 2 ? {
      elevationSamples,
      elevationGainMeters: Math.max(0, Number(route.elevationGainMeters) || 0),
      elevationLossMeters: Math.max(0, Number(route.elevationLossMeters) || 0),
    } : {}),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

export function loadRecentExploreRoutes(profileKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(profileKey)) || '[]') as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((route) => {
        const sanitized = sanitizeRecentRoute(route);
        return sanitized ? [sanitized] : [];
      })
      .slice(0, recentExploreRouteLimit);
  } catch {
    return [];
  }
}

export function rememberRecentExploreRoute(profileKey: string, route: ExploreRoute) {
  const sanitized = sanitizeRecentRoute(route);
  if (!sanitized) {
    return loadRecentExploreRoutes(profileKey);
  }
  const nextRoutes = [
    sanitized,
    ...loadRecentExploreRoutes(profileKey).filter((candidate) => candidate.id !== sanitized.id),
  ].slice(0, recentExploreRouteLimit);
  try {
    window.localStorage.setItem(storageKey(profileKey), JSON.stringify(nextRoutes));
  } catch {
    // Private browsing or storage pressure can disable recent-route persistence.
  }
  return nextRoutes;
}
