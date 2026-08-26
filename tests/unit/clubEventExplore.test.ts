import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  clubEventExploreIsServerControlled,
  clubEventExploreLaunch,
  prepareClubEventExploreConfiguration,
  sanitizeClubEventExploreRoute,
} from '../../src/lib/clubEventExplore';
import type { ClubEventLaunchPayload } from '../../src/lib/clubEvent';
import type { ExploreRoute } from '../../src/types';

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
  elevationSamples: [
    { distanceMeters: 0, elevationMeters: 100 },
    { distanceMeters: 1_000, elevationMeters: 125 },
  ],
  elevationGainMeters: 999,
  elevationLossMeters: 999,
  createdAt: 9_000,
};

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

describe('server-authored Club Event Explore routes', () => {
  it('resolves and builds the route before creating the owner event configuration', async () => {
    const resolveLocation = vi.fn(async (value: string) => value === 'Start query'
      ? { point: route.origin, label: route.originLabel }
      : { point: route.destination, label: route.destinationLabel });
    const buildRoute = vi.fn(async () => ({ ...route, privateToken: 'must-not-surface' } as ExploreRoute));

    const configuration = await prepareClubEventExploreConfiguration({
      origin: ' Start query ',
      destination: ' Finish query ',
      routeName: ' Four tablet ride ',
    }, resolveLocation, buildRoute);

    expect(resolveLocation).toHaveBeenCalledTimes(2);
    expect(buildRoute).toHaveBeenCalledWith({
      origin: route.origin,
      destination: route.destination,
      originLabel: route.originLabel,
      destinationLabel: route.destinationLabel,
      travelMode: 'bicycle',
      routeName: route.name,
    });
    expect(configuration).toEqual({
      origin: route.originLabel,
      destination: route.destinationLabel,
      routeName: route.name,
      routeId: route.id,
      route: {
        ...route,
        elevationGainMeters: 25,
        elevationLossMeters: 0,
      },
    });
    expect(configuration.route).not.toHaveProperty('privateToken');

    const consoleSource = readFileSync(
      new URL('../../src/components/ClubEventConsole.tsx', import.meta.url),
      'utf8',
    );
    expect(consoleSource.indexOf('await prepareClubEventExploreConfiguration('))
      .toBeLessThan(consoleSource.indexOf('await createClubEvent(activityType, configuration)'));
  });

  it('rejects invalid or non-bicycle snapshots and locks controls for malformed Explore launches', () => {
    expect(sanitizeClubEventExploreRoute({ ...route, travelMode: 'drive' })).toBeNull();
    expect(sanitizeClubEventExploreRoute({ ...route, encodedPolyline: '' })).toBeNull();
    expect(clubEventExploreLaunch(launch({ routeId: 'wrong-route', route }))).toBeNull();
    expect(clubEventExploreIsServerControlled(launch({}))).toBe(true);
    expect(clubEventExploreIsServerControlled(null)).toBe(false);
  });

  it('consumes the canonical server snapshot and timestamp on the tablet', () => {
    expect(clubEventExploreLaunch(launch({
      origin: route.originLabel,
      destination: route.destinationLabel,
      routeName: route.name,
      routeId: route.id,
      route,
    }))).toEqual({
      eventId: 'event-one',
      startAt: 10_000,
      route: {
        ...route,
        elevationGainMeters: 25,
        elevationLossMeters: 0,
      },
    });
  });

  it('does not let a Club Tablet build, publish, or start a coach Explore route', () => {
    const source = readFileSync(new URL('../../src/components/ExploreView.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('buildClubEventExploreRoute');
    expect(source).not.toContain('clubEventExploreStartControlDelayMs');
    expect(source).toContain('roomClubEventRoute ?? clubExploreEvent?.route ?? null');
    expect(source.match(/if \(serverControlledExplore\) return;/g)).toHaveLength(4);
    expect(source).toContain('{!serverControlledExplore && (');
  });

  it('waits for the Explore UI and starts from the corrected server clock without blocking on audio', () => {
    const exploreSource = readFileSync(new URL('../../src/components/ExploreView.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

    expect(exploreSource).toContain('(session.startedAt ?? Date.now()) - multiplayerClockOffsetMs');
    expect(exploreSource).toContain('void primeBikeRaceAudio();');
    expect(exploreSource).not.toContain('primeBikeRaceAudio().then(() => startLocalRide');
    expect(exploreSource).toContain('onClubEventProgramReady?.(clubExploreEvent.eventId)');
    expect(appSource).toContain('clubEventProgramReadyId !== eventId');
    expect(appSource).toContain('onClubEventProgramReady: setClubEventProgramReadyId');
  });

  it('clears a finished tablet athlete before beginning network cleanup', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const handoff = appSource.slice(
      appSource.indexOf('const handleClubTabletExerciseSaved'),
      appSource.indexOf('clubTabletExerciseSavedRef.current = handleClubTabletExerciseSaved'),
    );
    expect(handoff.indexOf('handleClubTabletSessionChange(null)')).toBeGreaterThan(-1);
    expect(handoff.indexOf('handleClubTabletSessionChange(null)'))
      .toBeLessThan(handoff.indexOf('void Promise.all(['));
  });
});
