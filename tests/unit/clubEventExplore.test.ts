import { describe, expect, it, vi } from 'vitest';
import {
  buildClubEventExploreRoute,
  clubEventExplorePlan,
  clubEventExploreStartControlDelayMs,
} from '../../src/lib/clubEventExplore';
import type { ClubEventLaunchPayload } from '../../src/lib/clubEvent';
import type { ExploreRoute } from '../../src/types';

function launch(configuration: Record<string, unknown> = {}): ClubEventLaunchPayload {
  return {
    eventId: 'event-one',
    clubId: 'club-one',
    activityType: 'explore',
    program: 'explore',
    configuration,
    startAt: 10_000,
    seatNumber: 1,
    studioRiderId: 'rider-one',
    bikeDeviceId: 101,
  };
}

describe('coach-led Explore event orchestration', () => {
  it('normalizes the coach route while rejecting incomplete and non-Explore launches', () => {
    expect(clubEventExplorePlan(launch({
      origin: '  Preski Ranch  ',
      destination: '  Olympic BMX Track  ',
      routeName: '  Tuesday club ride  ',
    }))).toEqual({
      eventId: 'event-one',
      startAt: 10_000,
      origin: 'Preski Ranch',
      destination: 'Olympic BMX Track',
      routeName: 'Tuesday club ride',
    });
    expect(clubEventExplorePlan(launch({ origin: 'Preski Ranch' }))).toBeNull();
    expect(clubEventExplorePlan({
      ...launch({ origin: 'A', destination: 'B' }),
      activityType: 'bmx-race',
      program: 'race',
    })).toBeNull();
  });

  it('resolves the shared endpoints once and builds one bicycle route for the room host to publish', async () => {
    const plan = clubEventExplorePlan(launch({
      origin: 'Start query',
      destination: 'Finish query',
      routeName: 'Four tablet ride',
    }))!;
    const resolveLocation = vi.fn(async (value: string) => value === 'Start query'
      ? { point: { lat: 34.1, lng: -118.2 }, label: 'Resolved start' }
      : { point: { lat: 34.2, lng: -118.3 }, label: 'Resolved finish' });
    const route: ExploreRoute = {
      id: 'route-one',
      name: 'Four tablet ride',
      origin: { lat: 34.1, lng: -118.2 },
      destination: { lat: 34.2, lng: -118.3 },
      originLabel: 'Resolved start',
      destinationLabel: 'Resolved finish',
      travelMode: 'bicycle',
      distanceMeters: 1_000,
      durationSeconds: 240,
      encodedPolyline: 'shared-polyline',
      createdAt: 9_000,
    };
    const buildRoute = vi.fn(async () => route);

    await expect(buildClubEventExploreRoute(plan, resolveLocation, buildRoute)).resolves.toBe(route);
    expect(resolveLocation).toHaveBeenCalledTimes(2);
    expect(buildRoute).toHaveBeenCalledWith({
      origin: { lat: 34.1, lng: -118.2 },
      destination: { lat: 34.2, lng: -118.3 },
      originLabel: 'Resolved start',
      destinationLabel: 'Resolved finish',
      travelMode: 'bicycle',
      routeName: 'Four tablet ride',
    });
  });

  it('sends the host start command 800 ms before the coach timestamp and starts immediately if late', () => {
    expect(clubEventExploreStartControlDelayMs(10_000, 7_000)).toBe(2_200);
    expect(clubEventExploreStartControlDelayMs(10_000, 9_500)).toBe(0);
  });
});
