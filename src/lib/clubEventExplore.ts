import type { ExploreRoute, TrackPoint } from '../types';
import type { ClubEventLaunchPayload } from './clubEvent';

export type ClubEventExplorePlan = Readonly<{
  eventId: string;
  startAt: number;
  origin: string;
  destination: string;
  routeName: string;
}>;

type ResolvedExploreLocation = Readonly<{
  point: TrackPoint;
  label?: string;
}>;

type ExploreLocationResolver = (value: string) => Promise<ResolvedExploreLocation>;

type ClubEventExploreRouteBuilder = (request: Readonly<{
  origin: TrackPoint;
  destination: TrackPoint;
  originLabel: string;
  destinationLabel: string;
  travelMode: 'bicycle';
  routeName: string;
}>) => Promise<ExploreRoute>;

function configurationText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function clubEventExplorePlan(
  launch: ClubEventLaunchPayload | null | undefined,
): ClubEventExplorePlan | null {
  if (!launch || launch.activityType !== 'explore' || !Number.isFinite(launch.startAt) || launch.startAt <= 0) {
    return null;
  }
  const origin = configurationText(launch.configuration.origin, 240);
  const destination = configurationText(launch.configuration.destination, 240);
  if (!origin || !destination) return null;
  return {
    eventId: launch.eventId,
    startAt: Math.round(launch.startAt),
    origin,
    destination,
    routeName: configurationText(launch.configuration.routeName, 120) || 'Club Explore ride',
  };
}

export async function buildClubEventExploreRoute(
  plan: ClubEventExplorePlan,
  resolveLocation: ExploreLocationResolver,
  buildRoute: ClubEventExploreRouteBuilder,
) {
  const [origin, destination] = await Promise.all([
    resolveLocation(plan.origin),
    resolveLocation(plan.destination),
  ]);
  return buildRoute({
    origin: origin.point,
    destination: destination.point,
    originLabel: origin.label || plan.origin,
    destinationLabel: destination.label || plan.destination,
    travelMode: 'bicycle',
    routeName: plan.routeName,
  });
}

// Explore multiplayer starts 800 ms after the host's control message so every
// client can arm from the same server timestamp. Send just before the coach's
// requested start time, or immediately when route construction finishes late.
export function clubEventExploreStartControlDelayMs(startAt: number, now = Date.now()) {
  if (!Number.isFinite(startAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round(startAt - now - 800));
}
