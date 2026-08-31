import { expect, test, type Page } from '@playwright/test';
import type {
  RaceViewPreferences,
  TrackRecord,
  UserTrackMapping,
} from '../../src/types';

type CameraSnapshot = RaceViewPreferences['earthCamerasByTrack'][string];

const laSalleTrackId = 'custom-la-salle-university';
const nelsonRoadTrackId = 'custom-nelson-road';
const laSalleCameraKey = `${laSalleTrackId}:sprint:100ft`;
const nelsonRoadCameraKey = `${nelsonRoadTrackId}:sprint:100ft`;

function customSprintTrack(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
): TrackRecord {
  return {
    id,
    name,
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'California',
    region: 'California',
    source: 'Custom',
    sourceUrl: `local://${id}`,
    address: `${name}, California`,
    latitude,
    longitude,
    lengthMeters: 500,
    elevationMeters: 0,
    surface: 'Custom sprint route',
    outline: [
      { lat: latitude, lng: longitude },
      { lat: latitude + 0.004, lng: longitude },
    ],
    routeStatus: 'user-mapped',
    zones: [],
    leaderboards: { rpm: [], speed: [] },
  };
}

function customSprintMapping(track: TrackRecord): UserTrackMapping {
  const centerline = track.outline.slice(0, 2);
  return {
    version: 1,
    trackId: track.id,
    trackName: track.name,
    country: track.country,
    state: track.state,
    savedAt: '2026-08-30T12:00:00.000Z',
    routeStatus: 'user-mapped',
    restAfterSeconds: 1,
    lengthMeters: 500,
    centerline,
    startGate: centerline[0],
    finishLine: centerline[1],
    zoneBoundaryMeters: [],
    zoneBoundarySets: [],
    zones: [],
    splitSections: [],
    raceViewMode: 'satellite',
  };
}

function raceViewPreferences(
  laSalleCamera: CameraSnapshot,
  nelsonRoadCamera: CameraSnapshot,
): RaceViewPreferences {
  return {
    cameraLocked: true,
    cameraLockedUpdatedAt: 1_000,
    earthCamerasByTrack: {
      [laSalleTrackId]: {
        angle: 9,
        heading: 19,
        center: { lat: 37.401, lng: -121.899 },
        zoom: 17,
        updatedAt: 900,
      },
      [laSalleCameraKey]: laSalleCamera,
      [nelsonRoadTrackId]: {
        angle: 11,
        heading: 21,
        center: { lat: 38.401, lng: -121.999 },
        zoom: 17.5,
        updatedAt: 901,
      },
      [nelsonRoadCameraKey]: nelsonRoadCamera,
    },
    riderOverlaysByTrack: {},
    riderOverlayUpdatedAtByTrack: {},
    demoRiderNames: {},
    demoRiderNamesUpdatedAt: 1_000,
    demoRiderPhotos: {},
    demoRiderPhotosUpdatedAt: 1_000,
    commentary: {
      enabled: true,
      ambientEnabled: true,
      ambientVolume: 0.065,
      ambientVolumeLocked: true,
      voicePreset: 'american-man',
      volume: 1,
      adaptiveMemory: true,
      recentLines: [],
    },
    commentaryUpdatedAt: 1_000,
  };
}

async function enterSavedCameraEditor(page: Page, trackName: string) {
  const venue = page.locator('.custom-route-open').filter({ hasText: trackName });
  await expect(venue).toBeVisible();
  await venue.click();
  await expect(venue).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Edit map', exact: true }).click();
  await page.getByRole('button', { name: 'Full screen editing', exact: true }).click();
  await expect(page.locator('.platform-shell')).toHaveClass(/map-fullscreen/);
  await expect(page.getByRole('button', { name: 'Unlock saved view', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tilt map up', exact: true })).toBeDisabled();
}

async function adjustAndPublishSavedCamera(page: Page) {
  await page.getByRole('button', { name: 'Unlock saved view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save and publish view', exact: true })).toBeVisible();
  const tiltUp = page.getByRole('button', { name: 'Tilt map up', exact: true });
  await expect(tiltUp).toBeEnabled();
  await tiltUp.click();

  const referenceViewport = await page.locator('.earth-stage').evaluate((stage) => ({
    width: stage.clientWidth,
    height: stage.clientHeight,
  }));
  await page.getByRole('button', { name: 'Save and publish view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock saved view', exact: true })).toBeVisible();

  return referenceViewport;
}

async function leaveSavedCameraEditor(page: Page) {
  await page.getByRole('button', { name: 'Exit full screen editing', exact: true }).click();
  await page.locator('.mapping-section').getByRole('button', { name: 'View', exact: true }).click();
}

function expectOnlyCameraKeyChanged(
  before: RaceViewPreferences,
  after: RaceViewPreferences,
  changedKey: string,
) {
  expect(Object.keys(after.earthCamerasByTrack).sort()).toEqual(
    Object.keys(before.earthCamerasByTrack).sort(),
  );
  for (const [key, camera] of Object.entries(before.earthCamerasByTrack)) {
    if (key !== changedKey) expect(after.earthCamerasByTrack[key]).toEqual(camera);
  }
}

test('publishes independent 100 ft saved cameras for La Salle University and Nelson Road', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 1024 });

  const laSalleTrack = customSprintTrack(
    laSalleTrackId,
    'La Salle University',
    37.4,
    -121.9,
  );
  const nelsonRoadTrack = customSprintTrack(
    nelsonRoadTrackId,
    'Nelson Road',
    38.4,
    -122,
  );
  const tracks = [laSalleTrack, nelsonRoadTrack];
  const mappings = Object.fromEntries(tracks.map((track) => [track.id, customSprintMapping(track)]));
  const initialLaSalleCamera: CameraSnapshot = {
    angle: 31,
    heading: 97,
    center: { lat: 37.401, lng: -121.9 },
    zoom: 19.25,
    referenceViewport: { width: 1_366, height: 1_024 },
    updatedAt: 950,
  };
  const initialNelsonRoadCamera: CameraSnapshot = {
    angle: 46,
    heading: 184,
    center: { lat: 38.401, lng: -122 },
    zoom: 18.75,
    referenceViewport: { width: 1_024, height: 768 },
    updatedAt: 960,
  };
  const initialPreferences = raceViewPreferences(initialLaSalleCamera, initialNelsonRoadCamera);
  let cloudPreferences = structuredClone(initialPreferences);
  let globalPreferences = structuredClone(cloudPreferences);
  const globalPatches: RaceViewPreferences[] = [];

  await page.addInitScript(({ customTracks, trackMappings }) => {
    window.localStorage.setItem('tracklab-bmx-custom-routes-v1', JSON.stringify(customTracks));
    window.localStorage.setItem('tracklab:user-track-mappings:v1', JSON.stringify(trackMappings));
  }, { customTracks: tracks, trackMappings: mappings });

  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'custom-camera-admin',
          profileKey: 'user:custom-camera-admin',
          email: 'preskiranch@gmail.com',
          name: 'Custom Camera Admin',
          admin: true,
          membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
        },
      }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as { raceViewPreferences?: RaceViewPreferences };
      if (patch.raceViewPreferences) cloudPreferences = patch.raceViewPreferences;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: mappings,
        customRoutes: tracks,
        bikeProfiles: [],
        studioRiders: [],
        raceViewPreferences: cloudPreferences,
      }),
    });
  });
  await page.route('**/api/public-track-mappings*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: mappings, count: tracks.length }),
    });
  });
  await page.route('**/api/public-custom-routes*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ customRoutes: tracks, count: tracks.length }),
    });
  });
  await page.route('**/api/global-race-view', async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON() as { raceViewPreferences: RaceViewPreferences };
      globalPatches.push(structuredClone(payload.raceViewPreferences));
      globalPreferences = payload.raceViewPreferences;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ raceViewPreferences: globalPreferences }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ghosts: [] }) });
  });
  await page.route('**/api/multiplayer/leaderboards*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rpm: [], speed: [] }) });
  });

  await page.goto(`/?track=${laSalleTrackId}`);
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.locator('.platform-topbar').getByText('Straight Sprint', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sprint distance')).toHaveValue('100');

  await enterSavedCameraEditor(page, laSalleTrack.name);
  const laSalleViewport = await adjustAndPublishSavedCamera(page);
  await expect.poll(() => globalPatches.length).toBe(1);
  const firstPatch = globalPatches[0];
  expect(firstPatch.earthCamerasByTrack[laSalleCameraKey]).toMatchObject({
    angle: initialLaSalleCamera.angle + 5,
    heading: initialLaSalleCamera.heading,
    referenceViewport: laSalleViewport,
  });
  expectOnlyCameraKeyChanged(initialPreferences, firstPatch, laSalleCameraKey);
  await leaveSavedCameraEditor(page);

  await enterSavedCameraEditor(page, nelsonRoadTrack.name);
  const nelsonRoadViewport = await adjustAndPublishSavedCamera(page);
  await expect.poll(() => globalPatches.length).toBe(2);
  const secondPatch = globalPatches[1];
  expect(secondPatch.earthCamerasByTrack[nelsonRoadCameraKey]).toMatchObject({
    angle: initialNelsonRoadCamera.angle + 5,
    heading: initialNelsonRoadCamera.heading,
    referenceViewport: nelsonRoadViewport,
  });
  expect(secondPatch.earthCamerasByTrack[laSalleCameraKey]).toEqual(
    firstPatch.earthCamerasByTrack[laSalleCameraKey],
  );
  expectOnlyCameraKeyChanged(firstPatch, secondPatch, nelsonRoadCameraKey);
});
