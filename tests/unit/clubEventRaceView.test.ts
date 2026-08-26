import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clubEventLobbyNeedsRaceViews,
  clubEventRaceViewForCourse,
  type ClubEventCourseOption,
} from '../../src/components/ClubEventConsole';
import type { TrackRecord } from '../../src/types';

function courseTrack(name: string, countryCode = 'CUSTOM'): TrackRecord {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    country: countryCode === 'CUSTOM' ? 'Custom Routes' : 'United States',
    countryCode,
    state: 'California',
    region: 'North America',
    source: 'TrackLab',
    sourceUrl: 'local://club-event-test',
    lengthMeters: 457.2,
    elevationMeters: 0,
    surface: 'dirt',
    outline: [
      { lat: 38.42, lng: -122.7 },
      { lat: 38.421, lng: -122.699 },
    ],
    centerline: [
      { lat: 38.42, lng: -122.7 },
      { lat: 38.421, lng: -122.699 },
    ],
    routeStatus: 'user-mapped',
    zones: [],
    leaderboards: { rpm: [], speed: [] },
  };
}

describe('Club Event owner race view', () => {
  it('keeps the complete BMX event camera in the owner-authored snapshot', () => {
    const camera = {
      angle: 17,
      heading: 271,
      center: { lat: 38.4207, lng: -122.6994 },
      zoom: 20.25,
    };
    const course: ClubEventCourseOption = {
      id: 'saved-bmx-track',
      name: 'Saved BMX Track',
      track: { ...courseTrack('Saved BMX Track', 'US'), id: 'saved-bmx-track' },
      raceView: { mode: '3d', camera },
    };

    expect(clubEventRaceViewForCourse(course, '3d')).toEqual({ mode: '3d', camera });
  });

  it('waits for cold-start camera hydration before opening a race or sprint lobby', () => {
    expect(clubEventLobbyNeedsRaceViews('bmx-race', false)).toBe(true);
    expect(clubEventLobbyNeedsRaceViews('straight-sprint', false)).toBe(true);
    expect(clubEventLobbyNeedsRaceViews('explore', false)).toBe(false);
    expect(clubEventLobbyNeedsRaceViews('bmx-race', true)).toBe(false);
  });

  it('uses the selected Sprint distance camera before the base saved camera', () => {
    const course: ClubEventCourseOption = {
      id: 'my-dragstrip',
      name: 'My Dragstrip',
      track: { ...courseTrack('My Dragstrip'), id: 'my-dragstrip' },
      raceView: {
        mode: 'satellite',
        camera: { angle: 10, heading: 20, center: { lat: 38.42, lng: -122.7 }, zoom: 16 },
      },
      sprintRaceViewCamerasByDistance: {
        300: { angle: 47, heading: 90, center: { lat: 38.421, lng: -122.699 }, zoom: 19 },
      },
    };

    expect(clubEventRaceViewForCourse(course, '3d', 300)).toEqual({
      mode: '3d',
      camera: { angle: 47, heading: 90, center: { lat: 38.421, lng: -122.699 }, zoom: 19 },
    });
    expect(clubEventRaceViewForCourse(course, 'satellite', 500)).toEqual({
      mode: 'satellite',
      camera: { angle: 10, heading: 20, center: { lat: 38.42, lng: -122.7 }, zoom: 16 },
    });
  });

  it('keeps the event snapshot immutable through map initialization and fullscreen relayouts', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const earthViewSource = readFileSync(new URL('../../src/components/EarthTrackView.tsx', import.meta.url), 'utf8');
    const map3DSource = readFileSync(new URL('../../src/components/GoogleMaps3DTrackLayer.tsx', import.meta.url), 'utf8');
    const satelliteSource = readFileSync(new URL('../../src/components/GoogleMapsTrackLayer.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('raceCameraSnapshot={clubEventRaceCamera}');
    expect(earthViewSource).toContain('const presentedEarthAngle = raceCameraImmutable');
    expect(appSource).toContain('raceCameraImmutable={clubEventRaceViewApplies}');
    expect(earthViewSource).toContain('cameraLocked={raceCameraImmutable || (');
    expect(map3DSource).toContain('if (cameraLockedRef.current) {');
    expect(map3DSource).toContain('if (cameraLockedRef.current) return;');
    expect(map3DSource).toContain("observer.observe(container);");
    expect(satelliteSource).toContain('const raceCameraInputLocked = cameraLocked;');
    expect(satelliteSource).toContain('cameraForTrack(latest.camera, latest.track, latest.cameraLocked)');
    expect(satelliteSource).toContain('cameraForTrack(cameraRef.current, track, cameraLocked)');
    expect(appSource).toContain('if (clubEventConfigurationLocked) {\n        return current;');
  });

  it('does not clamp or recenter an exact saved race camera in 3D', () => {
    const source = readFileSync(new URL('../../src/components/EarthTrackView.tsx', import.meta.url), 'utf8');
    const raceCameraStart = source.indexOf('const race3DCamera = {');
    const activeCameraStart = source.indexOf('const active3DCamera', raceCameraStart);
    const raceCameraSource = source.slice(raceCameraStart, activeCameraStart);

    expect(raceCameraSource).toContain('angle: presentedEarthAngle');
    expect(raceCameraSource).toContain('center: presentedEarthCenter');
    expect(raceCameraSource).not.toContain('Math.max');
    expect(raceCameraSource).not.toContain('mapping3DSafeCenter');
  });

  it('offers a camera-free Game Arena only for an eligible custom Dragstrip', () => {
    const dragstrip: ClubEventCourseOption = {
      id: 'my-dragstrip',
      name: 'My Dragstrip',
      track: { ...courseTrack('My Dragstrip'), id: 'my-dragstrip' },
      raceView: { mode: 'satellite', camera: { angle: 20, heading: 40 } },
    };
    const ordinaryTrack: ClubEventCourseOption = {
      ...dragstrip,
      id: 'lasalle-college',
      name: 'LaSalle College',
      track: { ...courseTrack('LaSalle College', 'US'), id: 'lasalle-college' },
    };

    expect(clubEventRaceViewForCourse(dragstrip, 'game', 300)).toEqual({ mode: 'game' });
    expect(clubEventRaceViewForCourse(ordinaryTrack, 'game', 300)).toEqual({
      mode: 'satellite',
      camera: { angle: 20, heading: 40 },
    });
  });

  it('keeps Sprint venue selection outside the developer-only create/delete gate', () => {
    const source = readFileSync(
      new URL('../../src/components/SessionControlPanel.tsx', import.meta.url),
      'utf8',
    );
    const adminCreate = source.indexOf('{isAdminProfile && showCustomRoutes && (');
    const venueSelection = source.indexOf('{showCustomRoutes && (', adminCreate + 1);
    const sprintSetup = source.indexOf('{showCustomRoutes && sessionTrackAvailable && (');
    expect(adminCreate).toBeGreaterThan(-1);
    expect(venueSelection).toBeGreaterThan(adminCreate);
    expect(venueSelection).toBeLessThan(sprintSetup);
    expect(source.slice(venueSelection, sprintSetup)).toContain('Saved Straight Sprint venues');
    expect(source.slice(venueSelection, sprintSetup)).toContain('{isAdminProfile && (isPendingDelete ? (');
  });

  it('keeps the active private Sprint snapshot visible in the locked tablet venue list', () => {
    const source = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("clubEventLaunch?.activityType !== 'straight-sprint' || !clubEventTrack");
    expect(source).toContain('{ track: clubEventTrack, course: clubEventTrack, mapping: undefined }');
    expect(source).toContain('customRoutes={straightSprintVenueCourses.map(({ course }) => course)}');
  });
});
