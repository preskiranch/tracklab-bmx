import { expect, test, type Page } from '@playwright/test';
import type {
  RaceViewPreferences,
  TrackRecord,
  UserTrackMapping,
} from '../../src/types';

type CameraSnapshot = RaceViewPreferences['earthCamerasByTrack'][string];
type RiderOverlaySnapshot = RaceViewPreferences['riderOverlaysByTrack'][string];

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
  await expect(page.getByLabel('Player card layout preview')).toBeHidden();
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

async function resizeAndPublishPlayerCards(
  page: Page,
  delta: { width: number; height: number },
  beforePublish?: () => Promise<void> | void,
) {
  await page.getByRole('button', { name: 'Edit player cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit player cards', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');

  const overlay = page.getByLabel('Player card layout preview');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Player 4', { exact: true })).toBeVisible();
  const editorLayering = await page.evaluate(() => ({
    overlay: Number.parseInt(getComputedStyle(document.querySelector('.race-rider-overlay')!).zIndex, 10),
    toolbar: Number.parseInt(getComputedStyle(document.querySelector('.map-edit-toolbar')!).zIndex, 10),
  }));
  expect(editorLayering.toolbar).toBeGreaterThan(editorLayering.overlay);
  const before = await overlay.boundingBox();
  expect(before).not.toBeNull();

  await page.getByRole('button', { name: 'Resize cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save and publish player cards', exact: true }))
    .toBeVisible();
  const saveButton = page.getByRole('button', { name: 'Save and publish player cards', exact: true });
  const saveButtonBox = await saveButton.boundingBox();
  expect(saveButtonBox).not.toBeNull();
  expect(saveButtonBox!.height).toBeGreaterThanOrEqual(44);
  const resizeGrip = page.getByRole('button', { name: 'Resize rider overlay', exact: true });
  await expect(resizeGrip).toBeVisible();
  const grip = await resizeGrip.boundingBox();
  expect(grip).not.toBeNull();
  expect(grip!.width).toBeGreaterThanOrEqual(44);
  expect(grip!.height).toBeGreaterThanOrEqual(44);

  await page.mouse.move(grip!.x + (grip!.width / 2), grip!.y + (grip!.height / 2));
  await page.mouse.down();
  await page.mouse.move(
    // Edit Map exposes a bottom-left grip. Moving the left edge right makes
    // the panel narrower; moving it left makes the panel wider.
    grip!.x + (grip!.width / 2) - delta.width,
    grip!.y + (grip!.height / 2) + delta.height,
    { steps: 8 },
  );
  await page.mouse.up();

  const after = await overlay.boundingBox();
  expect(after).not.toBeNull();
  if (delta.width < 0) expect(after!.width).toBeLessThan(before!.width - 30);
  if (delta.width > 0) expect(after!.width).toBeGreaterThan(before!.width + 30);
  if (delta.height < 0) expect(after!.height).toBeLessThan(before!.height - 20);
  if (delta.height > 0) expect(after!.height).toBeGreaterThan(before!.height + 20);

  // The authored pixel geometry is keyed to the viewport where the drag
  // finished, not whichever orientation happens to be active when Save is
  // pressed a moment later.
  const referenceViewport = await page.locator('.earth-stage').evaluate((stage) => ({
    width: stage.clientWidth,
    height: stage.clientHeight,
  }));
  await beforePublish?.();
  await page.getByRole('button', { name: 'Save and publish player cards', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resize cards', exact: true })).toBeVisible();
  await expect(overlay.getByRole('status')).toHaveText('Published to every device');

  return { before: before!, after: after!, referenceViewport };
}

async function expectPlayerCardsInsideStage(page: Page, maximumHeightRatio: number) {
  const stage = await page.locator('.earth-stage').boundingBox();
  const overlay = await page.getByLabel('Player card layout preview').boundingBox();
  expect(stage).not.toBeNull();
  expect(overlay).not.toBeNull();
  expect(overlay!.x).toBeGreaterThanOrEqual(stage!.x - 1);
  expect(overlay!.y).toBeGreaterThanOrEqual(stage!.y - 1);
  expect(overlay!.x + overlay!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
  expect(overlay!.y + overlay!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
  expect(overlay!.height).toBeLessThanOrEqual((stage!.height * maximumHeightRatio) + 1);
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

test('resizes and publishes independent player cards that fit iPad and iPhone orientations', async ({ page }) => {
  test.setTimeout(120_000);
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
    referenceViewport: { width: 1366, height: 1024 },
    updatedAt: 950,
  };
  const initialNelsonRoadCamera: CameraSnapshot = {
    angle: 46,
    heading: 184,
    center: { lat: 38.401, lng: -122 },
    zoom: 18.75,
    referenceViewport: { width: 1366, height: 1024 },
    updatedAt: 960,
  };
  const legacyLaSalleOverlay: RiderOverlaySnapshot = {
    xPct: 0.03,
    yPct: 0.68,
    width: 1180,
    height: 300,
    locked: true,
    referenceViewport: { width: 1366, height: 1024 },
  };
  const initialLaSalleOverlay: RiderOverlaySnapshot = {
    xPct: 0.05,
    yPct: 0.69,
    width: 1020,
    height: 280,
    locked: true,
    referenceViewport: { width: 1366, height: 1024 },
  };
  const initialNelsonRoadOverlay: RiderOverlaySnapshot = {
    xPct: 0.08,
    yPct: 0.72,
    width: 720,
    height: 210,
    locked: true,
    referenceViewport: { width: 1366, height: 1024 },
  };
  const initialPreferences: RaceViewPreferences = {
    ...raceViewPreferences(initialLaSalleCamera, initialNelsonRoadCamera),
    riderOverlaysByTrack: {
      [laSalleTrackId]: legacyLaSalleOverlay,
      [laSalleCameraKey]: initialLaSalleOverlay,
      [nelsonRoadCameraKey]: initialNelsonRoadOverlay,
    },
    riderOverlayUpdatedAtByTrack: {
      [laSalleTrackId]: 800,
      [laSalleCameraKey]: 980,
      [nelsonRoadCameraKey]: 990,
    },
  };
  let cloudPreferences = structuredClone(initialPreferences);
  let globalPreferences = structuredClone(initialPreferences);
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
          id: 'custom-card-admin',
          profileKey: 'user:custom-card-admin',
          email: 'layout-admin@tracklab.test',
          name: 'Custom Card Admin',
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
  await expect(page.getByLabel('Sprint distance')).toHaveValue('100');

  await enterSavedCameraEditor(page, laSalleTrack.name);
  const laSalleResize = await resizeAndPublishPlayerCards(
    page,
    { width: -140, height: -140 },
    () => expect(globalPatches).toHaveLength(0),
  );
  await expect.poll(() => globalPatches.length).toBe(1);
  const savedLaSallePreferences = globalPatches[0];
  const savedLaSalleOverlay = savedLaSallePreferences.riderOverlaysByTrack[laSalleCameraKey];
  expect(savedLaSalleOverlay).toMatchObject({
    locked: true,
    referenceViewport: laSalleResize.referenceViewport,
  });
  expect(savedLaSalleOverlay.width).toBeLessThan(initialLaSalleOverlay.width - 30);
  expect(savedLaSalleOverlay.height).toBe(190);
  expect(savedLaSallePreferences.riderOverlaysByTrack[laSalleTrackId]).toEqual(legacyLaSalleOverlay);
  expect(savedLaSallePreferences.riderOverlaysByTrack[nelsonRoadCameraKey]).toEqual(initialNelsonRoadOverlay);
  await leaveSavedCameraEditor(page);

  await enterSavedCameraEditor(page, nelsonRoadTrack.name);
  const nelsonRoadResize = await resizeAndPublishPlayerCards(
    page,
    { width: 120, height: 50 },
    () => expect(globalPatches).toHaveLength(1),
  );
  await expect.poll(() => globalPatches.length).toBe(2);
  const savedNelsonPreferences = globalPatches[1];
  const savedNelsonOverlay = savedNelsonPreferences.riderOverlaysByTrack[nelsonRoadCameraKey];
  expect(savedNelsonOverlay).toMatchObject({
    locked: true,
    referenceViewport: nelsonRoadResize.referenceViewport,
  });
  expect(savedNelsonOverlay.width).toBeGreaterThan(initialNelsonRoadOverlay.width + 30);
  expect(savedNelsonOverlay.height).toBeGreaterThan(initialNelsonRoadOverlay.height + 20);
  expect(savedNelsonPreferences.riderOverlaysByTrack[laSalleCameraKey]).toEqual(savedLaSalleOverlay);

  await page.setViewportSize({ width: 844, height: 390 });
  await expectPlayerCardsInsideStage(page, 0.35);
  const landscapeResizeButton = await page
    .getByRole('button', { name: 'Resize cards', exact: true })
    .boundingBox();
  expect(landscapeResizeButton).not.toBeNull();
  expect(landscapeResizeButton!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPlayerCardsInsideStage(page, 0.34);
  const portraitResizeButton = await page
    .getByRole('button', { name: 'Resize cards', exact: true })
    .boundingBox();
  expect(portraitResizeButton).not.toBeNull();
  expect(portraitResizeButton!.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 1366, height: 1024 });
  await leaveSavedCameraEditor(page);
  await page.reload();
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible()) await openApp.click();
  await page.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.getByLabel('Sprint distance')).toHaveValue('100');

  await enterSavedCameraEditor(page, laSalleTrack.name);
  await page.getByRole('button', { name: 'Edit player cards', exact: true }).click();
  const reloadedLaSalle = await page.getByLabel('Player card layout preview').boundingBox();
  expect(reloadedLaSalle).not.toBeNull();
  expect(reloadedLaSalle!.width).toBeCloseTo(savedLaSalleOverlay.width, 0);
  expect(reloadedLaSalle!.height).toBeCloseTo(savedLaSalleOverlay.height, 0);
  await leaveSavedCameraEditor(page);

  await enterSavedCameraEditor(page, nelsonRoadTrack.name);
  await page.getByRole('button', { name: 'Edit player cards', exact: true }).click();
  const reloadedNelsonRoad = await page.getByLabel('Player card layout preview').boundingBox();
  expect(reloadedNelsonRoad).not.toBeNull();
  expect(reloadedNelsonRoad!.width).toBeCloseTo(savedNelsonOverlay.width, 0);
  expect(reloadedNelsonRoad!.height).toBeCloseTo(savedNelsonOverlay.height, 0);

  // Owners can author directly in iPhone landscape. The responsive clamp is
  // the authored result here, not a temporary rendering that may be discarded
  // when the pointer is released.
  await leaveSavedCameraEditor(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await enterSavedCameraEditor(page, nelsonRoadTrack.name);
  const phoneLandscapeResize = await resizeAndPublishPlayerCards(
    page,
    { width: 100, height: 0 },
    () => expect(globalPatches).toHaveLength(2),
  );
  await expect.poll(() => globalPatches.length).toBe(3);
  const phoneLandscapeOverlay = globalPatches[2].riderOverlaysByTrack[nelsonRoadCameraKey];
  expect(phoneLandscapeOverlay.referenceViewport).toEqual({ width: 844, height: 390 });
  expect(phoneLandscapeOverlay.width).toBeCloseTo(phoneLandscapeResize.after.width, 0);
  // Durable layouts retain the 190px authoring floor; the compact phone race
  // presentation clamps that authored height back to its 110-128px strip.
  expect(phoneLandscapeOverlay.height).toBe(190);
  await expectPlayerCardsInsideStage(page, 0.35);

  // Rotating after the drag must not re-key the iPad-authored pixel geometry
  // to the phone portrait viewport when Save is pressed.
  await leaveSavedCameraEditor(page);
  await page.setViewportSize({ width: 1366, height: 1024 });
  await enterSavedCameraEditor(page, laSalleTrack.name);
  const rotateBeforeSaveResize = await resizeAndPublishPlayerCards(
    page,
    { width: -80, height: 30 },
    async () => {
      expect(globalPatches).toHaveLength(3);
      await page.setViewportSize({ width: 390, height: 844 });
      await expectPlayerCardsInsideStage(page, 0.34);
    },
  );
  await expect.poll(() => globalPatches.length).toBe(4);
  const rotatedBeforeSaveOverlay = globalPatches[3].riderOverlaysByTrack[laSalleCameraKey];
  expect(rotatedBeforeSaveOverlay.referenceViewport).toEqual(
    rotateBeforeSaveResize.referenceViewport,
  );
  expect(rotatedBeforeSaveOverlay.referenceViewport).toEqual({ width: 1366, height: 1024 });
  expect(rotatedBeforeSaveOverlay.width).toBeCloseTo(rotateBeforeSaveResize.after.width, 0);
  expect(rotatedBeforeSaveOverlay.height).toBeCloseTo(rotateBeforeSaveResize.after.height, 0);
});
