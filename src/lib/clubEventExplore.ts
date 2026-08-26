import type { ExploreRoute, TrackPoint } from '../types';
import type { ClubEventLaunchPayload } from './clubEvent';

export type ClubEventExploreConfiguration = Readonly<{
  origin: string;
  destination: string;
  routeName: string;
  routeId: string;
  route: ExploreRoute;
}>;

export type ClubEventExploreLaunch = Readonly<{
  eventId: string;
  startAt: number;
  route: ExploreRoute;
}>;

type ClubEventExploreLocationResolver = (value: string) => Promise<{
  point: TrackPoint;
  label?: string;
}>;

type ClubEventExploreRouteBuilder = (request: Readonly<{
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: 'bicycle';
  routeName: string;
}>) => Promise<ExploreRoute>;

function text(value: unknown, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function explorePoint(value: unknown): TrackPoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const point = value as Partial<TrackPoint>;
  return typeof point.lat === 'number'
    && Number.isFinite(point.lat)
    && Math.abs(point.lat) <= 90
    && typeof point.lng === 'number'
    && Number.isFinite(point.lng)
    && Math.abs(point.lng) <= 180
    ? { lat: point.lat, lng: point.lng }
    : null;
}

/** Copies only the immutable bicycle-route fields accepted by Club Events. */
export function sanitizeClubEventExploreRoute(value: unknown): ExploreRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ExploreRoute>;
  const id = text(candidate.id, 96);
  const origin = explorePoint(candidate.origin);
  const destination = explorePoint(candidate.destination);
  const encodedPolyline = typeof candidate.encodedPolyline === 'string'
    ? candidate.encodedPolyline.trim()
    : '';
  const distanceMeters = Number(candidate.distanceMeters);
  const durationSeconds = Number(candidate.durationSeconds);
  if (
    !id
    || !origin
    || !destination
    || !encodedPolyline
    || encodedPolyline.length > 120_000
    || candidate.travelMode !== 'bicycle'
    || !Number.isFinite(distanceMeters)
    || distanceMeters <= 1
    || distanceMeters > 2_000_000
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || durationSeconds > 14 * 24 * 60 * 60
  ) return null;

  const waypoints = Array.isArray(candidate.waypoints)
    ? candidate.waypoints.flatMap((rawWaypoint) => {
      const point = explorePoint(rawWaypoint?.point);
      return point ? [{ point, label: text(rawWaypoint?.label, 160) || 'Route waypoint' }] : [];
    }).slice(0, 10)
    : [];
  const elevationSamples = Array.isArray(candidate.elevationSamples)
    ? candidate.elevationSamples.slice(0, 256).flatMap((rawSample) => {
      const sampleDistance = Number(rawSample?.distanceMeters);
      const elevationMeters = Number(rawSample?.elevationMeters);
      if (!Number.isFinite(sampleDistance) || !Number.isFinite(elevationMeters)) return [];
      return [{
        distanceMeters: Math.max(0, Math.min(distanceMeters, sampleDistance)),
        elevationMeters: Math.max(-500, Math.min(9_000, elevationMeters)),
      }];
    }).sort((left, right) => left.distanceMeters - right.distanceMeters)
      .filter((sample, index, samples) => (
        index === 0 || sample.distanceMeters > samples[index - 1].distanceMeters
      ))
    : [];
  let elevationGainMeters = 0;
  let elevationLossMeters = 0;
  for (let index = 1; index < elevationSamples.length; index += 1) {
    const delta = elevationSamples[index].elevationMeters - elevationSamples[index - 1].elevationMeters;
    if (delta > 0) elevationGainMeters += delta;
    else elevationLossMeters += Math.abs(delta);
  }

  return {
    id,
    ...(text(candidate.name, 80) ? { name: text(candidate.name, 80) } : {}),
    origin,
    destination,
    originLabel: text(candidate.originLabel, 160) || 'Selected start',
    destinationLabel: text(candidate.destinationLabel, 160) || 'Selected destination',
    travelMode: 'bicycle',
    distanceMeters,
    durationSeconds,
    encodedPolyline,
    ...(waypoints.length > 0 ? { waypoints } : {}),
    ...(elevationSamples.length >= 2 ? {
      elevationSamples,
      elevationGainMeters,
      elevationLossMeters,
    } : {}),
    createdAt: Number.isFinite(candidate.createdAt) && Number(candidate.createdAt) >= 0
      ? Number(candidate.createdAt)
      : Date.now(),
  };
}

/** Resolves and freezes the owner's route before the event is created. */
export async function prepareClubEventExploreConfiguration(
  input: Readonly<{ origin: string; destination: string; routeName: string }>,
  resolveLocation: ClubEventExploreLocationResolver,
  buildRoute: ClubEventExploreRouteBuilder,
): Promise<ClubEventExploreConfiguration> {
  const originQuery = text(input.origin, 240);
  const destinationQuery = text(input.destination, 240);
  const requestedName = text(input.routeName, 80) || 'Club Explore ride';
  if (!originQuery || !destinationQuery) {
    throw new Error('Enter the shared start and destination before opening the Explore lobby.');
  }
  if (originQuery.toLocaleLowerCase() === destinationQuery.toLocaleLowerCase()) {
    throw new Error('Choose two different locations for the Club Explore ride.');
  }

  const [resolvedOrigin, resolvedDestination] = await Promise.all([
    resolveLocation(originQuery),
    resolveLocation(destinationQuery),
  ]);
  const origin = explorePoint(resolvedOrigin.point);
  const destination = explorePoint(resolvedDestination.point);
  if (!origin || !destination || (origin.lat === destination.lat && origin.lng === destination.lng)) {
    throw new Error('Choose two different valid locations for the Club Explore ride.');
  }
  const rawRoute = await buildRoute({
    origin,
    destination,
    originLabel: text(resolvedOrigin.label, 160) || originQuery,
    destinationLabel: text(resolvedDestination.label, 160) || destinationQuery,
    travelMode: 'bicycle',
    routeName: requestedName,
  });
  const route = sanitizeClubEventExploreRoute({
    ...rawRoute,
    name: text(rawRoute.name, 80) || requestedName,
  });
  if (!route) throw new Error('Google returned an invalid Explore route. Choose different locations and try again.');
  return {
    origin: route.originLabel,
    destination: route.destinationLabel,
    routeName: route.name || requestedName,
    routeId: route.id,
    route,
  };
}

export function clubEventExploreLaunch(
  launch: ClubEventLaunchPayload | null | undefined,
): ClubEventExploreLaunch | null {
  if (!launch || launch.activityType !== 'explore' || !Number.isFinite(launch.startAt) || launch.startAt <= 0) {
    return null;
  }
  const route = sanitizeClubEventExploreRoute(launch.configuration.route);
  const routeId = text(launch.configuration.routeId, 96);
  return route && routeId === route.id
    ? { eventId: launch.eventId, startAt: launch.startAt, route }
    : null;
}

export function clubEventExploreIsServerControlled(
  launch: ClubEventLaunchPayload | null | undefined,
) {
  return launch?.activityType === 'explore';
}
