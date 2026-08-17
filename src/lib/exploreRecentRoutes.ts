import type {
  ExploreElevationSample,
  ExploreRoute,
  ExploreRouteWaypoint,
  TrackPoint,
} from '../types';

const recentExploreRouteLimit = 8;
const recentExploreRoutesStoragePrefix = 'tracklab-explore-recent-routes-v1';
const clubTabletExploreRouteScopePrefix = 'club-tablet-route-history-v1:';

export type ExploreRecentRouteHistoryScope = {
  profileKey: string | null;
  cloudEnabled: boolean;
};

export function resolveExploreRecentRouteHistoryScope({
  accountProfileKey,
  accountCloudEnabled,
  kioskMode,
  clubTabletDeviceId,
  studioRiderId,
}: {
  accountProfileKey: string;
  accountCloudEnabled: boolean;
  kioskMode: boolean;
  clubTabletDeviceId?: string | null;
  studioRiderId?: string | null;
}): ExploreRecentRouteHistoryScope {
  if (kioskMode) {
    const deviceId = clubTabletDeviceId?.trim() ?? '';
    const athleteId = studioRiderId?.trim() ?? '';
    if (!deviceId || !athleteId) {
      return { profileKey: null, cloudEnabled: false };
    }
    return {
      profileKey: `${clubTabletExploreRouteScopePrefix}${encodeURIComponent(deviceId)}:${encodeURIComponent(athleteId)}`,
      cloudEnabled: false,
    };
  }

  const profileKey = accountProfileKey.trim();
  return {
    profileKey: profileKey || null,
    cloudEnabled: Boolean(profileKey && accountCloudEnabled),
  };
}

function storageKey(profileKey: string) {
  if (profileKey.startsWith(clubTabletExploreRouteScopePrefix)) {
    // Device and studio-rider ids are already component-encoded above. Keep
    // this scope byte-for-byte so two athletes on a shared tablet can never
    // collapse into the same local history key.
    return `${recentExploreRoutesStoragePrefix}:${profileKey}`;
  }
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

export function sanitizeRecentExploreRoute(value: unknown): ExploreRoute | null {
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
  const waypoints = Array.isArray(route.waypoints)
    ? route.waypoints.flatMap((value): ExploreRouteWaypoint[] => {
      const waypoint = value as Partial<ExploreRouteWaypoint> | null;
      if (!waypoint || !validPoint(waypoint.point)) {
        return [];
      }
      return [{ point: waypoint.point, label: String(waypoint.label || 'Route waypoint').slice(0, 160) }];
    }).slice(0, 10)
    : [];
  return {
    id: route.id.slice(0, 96),
    ...(route.name ? { name: String(route.name).slice(0, 80) } : {}),
    origin: route.origin,
    destination: route.destination,
    originLabel: String(route.originLabel || 'Selected start').slice(0, 160),
    destinationLabel: String(route.destinationLabel || 'Selected destination').slice(0, 160),
    travelMode: route.travelMode === 'drive' ? 'drive' : 'bicycle',
    distanceMeters,
    durationSeconds,
    encodedPolyline,
    ...(waypoints.length > 0 ? { waypoints } : {}),
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
        const sanitized = sanitizeRecentExploreRoute(route);
        return sanitized ? [sanitized] : [];
      })
      .slice(0, recentExploreRouteLimit);
  } catch {
    return [];
  }
}

export function rememberRecentExploreRoute(profileKey: string, route: ExploreRoute) {
  const sanitized = sanitizeRecentExploreRoute(route);
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

export function sanitizeRecentExploreRoutes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  return value
    .flatMap((route) => {
      const sanitized = sanitizeRecentExploreRoute(route);
      if (!sanitized || seen.has(sanitized.id)) {
        return [];
      }
      seen.add(sanitized.id);
      return [sanitized];
    })
    .slice(0, recentExploreRouteLimit);
}

export function mergeRecentExploreRoutes(
  preferred: readonly ExploreRoute[],
  fallback: readonly ExploreRoute[],
) {
  return sanitizeRecentExploreRoutes([...preferred, ...fallback]);
}

export function writeRecentExploreRoutes(profileKey: string, routes: readonly ExploreRoute[]) {
  const nextRoutes = sanitizeRecentExploreRoutes(routes);
  try {
    window.localStorage.setItem(storageKey(profileKey), JSON.stringify(nextRoutes));
  } catch {
    // Private browsing or storage pressure can disable the offline cache.
  }
  return nextRoutes;
}
