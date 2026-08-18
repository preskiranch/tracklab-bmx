import { expect, test } from '@playwright/test';
import { WebSocket, WebSocketServer } from 'ws';

const ignoredConsoleFragments = [
  'Google Maps JavaScript API',
  "This page can't load Google Maps correctly",
  'Attempted to load a Vector Map, but failed. Falling back to Raster.',
  'Failed to load resource',
  'ws://127.0.0.1:',
  'ws://localhost:',
];

function silentWavBuffer(durationMs = 500) {
  const sampleRate = 8_000;
  const sampleCount = Math.ceil(sampleRate * durationMs / 1_000);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

const mockPedalZoneMapping = {
  version: 1,
  trackId: 'black-mountain-bmx',
  trackName: 'Black Mountain BMX',
  country: 'United States',
  state: 'Arizona',
  savedAt: '2026-07-09T00:00:00.000Z',
  routeStatus: 'user-mapped',
  restAfterSeconds: 1,
  lengthMeters: 120,
  centerline: [
    { lat: 33.7125, lng: -112.0667 },
    { lat: 33.7125, lng: -112.0659 },
    { lat: 33.7120, lng: -112.0659 },
    { lat: 33.7120, lng: -112.0667 },
  ],
  startGate: { lat: 33.7125, lng: -112.0667 },
  finishLine: { lat: 33.7120, lng: -112.0667 },
  zoneBoundaryMeters: [0, 30, 60, 90],
  zoneBoundarySets: [
    {
      id: 'default-pedal-zones',
      name: 'Default pedal zones',
      boundaryMeters: [0, 30, 60, 90],
    },
  ],
  zones: [
    {
      id: 'pedal-zone-1',
      name: 'Pedal Zone 1',
      startMeter: 0,
      endMeter: 30,
      type: 'pedal',
      restAfterSeconds: 1,
    },
    {
      id: 'pedal-zone-2',
      name: 'Pedal Zone 2',
      startMeter: 60,
      endMeter: 90,
      type: 'pedal',
      restAfterSeconds: 1,
    },
  ],
  splitSections: [],
};

const mockNoPedalZoneMapping = {
  ...mockPedalZoneMapping,
  savedAt: '2026-07-09T00:05:00.000Z',
  zoneBoundaryMeters: [],
  zoneBoundarySets: [],
  zones: [],
};

const mockPostRaceReviewMapping = {
  ...mockPedalZoneMapping,
  savedAt: '2026-07-09T00:10:00.000Z',
  lengthMeters: 25,
  centerline: [
    { lat: 33.7125, lng: -112.0667 },
    { lat: 33.7125, lng: -112.06661 },
    { lat: 33.712425, lng: -112.06661 },
    { lat: 33.712425, lng: -112.0667 },
  ],
  startGate: { lat: 33.7125, lng: -112.0667 },
  finishLine: { lat: 33.712425, lng: -112.0667 },
  zoneBoundaryMeters: [0, 25],
  zoneBoundarySets: [
    {
      id: 'default-pedal-zones',
      name: 'Default pedal zones',
      boundaryMeters: [0, 25],
    },
  ],
  zones: [
    {
      id: 'pedal-zone-1',
      name: 'Pedal Zone 1',
      startMeter: 0,
      endMeter: 25,
      type: 'pedal',
      restAfterSeconds: 0,
    },
  ],
};

const mockLoopMapping = {
  ...mockPedalZoneMapping,
  savedAt: '2026-07-11T12:00:00.000Z',
  lengthMeters: 220,
  centerline: [
    { lat: 33.7125, lng: -112.0667 },
    { lat: 33.7125, lng: -112.0659 },
    { lat: 33.7120, lng: -112.0659 },
    { lat: 33.7120, lng: -112.0667 },
    { lat: 33.7125, lng: -112.0667 },
  ],
  startGate: { lat: 33.7125, lng: -112.0667 },
  finishLine: { lat: 33.7125, lng: -112.0667 },
};

type MockBikeSampleOverrides = Partial<{
  at: number;
  source: string;
  deviceId: number;
  label: string;
  watts: number;
  cadence: number | null;
  speedKph: number | null;
  wattsAt: number;
  cadenceAt: number;
  speedAt: number;
  signal: number;
  battery: number;
}>;

function mockBikeSample(overrides: MockBikeSampleOverrides = {}) {
  const at = overrides.at ?? Date.now();
  const deviceId = overrides.deviceId ?? 58701;
  return {
    type: 'bike-sample',
    at,
    source: overrides.source ?? 'bluetooth',
    deviceId,
    label: overrides.label ?? `WattbikePM250${deviceId}`,
    watts: overrides.watts ?? 40,
    cadence: overrides.cadence ?? 16,
    speedKph: overrides.speedKph ?? 1.5,
    wattsAt: overrides.wattsAt ?? at,
    cadenceAt: overrides.cadenceAt ?? at,
    speedAt: overrides.speedAt ?? at,
    speedSource: 'measured',
    signal: overrides.signal ?? 92,
    battery: overrides.battery ?? 87,
  };
}

async function createMockBikeBridge(deviceIds = [58701]) {
  const bridgeUrl = new URL(process.env.PLAYWRIGHT_BRIDGE_URL ?? 'ws://127.0.0.1:19787');
  const port = Number(bridgeUrl.port);
  const clients = new Set<WebSocket>();
  const server = await new Promise<WebSocketServer>((resolve, reject) => {
    const wss = new WebSocketServer({ host: bridgeUrl.hostname, port });
    wss.once('listening', () => resolve(wss));
    wss.once('error', reject);
  });

  const broadcast = (message: unknown) => {
    const payload = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  server.on('connection', (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({
      type: 'bridge-status',
      mode: 'bluetooth',
      sourceState: 'running',
      message: 'Mock TrackLab connector running.',
      connectedDevices: deviceIds.map((deviceId, index) => ({
        deviceId,
        label: `WattbikePM250${deviceId}`,
        connected: true,
        source: 'bluetooth',
        signal: 92 - index,
        at: Date.now(),
      })),
    }));
    socket.on('message', (data) => {
      const command = JSON.parse(String(data)) as { type?: string; action?: string };
      if (command.type === 'bike-control') {
        socket.send(JSON.stringify({
          type: 'bike-control-result',
          action: command.action,
          ok: true,
          at: Date.now(),
          message: `Mock ${command.action} accepted.`,
          controlledCount: deviceIds.length,
        }));
      }
    });
    socket.on('close', () => clients.delete(socket));
  });

  return {
    broadcast,
    close: async () => {
      clients.forEach((client) => client.close());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('public landing page exposes the global track locator without an account', async ({ page }, testInfo) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) });
  });
  await page.route('**/data/track-database.json', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
  });

  await page.goto('/?locator=north-bay-bmx-napa-valley');

  const locator = page.locator('#track-locator');
  await expect(locator).toBeVisible();
  await expect(locator.getByRole('heading', { name: 'Find a BMX racing track' })).toBeVisible();
  await expect(locator.getByText('1,305 tracks', { exact: true })).toBeVisible();
  const locatorToolHeight = await locator.locator('.public-locator-layout').evaluate((element) => (
    Math.round(element.getBoundingClientRect().height)
  ));
  expect(locatorToolHeight).toBeGreaterThanOrEqual(540);
  expect(locatorToolHeight).toBeLessThanOrEqual(680);
  await expect(locator.getByRole('heading', { name: 'North Bay BMX' })).toBeVisible();
  await expect(locator.getByRole('link', { name: 'Apple Maps' })).toHaveAttribute('href', /maps\.apple\.com/);
  await expect(locator.getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /google\.com\/maps\/search/);
  await expect(locator.getByRole('link', { name: 'Open Earth' })).toHaveAttribute('href', /earth\.google\.com/);
  await expect(locator.getByText('Needs manual mapping')).toHaveCount(0);

  await locator.getByLabel('Search tracks').fill('ADF Cycling Club');
  const websiteTrack = locator.getByRole('button', { name: /ADF Cycling Club/ });
  await expect(websiteTrack).toBeVisible();
  await websiteTrack.click();
  await expect(locator.getByRole('heading', { name: 'ADF Cycling Club' })).toBeVisible();
  await expect(locator.getByRole('link', { name: 'Official Website' })).toHaveAttribute('href', 'https://www.adfcc.asn.au/');
  await expect(page).toHaveURL(/locator=auscycling-adf-cycling-club/);

  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath('public-track-locator.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await locator.scrollIntoViewIfNeeded();
  await expect(locator.getByRole('link', { name: 'Official Website' })).toBeVisible();
  await expect(locator.getByRole('link', { name: 'Apple Maps' })).toBeVisible();
  await expect(locator.getByRole('link', { name: 'Google Maps' })).toBeVisible();
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('public-track-locator-mobile.png'),
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await locator.getByLabel('Search tracks').fill('Air Time BMX');
  await locator.getByRole('button', { name: /Air Time BMX/ }).click();
  await expect(locator.getByRole('link', { name: 'Facebook' })).toHaveAttribute(
    'href',
    'https://www.facebook.com/airtimebmx.reedley/',
  );
  await expect(locator.getByRole('link', { name: 'Official Website' })).toHaveCount(0);
});

test('first-run profile flow opens the TrackLab dashboard', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const email = `playwright+${Date.now()}@tracklab.test`;
  const authUser = {
    id: `playwright-${Date.now()}`,
    profileKey: `user:playwright-${Date.now()}`,
    email,
    name: 'Playwright Rider',
    admin: false,
    membership: {
      tier: 'spectator',
      bikeSeats: 1,
      updatedAt: Date.now(),
    },
  };
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();
    if (!ignoredConsoleFragments.some((fragment) => text.includes(fragment))) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: null }),
    });
  });
  await page.route('**/api/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  // This test covers account onboarding, not Google's external renderer. The
  // production key intentionally rejects Playwright's localhost referrer.
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/');

  await expect(page).toHaveTitle(/TrackLab|BMX|Wattbike/i);
  await expect(page.getByRole('heading', { name: 'TrackLab BMX' }).first()).toBeVisible();
  await expect(page.getByLabel('Required profile')).toBeVisible();

  await page.getByLabel('Name').fill('Playwright Rider');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('playwright-pass-2026');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();

  await expect(page.getByLabel('Race controls')).toBeVisible();
  await expect(page.locator('.race-control-dock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo/i })).toHaveCount(0);
  await expect(page.getByLabel('Bike source')).toHaveCount(0);
  await expect(page.getByText(/Track Mapping|Trace route/i)).toHaveCount(0);
  await page.getByText('Loading Google imagery').waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Track Locator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a BMX racing track' })).toBeVisible();
  await expect(page.getByText('1,305 tracks', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open App', exact: true }).click();
  await expect(page.getByRole('button', { name: 'BMX Race Intervals', exact: true })).toBeVisible();
  await expect(page.getByText('Commentary brain', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Fast|Balanced|Studio/i })).toHaveCount(0);
  await expect(page.getByLabel('Announcer voice')).toHaveCount(0);
  await expect(page.getByText('American male', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Adaptive memory', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview selected voice' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Race type' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Intervals', exact: true })).toHaveCount(0);
  const ambientSound = page.getByLabel('Ambient track sound');
  await expect(ambientSound).toBeVisible();
  await expect(ambientSound).toBeChecked();
  await ambientSound.uncheck();
  await expect(ambientSound).not.toBeChecked();
  await expect(page.getByText('Developer ambient calibration')).toHaveCount(0);
  await expect(page.getByLabel('Ambient sound volume')).toHaveCount(0);
  await expect(page.locator('.race-commentary-caption')).toHaveCount(0);
  await expect(page.getByText('AI Announcer', { exact: true })).toHaveCount(0);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('tracklab-dashboard-smoke.png'),
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('Get Pulled runs a six-second countdown and keeps Air records separated', async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const audioWindow = window as typeof window & {
      __tracklabGetPulledTones?: string[];
    };
    window.addEventListener('tracklab-start-gate-tone', (event) => {
      const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
      if (kind) {
        audioWindow.__tracklabGetPulledTones = [
          ...(audioWindow.__tracklabGetPulledTones ?? []),
          kind,
        ];
      }
    });
  });
  const now = Date.now();
  const authUser = {
    id: 'get-pulled-developer',
    profileKey: 'user:get-pulled-developer',
    email: 'preskiranch@gmail.com',
    name: 'Get Pulled Developer',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: now,
    },
  };
  let trainingSaveCount = 0;

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: [],
        accountProfile: { updatedAt: now },
      }),
    });
  });
  await page.route('**/api/club-connect*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ canManageClub: true, ownedClub: null, memberships: [] }),
    });
  });
  await page.route('**/api/training-sessions*', async (route) => {
    if (route.request().method() !== 'GET') trainingSaveCount += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sessions: [], totals: {} }) });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/?track=black-mountain-bmx');
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible({ timeout: 2_000 }).catch(() => false)) await openApp.click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByRole('button', { name: 'Get Pulled', exact: true }).click();

  const view = page.getByLabel('Get Pulled timed Wattbike test');
  await expect(view).toBeVisible();
  await expect(view.getByRole('button', { name: '3s', exact: true })).toHaveClass(/selected/);
  const airOptions = view.getByLabel('Wattbike Air setting').getByRole('button');
  await expect(airOptions).toHaveCount(10);
  await airOptions.filter({ hasText: /^7$/ }).click();
  await expect(airOptions.filter({ hasText: /^7$/ })).toHaveClass(/selected/);

  await view.getByRole('button', { name: /Start 3 seconds pull · Air 7/ }).click();
  await expect(page.locator('.platform-shell')).toHaveClass(/utility-fullscreen/);
  await expect(view.getByText('Get ready', { exact: false })).toBeVisible();
  await expect(view.locator('.get-pulled-countdown strong')).toHaveText('6');
  await expect(view.getByText('Pulling now', { exact: false })).toBeVisible({ timeout: 7_500 });
  const pullScene = view.getByRole('img', { name: /actively pulling/i });
  await expect(pullScene).toHaveAttribute('data-rider-side', 'right');
  await expect(pullScene).toHaveAttribute('data-sled-side', 'left');
  await expect(pullScene).toHaveAttribute('data-pedaling', 'true');
  await expect(pullScene).toHaveAttribute('data-pull-scrolling', 'true');
  await expect(pullScene.locator('[data-pedal-cycle="running"]')).toBeVisible();
  const scenery = pullScene.locator('[data-pull-scenery="track"]');
  await expect(scenery).toHaveCSS('animation-name', 'tracklab-pull-scenery-scroll');
  const sceneryTransformBefore = await scenery.evaluate((element) => getComputedStyle(element).transform);
  const pedalFrameBefore = await pullScene.locator('[data-pedal-cycle="running"] span').evaluate(
    (element) => getComputedStyle(element).backgroundPositionX,
  );
  await page.waitForTimeout(450);
  const sceneryTransformAfter = await scenery.evaluate((element) => getComputedStyle(element).transform);
  const pedalFrameAfter = await pullScene.locator('[data-pedal-cycle="running"] span').evaluate(
    (element) => getComputedStyle(element).backgroundPositionX,
  );
  expect(sceneryTransformAfter).not.toBe(sceneryTransformBefore);
  expect(pedalFrameAfter).not.toBe(pedalFrameBefore);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabGetPulledTones?: string[] })
      .__tracklabGetPulledTones ?? []
  ))).toEqual(['tick', 'tick', 'tick', 'tick', 'tick', 'tick', 'gate']);
  await expect.poll(() => page.evaluate(() => {
    const audio = (window as typeof window & {
      __tracklabBikeRaceAudio?: { seenModes: Record<number, string[]> };
    }).__tracklabBikeRaceAudio;
    return Object.values(audio?.seenModes ?? {}).flat();
  }), { timeout: 3_000 }).toContain('pedaling');
  await pullScene.screenshot({
    path: testInfo.outputPath('get-pulled-active-animation.png'),
  });
  await expect(view.getByText('Pull complete', { exact: false })).toBeVisible({ timeout: 4_500 });
  await expect(view.getByLabel('Result recorded at Wattbike Air 7')).toBeVisible();
  await expect(view.getByText('Peak cadence', { exact: true })).toBeVisible();
  await expect(view.getByText('Demo pull results are for testing only and are not saved or published.')).toBeHidden();
  expect(trainingSaveCount).toBe(0);
});

test('developer Explore demo rides without commentary and keeps bike mechanics audio', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const authUser = {
    id: 'explore-developer',
    profileKey: 'user:explore-developer',
    email: 'preskiranch@gmail.com',
    name: 'Explore Developer',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  let commentaryRequestCount = 0;
  let quickRoute = false;
  let appleMapConfigured = false;
  let elevationRecoveryRequests = 0;
  let staleRouteFulfilled = false;
  let releaseStaleRoute: (() => void) | null = null;
  const staleRouteGate = new Promise<void>((resolve) => {
    releaseStaleRoute = resolve;
  });
  const exploreRouteRequests: Array<{
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    originLabel: string;
    destinationLabel: string;
    travelMode: 'bicycle' | 'drive';
    routeName?: string;
    waypoints?: Array<{ point: { lat: number; lng: number }; label: string }>;
  }> = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('wattbike-bmx-speed-unit-v1', 'mph');
    window.localStorage.setItem('tracklab-bmx-last-race-capture-v1', JSON.stringify({
      version: 1,
      sessionId: 'interrupted-demo-race',
      createdAt: Date.now() - 60_000,
      startedAt: Date.now() - 55_000,
      endedAt: null,
      status: 'racing',
      source: 'demo',
      track: {
        id: 'black-mountain-bmx',
        name: 'Black Mountain BMX',
        country: 'United States',
        state: 'Arizona',
        lengthMeters: 120,
        routeLengthMeters: 120,
      },
      sessionMode: 'sprint',
      selectedMetrics: ['cadence', 'speed', 'power', 'reaction'],
      players: [],
      zones: [],
      events: [],
      samples: [],
      frames: [],
      reactionTimesByPlayer: {},
      summary: [],
    }));
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/explore/elevation', async (route) => {
    const request = route.request().postDataJSON() as {
      distanceMeters: number;
      encodedPolyline: string;
    };
    elevationRecoveryRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        elevation: {
          elevationSamples: [
            { distanceMeters: 0, elevationMeters: 10 },
            { distanceMeters: request.distanceMeters / 2, elevationMeters: 20 },
            { distanceMeters: request.distanceMeters, elevationMeters: 15 },
          ],
          elevationGainMeters: 10,
          elevationLossMeters: 5,
        },
      }),
    });
  });
  await page.route('**/api/explore/smart-route', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        plan: {
          name: 'Malibu Ocean View Ten',
          summary: 'A researched coastal ride through recognizable Malibu landmarks.',
          originQuery: 'Malibu Pier, Malibu, CA',
          destinationQuery: 'Zuma Beach, Malibu, CA',
          waypointQueries: ['Point Dume, Malibu, CA'],
          targetDistanceMiles: 10,
          routeKind: 'point-to-point',
          disclaimer: 'Google determines the final course and displayed mileage.',
          sources: [{ title: 'Visit Malibu', url: 'https://www.malibucity.org/' }],
        },
      }),
    });
  });
  await page.route('**/api/explore/route', async (route) => {
    const request = route.request().postDataJSON() as typeof exploreRouteRequests[number];
    exploreRouteRequests.push(request);
    const requestNumber = exploreRouteRequests.length;
    const staleVeniceRoute = request.destinationLabel === '33.985, -118.469';
    const sanFranciscoRoute = request.destinationLabel === '37.7955, -122.3937';
    if (staleVeniceRoute) {
      await staleRouteGate;
    }
    const originLabel = sanFranciscoRoute
      ? 'Union Square, San Francisco, CA, USA'
      : request.originLabel === 'Quick Finish' || request.originLabel === 'Quick Start'
        ? request.originLabel
        : 'Quick Start';
    const destinationLabel = sanFranciscoRoute
      ? 'San Francisco Ferry Building, San Francisco, CA, USA'
      : request.destinationLabel === 'Quick Finish' || request.destinationLabel === 'Quick Start'
        ? request.destinationLabel
        : 'Quick Finish';
    const routeDistanceMeters = quickRoute ? 2 : 1_000;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        route: {
          id: `EXPLORE-playwright-${requestNumber}`,
          ...(request.routeName ? { name: request.routeName } : {}),
          origin: request.origin,
          destination: request.destination,
          originLabel,
          destinationLabel,
          travelMode: request.travelMode,
          distanceMeters: routeDistanceMeters,
          durationSeconds: quickRoute ? 1 : 300,
          encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          ...(request.waypoints?.length ? { waypoints: request.waypoints } : {}),
          ...(quickRoute ? {
            elevationSamples: [
              { distanceMeters: 0, elevationMeters: 10 },
              { distanceMeters: routeDistanceMeters, elevationMeters: 10 },
            ],
            elevationGainMeters: 0,
            elevationLossMeters: 0,
          } : {}),
          createdAt: Date.now(),
        },
      }),
    });
    if (staleVeniceRoute) {
      staleRouteFulfilled = true;
    }
  });
  await page.route('**/api/admin/apple-map-config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: appleMapConfigured,
        token: appleMapConfigured ? 'playwright-mapkit-token' : null,
      }),
    });
  });
  await page.route('https://cdn.apple-mapkit.com/**', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `(() => {
        class MockAppleMap {
          constructor(container, options = {}) {
            Object.assign(this, options);
            this.annotations = [];
            this.overlays = [];
            window.__tracklabAppleMapCreated = true;
            container.dataset.appleMapReady = 'true';
          }
          addAnnotation(annotation) { this.annotations.push(annotation); }
          addAnnotations(annotations) { this.annotations.push(...annotations); }
          addOverlay(overlay) { this.overlays.push(overlay); }
          destroy() {}
          removeAnnotations(annotations) {
            this.annotations = this.annotations.filter((item) => !annotations.includes(item));
          }
          removeOverlays(overlays) {
            this.overlays = this.overlays.filter((item) => !overlays.includes(item));
          }
          setCameraDistanceAnimated(distance) { this.cameraDistance = distance; }
          setCenterAnimated(center) { this.center = center; }
        }
        class MockAnnotation {
          constructor(coordinate, options = {}) {
            this.coordinate = coordinate;
            Object.assign(this, options);
          }
        }
        class MockPolyline {
          constructor(coordinates, options = {}) {
            this.coordinates = coordinates;
            Object.assign(this, options);
          }
        }
        class MockStyle {
          constructor(options = {}) { Object.assign(this, options); }
        }
        window.mapkit = {
          Map: MockAppleMap,
          MapType: { Hybrid: 'hybrid', Satellite: 'satellite' },
          MarkerAnnotation: MockAnnotation,
          PolylineOverlay: MockPolyline,
          Style: MockStyle,
        };
        const callback = document.currentScript?.dataset.callback;
        if (callback && typeof window[callback] === 'function') window[callback]();
      })();`,
    });
  });
  await page.route('**/api/commentary/{line,speech,pre-race}', async (route) => {
    commentaryRequestCount += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"error":"Explore must not request commentary"}',
    });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await expect(page.getByText('Race capture', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem('tracklab-bmx-last-race-capture-v1')
  ))).toBeNull();
  const demoRiderCount = page.getByRole('group', { name: 'Select demo rider count' });
  await expect(demoRiderCount).toBeVisible();
  await demoRiderCount.getByRole('button', { name: '2', exact: true }).click();
  await expect(demoRiderCount.getByRole('button', { name: '2', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Bike pairing').locator('.pair-card')).toHaveCount(2);
  const raceDemoRiders = page.getByRole('group', { name: 'Choose demo riders' });
  const raceDemoRiderButtons = raceDemoRiders.getByRole('button');
  await expect(raceDemoRiderButtons).toHaveCount(4);
  await raceDemoRiderButtons.nth(0).click();
  await raceDemoRiderButtons.nth(3).click();
  await expect(raceDemoRiderButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(raceDemoRiderButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(raceDemoRiderButtons.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 2');
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 4');
  await page.getByRole('button', { name: 'Explore the World', exact: true }).click();

  await expect(page.getByText('Developer Demo active', { exact: true })).toBeVisible();
  await expect(page.getByText(/54\/17 road rollout.*6\.9 m.*12–18 MPH averages/i)).toBeVisible();
  const mapRenderer = page.getByRole('group', { name: 'Explore map renderer' });
  await expect(mapRenderer).toBeVisible();
  await expect(mapRenderer.getByRole('button')).toHaveCount(3);
  const exploreDemoRiders = page.getByRole('group', { name: 'Choose demo riders' });
  const exploreDemoRiderButtons = exploreDemoRiders.getByRole('button');
  await expect(exploreDemoRiderButtons).toHaveCount(4);
  await expect(exploreDemoRiderButtons.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(exploreDemoRiderButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(exploreDemoRiderButtons.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    class MockAutocompleteSessionToken {}
    class MockAutocompleteService {
      getPlacePredictions(
        request: { input: string },
        callback: (predictions: unknown[], status: string) => void,
      ) {
        const destination = /oracle/i.test(request.input);
        callback([{
          description: destination
            ? 'Oracle Park, 24 Willie Mays Plaza, San Francisco, CA, USA'
            : 'Ferry Building, San Francisco, CA, USA',
          place_id: destination ? 'oracle-park' : 'ferry-building',
          structured_formatting: {
            main_text: destination ? 'Oracle Park' : 'Ferry Building',
            secondary_text: destination
              ? '24 Willie Mays Plaza, San Francisco, CA, USA'
              : 'San Francisco, CA, USA',
          },
        }], 'OK');
      }
    }
    class MockPlace {
      displayName = 'Lagoon Valley Park';
      formattedAddress = '1 Pena Adobe Road, Vacaville, CA 95688';
      googleMapsURI = 'https://www.google.com/maps/place/Lagoon+Valley+Park';
      nationalPhoneNumber = '(707) 449-5658';
      primaryTypeDisplayName = 'Park';
      rating = 4.7;
      userRatingCount = 1_284;
      websiteURI = 'https://www.ci.vacaville.ca.us/government/parks-and-recreation';

      constructor(_options: { id: string }) {}

      async fetchFields(_request: { fields: string[] }) {}
    }
    class MockGeocoder {
      async geocode(request: {
        address?: string;
        location?: { lat: number; lng: number };
      }) {
        const address = request.address ?? '';
        const point = request.location
          ?? (/point dume/i.test(address)
            ? { lat: 34.0029, lng: -118.8067 }
            : /zuma beach/i.test(address)
              ? { lat: 34.0218, lng: -118.8312 }
              : { lat: 34.0356, lng: -118.6767 });
        const formattedAddress = request.location?.lat === 37.7749
          ? 'Union Square, San Francisco, CA 94108, USA'
          : request.location?.lat === 37.7955
            ? 'Ferry Building, San Francisco, CA 94111, USA'
            : /point dume/i.test(address)
              ? 'Point Dume, Malibu, CA 90265, USA'
              : /zuma beach/i.test(address)
                ? 'Zuma Beach, Malibu, CA 90265, USA'
                : /malibu pier/i.test(address)
                  ? 'Malibu Pier, Malibu, CA 90265, USA'
                  : address || 'Selected address';
        return {
          results: [{
            formatted_address: formattedAddress,
            geometry: { location: { toJSON: () => point } },
          }],
        };
      }
    }
    type MockMapClickHandler = (event: {
      latLng?: { toJSON: () => { lat: number; lng: number } };
      placeId?: string;
      stop?: () => void;
    }) => void;
    class MockMap {
      private heading = 0;
      private zoom = 18;

      constructor(_element: HTMLElement, options: Record<string, unknown> & { zoom?: number }) {
        this.zoom = options.zoom ?? 18;
        (window as typeof window & { __tracklabExploreMapOptions?: Record<string, unknown> })
          .__tracklabExploreMapOptions = options;
      }

      addListener(eventName: string, handler: MockMapClickHandler) {
        const testWindow = window as typeof window & {
          __tracklabExploreMapClickHandlers?: MockMapClickHandler[];
        };
        if (eventName === 'click') {
          testWindow.__tracklabExploreMapClickHandlers ??= [];
          testWindow.__tracklabExploreMapClickHandlers.push(handler);
        }
        return {
          remove: () => {
            testWindow.__tracklabExploreMapClickHandlers = (
              testWindow.__tracklabExploreMapClickHandlers ?? []
            ).filter((candidate) => candidate !== handler);
          },
        };
      }

      fitBounds() {}
      getHeading() { return this.heading; }
      getZoom() { return this.zoom; }
      moveCamera() {}
      setHeading(heading: number) { this.heading = heading; }
      setOptions() {}
      setTilt() {}
      setZoom(zoom: number) { this.zoom = zoom; }
    }
    class MockMarker {
      constructor(options: Record<string, unknown> = {}) {
        const testWindow = window as typeof window & {
          __tracklabExploreMarkerOptions?: Record<string, unknown>[];
        };
        testWindow.__tracklabExploreMarkerOptions ??= [];
        testWindow.__tracklabExploreMarkerOptions.push(options);
      }

      setMap() {}
      setIcon() {}
      setPosition() {}
      setTitle() {}
    }
    class MockPolyline {
      setMap() {}
    }
    class MockMap3DElement extends HTMLElement {
      center: unknown;
      heading = 0;
      mode = 'SATELLITE';
      range = 320;
      tilt = 55;

      constructor(options: Record<string, unknown> = {}) {
        super();
        Object.assign(this, options);
      }

      connectedCallback() {
        const testWindow = window as typeof window & {
          __tracklabExplore3DMaps?: MockMap3DElement[];
        };
        testWindow.__tracklabExplore3DMaps ??= [];
        testWindow.__tracklabExplore3DMaps.push(this);
        const event = new Event('gmp-steadychange');
        Object.defineProperty(event, 'isSteady', { value: true });
        queueMicrotask(() => this.dispatchEvent(event));
      }

      disconnectedCallback() {
        const testWindow = window as typeof window & {
          __tracklabExplore3DMaps?: MockMap3DElement[];
        };
        testWindow.__tracklabExplore3DMaps = (testWindow.__tracklabExplore3DMaps ?? [])
          .filter((map) => map !== this);
      }
    }
    class MockPolyline3DElement extends HTMLElement {}
    class MockMarker3DElement extends HTMLElement {
      position: unknown;
      title = '';

      constructor(options: Record<string, unknown> = {}) {
        super();
        Object.assign(this, options);
      }
    }
    class MockMarkerElement extends MockMarker3DElement {}
    if (!customElements.get('tracklab-mock-map-3d')) {
      customElements.define('tracklab-mock-map-3d', MockMap3DElement);
      customElements.define('tracklab-mock-polyline-3d', MockPolyline3DElement);
      customElements.define('tracklab-mock-marker-3d', MockMarker3DElement);
      customElements.define('tracklab-mock-marker-html', MockMarkerElement);
    }
    const maps3d = {
      Map3DElement: customElements.get('tracklab-mock-map-3d'),
      Marker3DElement: customElements.get('tracklab-mock-marker-3d'),
      MarkerElement: customElements.get('tracklab-mock-marker-html'),
      Polyline3DElement: customElements.get('tracklab-mock-polyline-3d'),
    };
    class MockLatLngBounds {
      extend() {}
    }
    class MockPoint {
      constructor(public x: number, public y: number) {}
    }
    class MockSize {
      constructor(public width: number, public height: number) {}
    }
    class MockStreetViewService {
      async getPanorama() {
        return {
          data: {
            copyright: 'Imagery © Google',
            imageDate: '2026-06',
            location: {
              description: 'Lagoon Valley Park entrance',
              pano: 'lagoon-valley-panorama',
            },
          },
        };
      }
    }
    class MockStreetViewPanorama {
      constructor(_element: HTMLElement, _options: Record<string, unknown>) {
        (window as typeof window & { __tracklabStreetViewCreated?: boolean })
          .__tracklabStreetViewCreated = true;
      }

      focus() {}
      setVisible() {}
    }
    const places = {
      AutocompleteSessionToken: MockAutocompleteSessionToken,
      AutocompleteService: MockAutocompleteService,
      Place: MockPlace,
    };
    const streetView = {
      StreetViewPanorama: MockStreetViewPanorama,
      StreetViewService: MockStreetViewService,
    };
    (window as typeof window & { google?: unknown }).google = {
      maps: {
        Geocoder: MockGeocoder,
        LatLngBounds: MockLatLngBounds,
        Map: MockMap,
        Marker: MockMarker,
        Point: MockPoint,
        Polyline: MockPolyline,
        Size: MockSize,
        SymbolPath: { CIRCLE: 'circle' },
        places,
        importLibrary: async (name: string) => (
          name === 'places'
            ? places
            : name === 'streetView'
              ? streetView
              : name === 'maps3d' ? maps3d : {}
        ),
      },
    };
  });
  const originInput = page.getByRole('textbox', { name: 'Starting location', exact: true });
  const destinationInput = page.getByRole('textbox', { name: 'Destination', exact: true });
  const recentRoutes = page.getByRole('combobox', { name: 'Recent Explore routes' });
  await expect(page.getByRole('button', { name: 'Bicycle', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Car route', exact: true })).toHaveCount(0);
  await expect(recentRoutes).toBeDisabled();
  await page.getByRole('button', { name: 'Choose start and destination on map' }).click();
  const mapPicker = page.getByRole('dialog', { name: 'Select your route endpoints' });
  await expect(mapPicker).toBeVisible();
  await expect(mapPicker.getByRole('button', { name: 'Set start' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabExploreMapClickHandlers?: unknown[] })
      .__tracklabExploreMapClickHandlers?.length ?? 0
  ))).toBeGreaterThan(0);
  await page.evaluate(() => {
    const handler = (window as typeof window & {
      __tracklabExploreMapClickHandlers?: Array<(event: {
        latLng: { toJSON: () => { lat: number; lng: number } };
      }) => void>;
    }).__tracklabExploreMapClickHandlers?.[0];
    handler?.({ latLng: { toJSON: () => ({ lat: 37.7749, lng: -122.4194 }) } });
  });
  await expect(mapPicker.getByRole('button', { name: 'Set destination' }))
    .toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const handler = (window as typeof window & {
      __tracklabExploreMapClickHandlers?: Array<(event: {
        latLng: { toJSON: () => { lat: number; lng: number } };
      }) => void>;
    }).__tracklabExploreMapClickHandlers?.[0];
    handler?.({ latLng: { toJSON: () => ({ lat: 37.7955, lng: -122.3937 }) } });
  });
  await expect(mapPicker).toContainText('Union Square, San Francisco, CA 94108, USA');
  await expect(mapPicker).toContainText('Ferry Building, San Francisco, CA 94111, USA');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-map-picker-mobile.png'),
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await mapPicker.getByRole('button', { name: 'Use these map points' }).click();
  await expect(mapPicker).toHaveCount(0);
  await expect(originInput).toHaveValue('Union Square, San Francisco, CA 94108, USA');
  await expect(destinationInput).toHaveValue('Ferry Building, San Francisco, CA 94111, USA');
  const routeNameInput = page.getByRole('textbox', { name: /Route name/i });
  await routeNameInput.fill('San Francisco warm-up');
  await page.getByRole('button', { name: 'Build Explore the World route' }).click();
  await expect(page.locator('.explore-route-summary')).toBeVisible();
  await expect.poll(() => exploreRouteRequests.at(-1)).toMatchObject({
    origin: { lat: 37.7749, lng: -122.4194 },
    destination: { lat: 37.7955, lng: -122.3937 },
    originLabel: 'Union Square, San Francisco, CA 94108, USA',
    destinationLabel: 'Ferry Building, San Francisco, CA 94111, USA',
    travelMode: 'bicycle',
    routeName: 'San Francisco warm-up',
  });
  await expect(page.locator('.explore-route-summary')).toContainText('San Francisco warm-up');
  await expect(page.locator('.explore-route-summary')).toContainText('Elevation gain33 ft');
  await expect(recentRoutes).toBeEnabled();
  await expect(recentRoutes.locator('option')).toHaveCount(2);
  const requestCountBeforeRecentRestore = exploreRouteRequests.length;
  await recentRoutes.selectOption({ index: 1 });
  await expect(page.getByText(/Recent route loaded:/)).toBeVisible();
  expect(exploreRouteRequests).toHaveLength(requestCountBeforeRecentRestore);
  const smartPrompt = page.getByRole('textbox', { name: 'Describe your Smart Route' });
  await smartPrompt.fill('A 10 mile coastal ride in Malibu with ocean views');
  await page.getByRole('button', { name: 'Find and build this ride' }).click();
  await expect(page.locator('.explore-route-summary')).toContainText('Malibu Ocean View Ten');
  await expect(page.getByRole('region', { name: 'Smart Route research' })).toContainText(
    'Google determines the final course and displayed mileage.',
  );
  await expect.poll(() => exploreRouteRequests.at(-1)).toMatchObject({
    routeName: 'Malibu Ocean View Ten',
    originLabel: 'Malibu Pier, Malibu, CA 90265, USA',
    destinationLabel: 'Zuma Beach, Malibu, CA 90265, USA',
    travelMode: 'bicycle',
    waypoints: [{ label: 'Point Dume, Malibu, CA 90265, USA' }],
  });
  await originInput.fill('Ferry Build');
  const originSuggestion = page.getByRole('option', { name: /Ferry Building.*San Francisco/i });
  await expect(originSuggestion).toBeVisible();
  await originSuggestion.click();
  await expect(originInput).toHaveValue('Ferry Building, San Francisco, CA, USA');
  await destinationInput.fill('Oracle Pa');
  const destinationSuggestion = page.getByRole('option', { name: /Oracle Park.*Willie Mays/i });
  await expect(destinationSuggestion).toBeVisible();
  await destinationSuggestion.click();
  await expect(destinationInput).toHaveValue(/Oracle Park/);
  await originInput.fill('37.7879, -122.4075');
  await destinationInput.fill('33.985, -118.469');
  const staleRouteRequestCount = exploreRouteRequests.length;
  await page.getByRole('button', { name: 'Build Explore the World route' }).click();
  await expect.poll(() => exploreRouteRequests.length).toBe(staleRouteRequestCount + 1);
  await destinationInput.fill('37.7955, -122.3937');
  await expect(page.getByText('Location changed. Select Build Explore the World route to update the map.'))
    .toBeVisible();
  releaseStaleRoute?.();
  await expect.poll(() => staleRouteFulfilled).toBe(true);
  await expect(page.locator('.explore-route-summary > div strong')).toHaveText('Quick Finish');
  await page.getByRole('button', { name: 'Build Explore the World route' }).click();

  await expect(page.locator('.explore-route-summary > div strong'))
    .toHaveText('San Francisco Ferry Building, San Francisco, CA, USA');
  await expect.poll(() => elevationRecoveryRequests).toBe(3);
  await expect(page.locator('.explore-route-summary')).toContainText('Elevation gain33 ft');
  await expect(page.locator('.explore-route-summary')).toContainText('Descent16 ft');
  await expect(page.getByLabel(/Climbing, grade \+2\.0%/).first()).toBeVisible();
  await expect(page.getByLabel(
    'Recommended Wattbike air setting 2. Set air lever to 2.',
  ).first()).toBeVisible();
  await mapRenderer.getByRole('button', { name: 'Apple Satellite' }).click();
  await expect(page.getByText(/Apple Satellite is not configured yet/i)).toBeVisible();
  await expect(page.locator('.explore-route-summary')).toContainText('Apple satellite');
  await expect(page.locator('.explore-route-summary')).toContainText('Elevation gain33 ft');
  appleMapConfigured = true;
  await mapRenderer.getByRole('button', { name: 'Google Satellite' }).click();
  await expect(page.locator('.explore-route-summary')).toContainText('Labeled satellite');
  await mapRenderer.getByRole('button', { name: 'Google 3D' }).click();
  await expect(page.getByLabel('Google photorealistic 3D Explore map')).toBeVisible();
  await expect(page.getByText('Loading Google 3D…')).toHaveCount(0);
  await expect(page.locator('.explore-route-summary')).toContainText('Google 3D');
  await mapRenderer.getByRole('button', { name: 'Apple Satellite' }).click();
  await expect(page.getByLabel('Apple Satellite Explore map')).toBeVisible();
  await expect(page.getByText('Loading Apple Satellite…')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { __tracklabAppleMapCreated?: boolean }).__tracklabAppleMapCreated,
  ))).toBe(true);
  await mapRenderer.getByRole('button', { name: 'Google 3D' }).click();
  await expect(page.locator('.explore-route-summary')).toContainText('Google 3D');
  await expect(page.getByText('0.62 mi', { exact: true })).toBeVisible();
  const distanceUnits = page.getByRole('group', { name: 'Explore distance unit' });
  await expect(distanceUnits.getByRole('button', { name: 'Show distances in miles' }))
    .toHaveAttribute('aria-pressed', 'true');
  await distanceUnits.getByRole('button', { name: 'Show distances in kilometers' }).click();
  await expect(page.getByText('1.00 km', { exact: true })).toBeVisible();
  await distanceUnits.getByRole('button', { name: 'Show distances in miles' }).click();
  await exploreDemoRiderButtons.nth(0).click();
  await exploreDemoRiderButtons.nth(2).click();
  await expect(page.locator('.explore-rider-strip article')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabExploreMapOptions?: Record<string, unknown> })
      .__tracklabExploreMapOptions
  ))).toMatchObject({
    gestureHandling: 'greedy',
    headingInteractionEnabled: true,
    tiltInteractionEnabled: true,
  });
  await expect.poll(() => page.evaluate(() => (
    new Set((window as typeof window & {
      __tracklabExploreMarkerOptions?: Array<{ icon?: { url?: string } }>;
    }).__tracklabExploreMarkerOptions
      ?.flatMap((options) => options.icon?.url?.startsWith('data:image/svg+xml')
        ? [options.icon.url]
        : []) ?? []).size
  ))).toBe(2);
  await mapRenderer.getByRole('button', { name: 'Google 3D' }).click();
  await page.getByRole('button', { name: 'Start Explore the World ride' }).click();
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  await expect(page.locator('.platform-shell')).toHaveClass(/explore-fullscreen/);
  const cameraControls = page.getByLabel('Explore camera controls');
  await expect(cameraControls.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  await expect(cameraControls.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  const destinationInCameraBar = cameraControls.getByLabel(
    'Destination: San Francisco Ferry Building, San Francisco, CA, USA',
  );
  await expect(destinationInCameraBar).toBeVisible();
  const cameraBarBox = await cameraControls.boundingBox();
  const destinationBox = await destinationInCameraBar.boundingBox();
  const zoomOutBox = await page.getByRole('button', { name: 'Show more of the route' }).boundingBox();
  expect(cameraBarBox).not.toBeNull();
  expect(cameraBarBox?.x).toBe(0);
  expect(cameraBarBox?.y).toBe(0);
  expect(cameraBarBox?.width ?? 0).toBeGreaterThanOrEqual(1_278);
  expect(cameraBarBox?.height ?? Infinity).toBeLessThanOrEqual(56);
  expect(destinationBox).not.toBeNull();
  expect(zoomOutBox).not.toBeNull();
  expect(destinationBox?.x ?? 0).toBeLessThan(zoomOutBox?.x ?? 0);
  const fourWayLayout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.explore-map-grid');
    const toolbar = document.querySelector<HTMLElement>('.explore-camera-toolbar')
      ?.getBoundingClientRect();
    const riderStrip = document.querySelector<HTMLElement>('.explore-rider-strip')
      ?.getBoundingClientRect();
    if (!grid) {
      throw new Error('Explore map grid was not rendered.');
    }
    const mapGrid = grid.getBoundingClientRect();
    grid.classList.add('four-way');
    const fourWayStyle = window.getComputedStyle(grid);
    const columns = fourWayStyle.gridTemplateColumns.split(' ').map(Number.parseFloat);
    const rows = fourWayStyle.gridTemplateRows.split(' ').map(Number.parseFloat);
    grid.classList.remove('four-way');
    return {
      columns,
      rows,
      mapBottom: mapGrid.bottom,
      mapTop: mapGrid.top,
      riderStripHeight: riderStrip?.height ?? 0,
      riderStripTop: riderStrip?.top ?? 0,
      toolbarBottom: toolbar?.bottom ?? 0,
    };
  });
  expect(fourWayLayout.columns).toHaveLength(2);
  expect(fourWayLayout.rows).toHaveLength(2);
  expect(Math.max(...fourWayLayout.columns) - Math.min(...fourWayLayout.columns))
    .toBeLessThanOrEqual(1);
  expect(Math.max(...fourWayLayout.rows) - Math.min(...fourWayLayout.rows))
    .toBeLessThanOrEqual(1);
  expect(fourWayLayout.mapTop).toBeGreaterThanOrEqual(fourWayLayout.toolbarBottom - 2);
  expect(fourWayLayout.mapBottom).toBeLessThanOrEqual(fourWayLayout.riderStripTop);
  expect(fourWayLayout.riderStripHeight).toBeLessThanOrEqual(96);
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeHidden();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  const followZoom = page.getByLabel('Follow camera zoom');
  await expect(followZoom).toHaveValue('18');
  const centeredCamera = page.getByRole('button', { name: 'Camera follow position: centered' });
  await expect(centeredCamera).toBeVisible();
  await centeredCamera.click();
  const aheadCamera = page.getByRole('button', { name: 'Camera follow position: ahead' });
  await expect(aheadCamera).toBeVisible();
  await aheadCamera.click();
  await expect(page.getByRole('button', { name: 'Camera follow position: behind' })).toBeVisible();
  const northUp = page.getByRole('button', { name: 'North up' });
  const directionUp = page.getByRole('button', { name: 'Direction of travel up' });
  await expect(northUp).toHaveAttribute('aria-pressed', 'true');
  await expect(directionUp).toHaveAttribute('aria-pressed', 'false');
  await directionUp.click();
  await expect(directionUp).toHaveAttribute('aria-pressed', 'true');
  await expect(northUp).toHaveAttribute('aria-pressed', 'false');
  const mapLabels = page.getByRole('button', { name: 'Hide street names and landmarks' });
  await expect(mapLabels).toHaveAttribute('aria-pressed', 'true');
  await mapLabels.click();
  const labelsOff = page.getByRole('button', { name: 'Show street names and landmarks' });
  await expect(labelsOff).toHaveAttribute('aria-pressed', 'false');
  await labelsOff.click();
  await expect(page.getByRole('button', { name: 'Hide street names and landmarks' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Landmarks are interactive.*Street View.*official website/i)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabExplore3DMaps?: unknown[];
    }).__tracklabExplore3DMaps?.length ?? 0
  ))).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabExplore3DMaps?: Array<{ gestureHandling?: string }>;
    }).__tracklabExplore3DMaps?.[0]?.gestureHandling
  ))).toBe('GREEDY');
  const freeCamera = page.getByRole('button', { name: 'Enable free camera' });
  await expect(freeCamera).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Google photorealistic 3D Explore map').dispatchEvent('pointerdown', {
    pointerId: 17,
    pointerType: 'touch',
  });
  const resumeAutomaticCamera = page.getByRole('button', { name: 'Resume automatic camera' });
  await expect(resumeAutomaticCamera).toHaveAttribute('aria-pressed', 'true');
  const freeCameraState = await page.evaluate(() => {
    const map = (window as typeof window & {
      __tracklabExplore3DMaps?: Array<{
        center?: { lat: number; lng: number };
        heading?: number;
      }>;
    }).__tracklabExplore3DMaps?.[0];
    const desiredHeading = ((map?.heading ?? 0) + 83) % 360;
    map!.heading = desiredHeading;
    return {
      center: { ...map!.center! },
      desiredHeading,
    };
  });
  await page.waitForTimeout(200);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabExplore3DMaps?: Array<{ heading?: number }>;
    }).__tracklabExplore3DMaps?.[0]?.heading
  ))).toBe(freeCameraState.desiredHeading);
  await page.getByLabel('Google photorealistic 3D Explore map').dispatchEvent('pointerup', {
    pointerId: 17,
    pointerType: 'touch',
  });
  await expect.poll(() => page.evaluate((startCenter) => {
    const currentCenter = (window as typeof window & {
      __tracklabExplore3DMaps?: Array<{ center?: { lat: number; lng: number } }>;
    }).__tracklabExplore3DMaps?.[0]?.center;
    return Boolean(currentCenter && (
      Math.abs(currentCenter.lat - startCenter.lat) > 1e-8
      || Math.abs(currentCenter.lng - startCenter.lng) > 1e-8
    ));
  }, freeCameraState.center), { timeout: 4_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabExplore3DMaps?: Array<{ heading?: number }>;
    }).__tracklabExplore3DMaps?.[0]?.heading
  ))).toBe(freeCameraState.desiredHeading);
  await resumeAutomaticCamera.click();
  await expect(page.getByRole('button', { name: 'Enable free camera' }))
    .toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (
    [...document.querySelectorAll('tracklab-mock-marker-html')]
      .filter((marker) => marker.querySelector('.explore-map-rider-marker')).length
  ))).toBe(4);
  await expect.poll(() => page.evaluate(() => (
    [...document.querySelectorAll('tracklab-mock-marker-html')]
      .filter((marker) => marker.querySelector('.explore-map-rider-marker'))
      .every((marker) => {
        const presentation = marker.querySelector<HTMLElement>('.explore-map-rider-marker');
        const avatar = marker.querySelector<HTMLElement>('.explore-map-rider-avatar');
        const pin = marker.querySelector<HTMLElement>('.explore-map-rider-pin');
        const markerWithAnchor = marker as HTMLElement & {
          anchorLeft?: string;
          anchorTop?: string;
          position?: { altitude?: number };
        };
        const avatarStyle = avatar ? window.getComputedStyle(avatar) : null;
        return Boolean(presentation)
          && Boolean(pin?.querySelector('svg'))
          && !marker.querySelector('img[src*="/assets/explore/road-cyclist-p"]')
          && avatarStyle?.width === '44px'
          && avatarStyle.height === '44px'
          && Boolean(presentation?.style.getPropertyValue('--player-color'))
          && markerWithAnchor.anchorLeft === '-50%'
          && markerWithAnchor.anchorTop === '-100%'
          && markerWithAnchor.position?.altitude === 0.15;
      })
  ))).toBe(true);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __tracklabExplore3DMaps?: HTMLElement[];
      __tracklabLandmarkClickPrevented?: boolean;
    };
    const event = new Event('gmp-click', { cancelable: true });
    Object.defineProperty(event, 'placeId', { value: 'lagoon-valley-park' });
    testWindow.__tracklabExplore3DMaps?.[0]?.dispatchEvent(event);
    testWindow.__tracklabLandmarkClickPrevented = event.defaultPrevented;
  });
  const landmarkDialog = page.getByRole('dialog', { name: 'Landmark information' });
  await expect(landmarkDialog).toBeVisible();
  await expect(landmarkDialog.getByRole('heading', { name: 'Lagoon Valley Park' })).toBeVisible();
  await expect(landmarkDialog).toContainText('1 Pena Adobe Road');
  await expect(landmarkDialog).toContainText('4.7');
  await expect(landmarkDialog.getByRole('link', { name: /Official website/i }))
    .toHaveAttribute('href', 'https://www.ci.vacaville.ca.us/government/parks-and-recreation');
  await expect(landmarkDialog.getByRole('link', { name: /Open in Google Maps/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  expect(await page.evaluate(() => (
    (window as typeof window & { __tracklabLandmarkClickPrevented?: boolean })
      .__tracklabLandmarkClickPrevented
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-landmark-live.png'),
  });
  await landmarkDialog.getByRole('button', { name: 'View Street View' }).click();
  await expect(landmarkDialog).toHaveCount(0);
  const streetViewDialog = page.getByRole('dialog', { name: 'Street View: Lagoon Valley Park' });
  await expect(streetViewDialog).toBeVisible();
  await expect(streetViewDialog).toContainText('Lagoon Valley Park entrance');
  await expect(streetViewDialog).toContainText('Imagery 2026-06');
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  expect(await page.evaluate(() => (
    (window as typeof window & { __tracklabStreetViewCreated?: boolean })
      .__tracklabStreetViewCreated
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-street-view-live.png'),
  });
  await page.evaluate(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(streetViewDialog.getByRole('button', { name: 'Back to map' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-street-view-mobile.png'),
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await streetViewDialog.getByRole('button', { name: 'Back to map' }).click();
  await expect(streetViewDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Street View|360 camera rotation/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show more of the route' }).click();
  await page.getByRole('button', { name: 'Show more of the route' }).click();
  await expect(followZoom).toHaveValue('16');

  await expect.poll(() => page.evaluate(() => {
    const bikeAudio = (window as typeof window & {
      __tracklabBikeRaceAudio?: {
        ready: boolean;
        seenModes: Record<number, string[]>;
      };
    }).__tracklabBikeRaceAudio;
    return {
      ready: bikeAudio?.ready ?? false,
      modes: [...new Set(Object.values(bikeAudio?.seenModes ?? {}).flat())].sort(),
    };
  }), { timeout: 14_000 }).toEqual({
    ready: true,
    modes: ['freewheel', 'pedaling'],
  });
  await expect.poll(async () => (
    page.locator('.explore-rider-strip article').first().locator('div > span').first().textContent()
  ), { timeout: 14_000 }).toMatch(/ · (?:1[2-7](?:\.\d)?|18(?:\.0)?) MPH/);
  await expect(page.locator('.explore-rider-strip article').first()).toContainText(/Avg \d+\.\d MPH/);
  expect(commentaryRequestCount).toBe(0);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-desktop.png'),
  });
  await page.evaluate(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  });
  await expect(page.locator('.platform-shell')).toHaveClass(/explore-fullscreen/);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByLabel('Explore camera controls')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-tablet.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  await expect(destinationInCameraBar).toBeVisible();
  const mobileCameraBarBox = await cameraControls.boundingBox();
  const mobileGroupLabelBox = await page.locator('.explore-map-group-label').boundingBox();
  expect(mobileCameraBarBox).not.toBeNull();
  expect(mobileCameraBarBox?.x).toBe(0);
  expect(mobileCameraBarBox?.y).toBe(0);
  expect(mobileCameraBarBox?.width ?? 0).toBeGreaterThanOrEqual(388);
  expect(mobileGroupLabelBox).not.toBeNull();
  expect(mobileGroupLabelBox?.y ?? 0).toBeGreaterThanOrEqual(
    (mobileCameraBarBox?.y ?? 0) + (mobileCameraBarBox?.height ?? 0),
  );
  const mobilePauseBox = await page.getByRole('button', { name: 'Pause ride' }).boundingBox();
  const mobileExitBox = await page.getByRole('button', { name: 'Exit full screen' }).boundingBox();
  expect(mobilePauseBox).not.toBeNull();
  expect(mobileExitBox).not.toBeNull();
  expect(mobilePauseBox?.x ?? 0).toBeGreaterThan(250);
  expect((mobilePauseBox?.x ?? 0) + (mobilePauseBox?.width ?? 0)).toBeLessThanOrEqual(mobileExitBox?.x ?? 0);
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('explore-mobile.png'),
  });
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('.platform-shell')).not.toHaveClass(/explore-fullscreen/);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  quickRoute = true;
  await originInput.fill('38.5, -120.2');
  await destinationInput.fill('43.252, -126.453');
  await page.getByRole('button', { name: 'Build Explore the World route' }).click();
  await expect(page.locator('.explore-route-summary > div strong')).toHaveText('Quick Finish');
  await page.getByRole('button', { name: 'Start Explore the World ride' }).click();
  const completedRouteOptions = page.getByRole('region', { name: 'Completed route options' });
  await expect(completedRouteOptions).toBeVisible({ timeout: 10_000 });
  await completedRouteOptions.getByRole('button', { name: 'Reverse route' }).click();
  await expect.poll(() => exploreRouteRequests.at(-1)).toMatchObject({
    originLabel: 'Quick Finish',
    destinationLabel: 'Quick Start',
    travelMode: 'bicycle',
  });
  await expect(page.locator('.explore-route-summary > div strong')).toContainText('Quick Start');

  await page.getByRole('button', { name: 'Start Explore the World ride' }).click();
  await expect(completedRouteOptions).toBeVisible({ timeout: 10_000 });
  await completedRouteOptions.getByRole('button', { name: 'New destination' }).click();
  await expect(originInput).toHaveValue('Quick Start');
  await expect(destinationInput).toHaveValue('');
  await expect(destinationInput).toBeFocused();
});

test('live Explore ride survives a temporary Wattbike sample gap', async ({ page }) => {
  const deviceId = 733112;
  const bridge = await createMockBikeBridge([deviceId]);
  const authUser = {
    id: 'live-explore-racer',
    profileKey: 'user:live-explore-racer',
    email: 'live-explore@tracklab.test',
    name: 'Live Explore Rider',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 1, updatedAt: Date.now() },
  };
  let sampleTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    bridge.broadcast(mockBikeSample({
      deviceId,
      label: 'WattbikePM25043950',
      watts: 260,
      cadence: 84,
      speedKph: 0,
    }));
  }, 120);

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/explore/route', async (route) => {
      const request = route.request().postDataJSON() as {
        origin: { lat: number; lng: number };
        destination: { lat: number; lng: number };
        originLabel: string;
        destinationLabel: string;
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          route: {
            id: 'EXPLORE-live-sample-gap',
            origin: request.origin,
            destination: request.destination,
            originLabel: request.originLabel,
            destinationLabel: request.destinationLabel,
            travelMode: 'bicycle',
            distanceMeters: 10_000,
            durationSeconds: 1_800,
            encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
            elevationSamples: [
              { distanceMeters: 0, elevationMeters: 10 },
              { distanceMeters: 10_000, elevationMeters: 10 },
            ],
            elevationGainMeters: 0,
            elevationLossMeters: 0,
            createdAt: Date.now(),
          },
        }),
      });
    });
    await page.route('https://maps.googleapis.com/**', (route) => route.abort());

    await page.goto('/');
    await page.getByRole('button', { name: 'Open App' }).click();
    await expect(page.getByText(/1 connected bike/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Explore the World', exact: true }).click();
    await page.getByRole('textbox', { name: 'Starting location', exact: true }).fill('38.5, -120.2');
    await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('43.252, -126.453');
    await page.getByRole('button', { name: 'Build Explore the World route' }).click();
    await expect(page.locator('.explore-route-summary')).toBeVisible();
    await page.getByRole('button', { name: 'Start Explore the World ride' }).click();
    await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
    await expect(page.locator('.explore-rider-strip article')).toHaveCount(1);

    clearInterval(sampleTimer);
    sampleTimer = null;
    await page.waitForTimeout(5_500);

    await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
    await expect(page.locator('.explore-rider-strip article')).toHaveCount(1);
    await expect(page.locator('.platform-shell')).toHaveClass(/explore-fullscreen/);

    sampleTimer = setInterval(() => {
      bridge.broadcast(mockBikeSample({
        deviceId,
        label: 'WattbikePM25043950',
        watts: 260,
        cadence: 84,
        speedKph: 0,
      }));
    }, 120);
    await expect.poll(async () => (
      page.locator('.explore-rider-strip article').first().textContent()
    ), { timeout: 8_000 }).toMatch(/[1-9]\d*(?:\.\d)? MPH/);
    await expect(page.getByRole('button', { name: 'Pause ride' })).toBeVisible();
  } finally {
    if (sampleTimer) {
      clearInterval(sampleTimer);
    }
    await bridge.close();
  }
});

test('Windows Bluetooth pairing widens discovery and stays pending until TrackLab verifies a bike connection', async ({ page }) => {
  const authUser = {
    id: 'bluetooth-pairing-racer',
    profileKey: 'user:bluetooth-pairing-racer',
    email: 'bluetooth-pairing@tracklab.test',
    name: 'Bluetooth Pairing Rider',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0',
    });
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: async () => [],
        requestDevice: (options: unknown) => {
          (window as typeof window & { __tracklabBluetoothRequestOptions?: unknown })
            .__tracklabBluetoothRequestOptions = options;
          return new Promise(() => undefined);
        },
      },
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trackMappings: {}, count: 0 }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: {}, customRoutes: [], bikeProfiles: [] }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ghosts: [] }) });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();

  await expect(page.getByText(/On Windows Chrome\/Edge/).first()).toBeVisible();
  const pairButton = page.getByRole('button', { name: 'Pair Wattbike', exact: true });
  await expect(pairButton).toBeVisible();
  await pairButton.click();
  const pairingDialog = page.getByRole('dialog', { name: 'Connect Wattbikes' });
  await expect(pairingDialog).toBeVisible();
  await expect(pairingDialog.locator('.bluetooth-pairing-slots article')).toHaveCount(4);
  await pairingDialog.getByRole('button', { name: 'Choose first Wattbike' }).click();
  await expect(page.getByRole('button', { name: 'Pairing...', exact: true })).toBeDisabled();
  await expect(page.getByText('Pairing with the selected Wattbike and verifying its live data service.').first()).toBeVisible();
  await expect(page.getByText(/connected \/ 0 detected/)).toBeVisible();
  expect(await page.evaluate(() => (
    (window as typeof window & {
      __tracklabBluetoothRequestOptions?: {
        acceptAllDevices?: boolean;
        filters?: unknown[];
        optionalServices?: string[];
      };
    }).__tracklabBluetoothRequestOptions
  ))).toMatchObject({
    acceptAllDevices: true,
    optionalServices: expect.arrayContaining([
      '00001818-0000-1000-8000-00805f9b34fb',
      '00001816-0000-1000-8000-00805f9b34fb',
      '00001826-0000-1000-8000-00805f9b34fb',
    ]),
  });
});

test('Bluetooth pairing stays open for multiple Wattbikes and restores approved bikes after refresh', async ({ page }) => {
  const authUser = {
    id: 'bluetooth-multi-racer',
    profileKey: 'user:bluetooth-multi-racer',
    email: 'bluetooth-multi@tracklab.test',
    name: 'Bluetooth Multi Rider',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };

  await page.addInitScript(() => {
    const makeDevice = (index: number) => {
      const characteristic = Object.assign(new EventTarget(), {
        startNotifications: async () => characteristic,
        stopNotifications: async () => characteristic,
      });
      const server = {
        connected: true,
        disconnect: () => undefined,
        getPrimaryService: async (uuid: string) => {
          if (!uuid.startsWith('00001826')) {
            throw new Error('Service unavailable in test device.');
          }
          return { getCharacteristic: async () => characteristic };
        },
      };
      return Object.assign(new EventTarget(), {
        id: `browser-wattbike-${index}`,
        name: `PM2504395${index}`,
        gatt: {
          connected: true,
          connect: async () => server,
        },
      });
    };
    const authorizedStorageKey = 'tracklab-test-authorized-wattbikes';
    const authorizedCount = () => Number(window.localStorage.getItem(authorizedStorageKey) ?? 0);
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: async () => Array.from({ length: authorizedCount() }, (_, index) => makeDevice(index + 1)),
        requestDevice: async () => {
          const nextCount = Math.min(4, authorizedCount() + 1);
          window.localStorage.setItem(authorizedStorageKey, String(nextCount));
          return makeDevice(nextCount);
        },
      },
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ trackMappings: {}, count: 0 }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: {}, customRoutes: [], bikeProfiles: [] }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ghosts: [] }) });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: 'Pair Wattbike', exact: true }).click();
  let pairingDialog = page.getByRole('dialog', { name: 'Connect Wattbikes' });
  await pairingDialog.getByRole('button', { name: 'Choose first Wattbike' }).click();
  await expect(pairingDialog.locator('.bluetooth-pairing-slots article.connected')).toHaveCount(1);
  await expect(pairingDialog).toBeVisible();
  await pairingDialog.getByRole('button', { name: 'Choose another Wattbike' }).click();
  await expect(pairingDialog.locator('.bluetooth-pairing-slots article.connected')).toHaveCount(2);
  await expect(pairingDialog).toBeVisible();

  await page.reload();
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    // Authentication can complete between the visibility check and the click,
    // replacing the landing page with the dashboard. Do not wait for a button
    // that has already disappeared during that valid transition.
    await openApp.click({ timeout: 2_000 }).catch(() => undefined);
  }
  await expect(page.getByText('Bluetooth Direct paired')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Pair Wattbike', exact: true }).click();
  pairingDialog = page.getByRole('dialog', { name: 'Connect Wattbikes' });
  await expect(pairingDialog.locator('.bluetooth-pairing-slots article.connected')).toHaveCount(2);
});

test('dashboard analysis follows the map without a blank grid row', async ({ page }, testInfo) => {
  const authUser = {
    id: 'dashboard-layout-racer',
    profileKey: 'user:dashboard-layout-racer',
    email: 'dashboard-layout@tracklab.test',
    name: 'Dashboard Layout Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });

  await page.goto('/?track=north-bay-bmx-napa-valley');
  await page.getByRole('button', { name: 'Open App' }).click();
  const earthPanel = page.locator('.earth-panel');
  await expect(earthPanel).toBeVisible();
  await expect(earthPanel.locator('.earth-header').getByText('Google satellite view', { exact: true })).toBeVisible();
  await expect(earthPanel.getByRole('button', { name: '3D', exact: true })).toHaveCount(0);
  await expect(earthPanel.getByRole('link', { name: 'Open Maps', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-panel')).toBeVisible();
  const controlPanel = page.locator('.control-panel');
  await expect(controlPanel.getByText('Camera', { exact: true })).toHaveCount(0);
  await expect(controlPanel.getByText('Tilt', { exact: true })).toHaveCount(0);
  await expect(controlPanel.getByText('Heading', { exact: true })).toHaveCount(0);
  await expect(controlPanel.getByText('Speed units', { exact: true })).toBeVisible();

  const mapBounds = await earthPanel.boundingBox();
  const analysisBounds = await page.locator('.analytics-panel').boundingBox();
  expect(mapBounds).not.toBeNull();
  expect(analysisBounds).not.toBeNull();

  const analysisGap = analysisBounds!.y - (mapBounds!.y + mapBounds!.height);
  expect(analysisGap).toBeGreaterThanOrEqual(10);
  expect(analysisGap).toBeLessThanOrEqual(18);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('dashboard-analysis-directly-below-map.png'),
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  const tabletMapBounds = await page.locator('.earth-panel').boundingBox();
  const tabletControlBounds = await page.locator('.control-panel').boundingBox();
  const tabletAnalysisBounds = await page.locator('.analytics-panel').boundingBox();
  expect(tabletMapBounds).not.toBeNull();
  expect(tabletControlBounds).not.toBeNull();
  expect(tabletAnalysisBounds).not.toBeNull();

  const tabletControlGap = tabletControlBounds!.y - (tabletMapBounds!.y + tabletMapBounds!.height);
  const tabletAnalysisGap = tabletAnalysisBounds!.y - (tabletControlBounds!.y + tabletControlBounds!.height);
  expect(tabletControlGap).toBeGreaterThanOrEqual(10);
  expect(tabletControlGap).toBeLessThanOrEqual(18);
  expect(tabletAnalysisGap).toBeGreaterThanOrEqual(10);
  expect(tabletAnalysisGap).toBeLessThanOrEqual(18);

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('dashboard-analysis-tablet-order.png'),
  });
});

test('track map save waits for account sync and shared publication', async ({ page }) => {
  const authUser = {
    id: 'mapping-admin',
    profileKey: 'user:mapping-admin',
    email: 'mapping-admin@tracklab.test',
    name: 'Mapping Admin',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  let savedMapping: typeof mockPedalZoneMapping | null = null;

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/user-data?profileKey=*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [mockPedalZoneMapping.trackId]: mockPedalZoneMapping },
        customRoutes: [],
        bikeProfiles: [],
      }),
    });
  });
  await page.route('**/api/user-data/track-mapping', async (route) => {
    const payload = route.request().postDataJSON() as { mapping: typeof mockPedalZoneMapping };
    savedMapping = payload.mapping;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        mapping: payload.mapping,
        published: true,
        publicMapping: payload.mapping,
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await expect(page.getByRole('button', { name: 'BMX Race Intervals', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
  await expect(page.locator('#custom-route-section')).toHaveCount(0);
  await expect(page.getByLabel('Country').locator('option', { hasText: 'Custom Routes' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.locator('.platform-topbar').getByText('Straight Sprint', { exact: true })).toBeVisible();
  await expect(page.locator('#custom-route-section')).toBeVisible();
  await expect(page.getByLabel('Country')).toHaveCount(0);

  await page.getByRole('button', { name: 'BMX Race Intervals', exact: true }).click();
  await expect(page.locator('#custom-route-section')).toHaveCount(0);
  await expect(page.getByLabel('Country')).toBeVisible();
  await page.getByRole('button', { name: 'Edit map' }).click();
  const raceViewControl = page.getByLabel('Saved race view');
  await expect(raceViewControl.getByRole('button', { name: 'Satellite' })).toHaveClass(/selected/);
  await raceViewControl.getByRole('button', { name: '3D Terrain' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Saved and published across browsers.')).toBeVisible();
  expect(savedMapping?.trackId).toBe('black-mountain-bmx');
  expect(savedMapping?.zones[0]).toMatchObject({ startMeter: 0, endMeter: 30 });
  expect(savedMapping?.zones).toHaveLength(2);
  expect((savedMapping as typeof mockPedalZoneMapping & { raceViewMode?: string } | null)?.raceViewMode).toBe('3d');
  await page.locator('.mapping-section').getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('.earth-header').getByText('Google 3D race view', { exact: true })).toBeVisible();

  const regularPreview = page.getByLabel('Preview regular user interface');
  await expect(regularPreview).toBeVisible();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await expect(page.getByText('Demo race source online', { exact: true })).toBeVisible();
  await regularPreview.check();
  await expect(page.getByRole('button', { name: 'Edit map' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
  await expect(page.getByText('Map Zones', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Demo/i })).toHaveCount(0);
  await expect(page.getByLabel('Bike source')).toHaveCount(0);
  await expect(page.getByText('Demo race source online', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Tracks & Maps' })).toHaveCount(0);
  await regularPreview.uncheck();
  await expect(page.getByRole('button', { name: 'Edit map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tracks & Maps' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo/i }).first()).toBeVisible();
  await expect(page.getByLabel('Bike source')).toBeVisible();
});

test('legacy North Bay game mappings fall back to the satellite race route', async ({ page }) => {
  const authUser = {
    id: 'north-bay-game-admin',
    profileKey: 'user:north-bay-game-admin',
    email: 'preskiranch@gmail.com',
    name: 'North Bay Game Admin',
    admin: true,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };
  const northBayZoneRanges = [
    [0, 24], [35, 49], [66, 78], [88, 137], [147, 161], [167, 179], [190, 197],
    [203, 209], [216, 260], [274, 284], [316, 346], [351, 354], [363, 373],
  ];
  const northBayMapping = {
    ...mockPedalZoneMapping,
    trackId: 'north-bay-bmx-napa-valley',
    trackName: 'North Bay BMX - Napa Valley',
    lengthMeters: 373,
    centerline: [
      { lat: 38.2619697, lng: -122.2822171 },
      { lat: 38.2626822, lng: -122.2815695 },
      { lat: 38.2616165, lng: -122.2814663 },
      { lat: 38.262435, lng: -122.2816265 },
      { lat: 38.2621174, lng: -122.2818629 },
    ],
    startGate: { lat: 38.2619697, lng: -122.2822171 },
    finishLine: { lat: 38.2621174, lng: -122.2818629 },
    zoneBoundaryMeters: northBayZoneRanges.flat(),
    zoneBoundarySets: [{
      id: 'default-pedal-zones',
      name: 'Default pedal zones',
      boundaryMeters: northBayZoneRanges.flat(),
    }],
    zones: northBayZoneRanges.map(([startMeter, endMeter], index) => ({
      id: `pedal-zone-${index + 1}`,
      name: `Pedal Zone ${index + 1}`,
      startMeter,
      endMeter,
      type: 'pedal' as const,
    })),
    gameRoute: {
      id: 'amateur' as const,
      name: 'Game Track',
      restAfterSeconds: 1,
      lengthMeters: 373,
      centerline: [
        { lat: -0.00014, lng: 0.0003 },
        { lat: -0.00026, lng: 0.00086 },
        { lat: -0.00054, lng: 0.00114 },
        { lat: -0.00066, lng: 0.00035 },
        { lat: -0.00044, lng: 0.00083 },
        { lat: -0.00025, lng: 0.00043 },
      ],
      startGate: { lat: -0.00014, lng: 0.0003 },
      finishLine: { lat: -0.00025, lng: 0.00043 },
      zoneBoundaryMeters: northBayZoneRanges.flat(),
      zoneBoundarySets: [{
        id: 'default-pedal-zones',
        name: 'Default pedal zones',
        boundaryMeters: northBayZoneRanges.flat(),
      }],
      zones: northBayZoneRanges.map(([startMeter, endMeter], index) => ({
        id: `game-pedal-zone-${index + 1}`,
        name: `Pedal Zone ${index + 1}`,
        startMeter,
        endMeter,
        type: 'pedal' as const,
      })),
      splitSections: [],
    },
    raceViewMode: 'game' as const,
  };

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [northBayMapping.trackId]: northBayMapping },
        count: 1,
      }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [northBayMapping.trackId]: northBayMapping },
        customRoutes: [],
        bikeProfiles: [],
      }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ghosts: [] }) });
  });

  await page.goto('/?track=north-bay-bmx-napa-valley');
  await page.getByRole('button', { name: 'Open App' }).click();

  await expect(page.locator('.earth-header').getByText('Google satellite view', { exact: true })).toBeVisible();
  await expect(page.getByLabel('North Bay BMX fixed full-course game view')).toHaveCount(0);
  await expect(page.getByLabel('North Bay race view')).toHaveCount(0);
  await expect(page.locator('.earth-header')).toContainText('1,224 ft');

  await page.getByRole('button', { name: 'Edit map' }).click();
  const raceViewControl = page.getByLabel('Saved race view');
  await expect(raceViewControl.getByRole('button', { name: 'Satellite' })).toHaveClass(/selected/);
  await expect(raceViewControl.getByRole('button', { name: '3D Terrain' })).toBeVisible();
  await expect(raceViewControl.getByRole('button', { name: 'Game Track' })).toHaveCount(0);
  await expect(page.getByLabel('Mapping route layout')).toBeVisible();
});

test('straight sprint restores and saves a separate camera for each distance', async ({ page }) => {
  test.setTimeout(110_000);
  const trackId = 'custom-camera-distance-sprint';
  const customTrack = {
    id: trackId,
    name: 'Drag Strip',
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'New Hampshire',
    region: 'New Hampshire',
    source: 'Custom',
    sourceUrl: 'local://custom-route',
    address: 'Epping, NH, USA',
    latitude: 43.03,
    longitude: -71.08,
    lengthMeters: 500,
    elevationMeters: 0,
    surface: 'Custom sprint route',
    outline: [
      { lat: 43.03, lng: -71.08 },
      { lat: 43.035, lng: -71.08 },
    ],
    routeStatus: 'user-mapped',
    zones: [],
    leaderboards: { rpm: [], speed: [] },
  };
  const mapping = {
    ...mockNoPedalZoneMapping,
    trackId,
    trackName: customTrack.name,
    country: customTrack.country,
    state: customTrack.state,
    lengthMeters: 500,
    centerline: [
      { lat: 43.03, lng: -71.08 },
      { lat: 43.035, lng: -71.08 },
    ],
    startGate: { lat: 43.03, lng: -71.08 },
    finishLine: { lat: 43.035, lng: -71.08 },
  };
  let preferences = {
    cameraLocked: false,
    cameraLockedUpdatedAt: 1,
    earthCamerasByTrack: {
      [`${trackId}:sprint:100ft`]: {
        angle: 10,
        heading: 20,
        center: { lat: 43.0302, lng: -71.08 },
        zoom: 19,
        updatedAt: 10,
      },
      [`${trackId}:sprint:500ft`]: {
        angle: 50,
        heading: 200,
        center: { lat: 43.0308, lng: -71.08 },
        zoom: 18,
        updatedAt: 20,
      },
    },
    riderOverlaysByTrack: {
      [trackId]: {
        xPct: 0.02,
        yPct: 0.7,
        width: 1500,
        height: 220,
        locked: true,
      },
    },
  };
  const authUser = {
    id: 'sprint-camera-admin',
    profileKey: 'user:sprint-camera-admin',
    email: 'preskiranch@gmail.com',
    name: 'Sprint Camera Admin',
    admin: true,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };
  const commentarySpeechKinds: string[] = [];

  await page.addInitScript(({ storedTrack, storedMapping }) => {
    window.localStorage.setItem('tracklab-bmx-custom-routes-v1', JSON.stringify([storedTrack]));
    window.localStorage.setItem('tracklab:user-track-mappings:v1', JSON.stringify({
      [storedTrack.id]: storedMapping,
    }));
  }, { storedTrack: customTrack, storedMapping: mapping });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as { raceViewPreferences?: typeof preferences };
      if (patch.raceViewPreferences) {
        preferences = patch.raceViewPreferences;
      }
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [trackId]: mapping },
        customRoutes: [customTrack],
        bikeProfiles: [],
        studioRiders: [],
        raceViewPreferences: preferences,
      }),
    });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: { [trackId]: mapping }, count: 1 }),
    });
  });
  await page.route('**/api/public-custom-routes', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ customRoutes: [customTrack], count: 1 }),
    });
  });
  await page.route('**/api/global-race-view', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ raceViewPreferences: null }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ghosts: [{
          version: 1,
          id: 'slower-300-foot-sprint-ghost',
          trackId,
          trackName: customTrack.name,
          routeVariantId: 'amateur',
          riderName: 'Patient Ghost',
          ownerKey: authUser.profileKey,
          ownerName: authUser.name,
          colorName: 'blue',
          accent: '#2aa8ff',
          source: 'personal',
          raceSource: 'live',
          lapCount: 1,
          sprintDistanceFeet: 300,
          sprintAirSetting: 5,
          finishTimeMs: 25_000,
          thirtyFootTimeMs: 2_200,
          savedAt: Date.now(),
          analyticsPublic: false,
          medalRank: null,
          summary: null,
          zoneResults: [],
          points: [
            { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
            { elapsedMs: 12_500, distanceMeters: 45.72, velocityMps: 4, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
            { elapsedMs: 25_000, distanceMeters: 91.44, velocityMps: 0, phase: 'finished', pitch: 0, rank: 1, actualBranches: {}, finishedAt: 25_000 },
          ],
        }],
      }),
    });
  });
  await page.route('**/api/commentary/config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ aiAvailable: true, speechStatus: 'ready' }),
    });
  });
  await page.route('**/api/commentary/pre-race', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        line: 'Four riders are set for a flat-out drag strip sprint.',
        source: 'local',
        generatedAt: new Date().toISOString(),
        variableCount: 12,
        supportedVariableCount: 73,
        sources: [],
        weather: { available: false },
      }),
    });
  });
  await page.route('**/api/commentary/speech', async (route) => {
    const payload = route.request().postDataJSON() as { eventKind?: string };
    commentarySpeechKinds.push(payload.eventKind ?? '');
    await route.fulfill({
      contentType: 'audio/mpeg',
      path: 'public/assets/uci-random-start.mp3',
    });
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/?track=${trackId}`);
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: 'Straight Sprint', exact: true }).click();
  await expect(page.locator('.platform-topbar').getByText('Straight Sprint', { exact: true })).toBeVisible();
  await expect(page.getByText('Angle 10 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 20 deg', { exact: true })).toBeVisible();

  await page.getByLabel('Sprint distance').selectOption('500');
  await expect(page.getByText('Angle 50 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 200 deg', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tilt map up', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit map' }).click();
  await page.getByRole('button', { name: 'Tilt map up', exact: true }).click();
  await page.locator('.mapping-section').getByRole('button', { name: 'View', exact: true }).click();
  await expect.poll(() => preferences.earthCamerasByTrack[`${trackId}:sprint:500ft`]?.angle).toBe(55);
  expect(preferences.earthCamerasByTrack[`${trackId}:sprint:100ft`]?.angle).toBe(10);

  await page.getByLabel('Sprint distance').selectOption('100');
  await expect(page.getByText('Angle 10 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 20 deg', { exact: true })).toBeVisible();

  const sprintRaceView = page.getByRole('group', { name: 'Straight Sprint race view' });
  await expect(sprintRaceView.getByRole('button', { name: 'Game Arena', exact: true })).toBeVisible();
  await sprintRaceView.getByRole('button', { name: 'Game Arena', exact: true }).click();
  await expect(page.getByLabel('Drag Strip Game Arena', { exact: true })).toBeVisible();
  await page.getByLabel('Sprint distance').selectOption('500');

  await page.getByRole('button', { name: /Demo/i }).first().click();
  const sprintDemoRacers = page.getByRole('group', { name: 'Choose demo riders' });
  const sprintDemoRacerButtons = sprintDemoRacers.getByRole('button');
  await expect(sprintDemoRacerButtons).toHaveCount(4);
  await expect(sprintDemoRacerButtons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(sprintDemoRacerButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(sprintDemoRacerButtons.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(sprintDemoRacerButtons.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Bike pairing').locator('.pair-card')).toHaveCount(4);
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 1');
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 2');
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 3');
  await expect(page.getByLabel('Bike pairing')).toContainText('Demo Rider 4');
  await page.getByRole('group', { name: 'Wattbike Air setting' })
    .getByRole('button', { name: '5', exact: true }).click();
  const arena = page.getByLabel('Drag Strip Game Arena', { exact: true });
  await expect(arena.locator('[data-arena-adaptive-viewport]')).toHaveCount(1);
  await expect(arena.locator('[data-arena-world]')).toHaveAttribute('data-camera-layout', 'adaptive-single');
  const distanceMarkers = arena.locator('[data-arena-distance-markers]').first().locator('[data-distance-feet]');
  await expect(distanceMarkers).toHaveCount(17);
  await expect.poll(() => distanceMarkers.evaluateAll((markers) => (
    markers.map((marker) => Number(marker.getAttribute('data-distance-feet')))
  ))).toEqual([
    30, 100, 145, 200, 300, 400, 500, 600, 700, 800,
    900, 1000, 1100, 1200, 1300, 1400, 1500,
  ]);
  await expect(arena.locator('[data-distance-feet="500"][data-active-finish="true"]').first()).toBeAttached();
  const distanceUnitControl = page.getByRole('group', { name: 'Distance unit' });
  await distanceUnitControl.getByRole('button', { name: 'Meters', exact: true }).click();
  await expect(arena.locator('[data-distance-feet="30"]').first()).toContainText('9 m');
  await expect(arena.locator('[data-distance-feet="145"]').first()).toContainText('44 m');
  await expect(arena.locator('[data-distance-feet="1500"]').first()).toContainText('457 m');
  await distanceUnitControl.getByRole('button', { name: 'Feet', exact: true }).click();
  await expect(arena.locator('[data-distance-feet="30"]').first()).toContainText('30′');
  await page.getByLabel('Sprint distance').selectOption('145');
  await expect(arena.locator('[data-distance-feet="145"][data-active-finish="true"]').first()).toBeAttached();
  await page.getByLabel('Sprint distance').selectOption('1500');
  await expect(distanceMarkers).toHaveCount(17);
  await expect(arena.locator('[data-distance-feet="1500"][data-active-finish="true"]').first()).toBeAttached();
  await page.getByLabel('Sprint distance').selectOption('500');
  await expect(distanceMarkers).toHaveCount(17);
  await expect(arena.locator('[data-distance-feet="500"][data-active-finish="true"]').first()).toBeAttached();
  const initialArenaBox = await arena.boundingBox();
  const thirtyFootMarkerBox = await arena.locator('[data-distance-feet="30"]').first().boundingBox();
  expect(initialArenaBox).not.toBeNull();
  expect(thirtyFootMarkerBox).not.toBeNull();
  expect(Math.abs(
    (thirtyFootMarkerBox!.x + thirtyFootMarkerBox!.width / 2)
      - (initialArenaBox!.x + initialArenaBox!.width / 2),
  )).toBeLessThanOrEqual(4);
  const hundredFootMarkerWorldPercents = await distanceMarkers.evaluateAll((markers) => (
    markers
      .filter((marker) => Number(marker.getAttribute('data-distance-feet')) % 100 === 0)
      .map((marker) => Number(marker.getAttribute('data-world-percent')))
  ));
  for (let index = 2; index < hundredFootMarkerWorldPercents.length; index += 1) {
    expect(Math.abs(
      (hundredFootMarkerWorldPercents[index] - hundredFootMarkerWorldPercents[index - 1])
        - (hundredFootMarkerWorldPercents[1] - hundredFootMarkerWorldPercents[0]),
    )).toBeLessThanOrEqual(0.0002);
  }
  const bmxStartGate = arena.getByLabel('BMX start gate', { exact: true }).first();
  await expect(bmxStartGate).toBeVisible();
  await expect(bmxStartGate).toHaveAttribute('data-gate-state', 'upright');
  await expect(bmxStartGate.locator('[data-start-gate-lane]')).toHaveCount(4);
  await expect(bmxStartGate.locator('[data-start-platform-lane]')).toHaveCount(4);
  const previewStartLineBox = await arena.locator('[data-arena-start-line]').boundingBox();
  const frontTireBox = await arena.getByLabel(/Demo Rider 1 arena rider/)
    .locator('[data-arena-wheel="front"]')
    .boundingBox();
  const uprightGatePlateBox = await bmxStartGate.locator('[data-start-gate-lane="1"]').boundingBox();
  expect(previewStartLineBox).not.toBeNull();
  expect(frontTireBox).not.toBeNull();
  expect(uprightGatePlateBox).not.toBeNull();
  expect(Math.abs(
    (frontTireBox!.x + frontTireBox!.width) - previewStartLineBox!.x,
  )).toBeLessThanOrEqual(2);
  expect(Math.abs(
    (frontTireBox!.x + frontTireBox!.width) - uprightGatePlateBox!.x,
  )).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Start Demo Sprint', exact: true }).click();
  const raceControls = page.getByLabel('Fullscreen race controls', { exact: true });
  await expect(raceControls).toBeVisible();
  await expect(raceControls.getByRole('button', { name: 'Cancel Race', exact: true })).toBeVisible();
  await expect(raceControls.getByRole('button', { name: 'Pause Countdown', exact: true })).toBeVisible();
  const forceStartButton = raceControls.getByRole('button', { name: 'Force Start', exact: true });
  await expect(forceStartButton).toBeVisible();
  const controlBoxes = await raceControls.locator('button, .race-sprint-info-overlay, .earth-overlay').evaluateAll((controls) => (
    controls.map((control) => {
      const bounds = control.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    })
  ));
  for (let leftIndex = 0; leftIndex < controlBoxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < controlBoxes.length; rightIndex += 1) {
      const left = controlBoxes[leftIndex];
      const right = controlBoxes[rightIndex];
      const overlaps = left.left < right.right
        && left.right > right.left
        && left.top < right.bottom
        && left.bottom > right.top;
      expect(overlaps).toBe(false);
    }
  }
  if (process.env.TRACKLAB_RACE_CONTROLS_SCREENSHOT) {
    await page.screenshot({ path: process.env.TRACKLAB_RACE_CONTROLS_SCREENSHOT });
  }
  await forceStartButton.click();
  const startTree = page.getByLabel('BMX start tree light', { exact: true });
  await expect(startTree).toBeVisible({ timeout: 20_000 });
  await expect(bmxStartGate).toHaveAttribute('data-gate-phase', 'cadence');
  await expect(bmxStartGate).toHaveAttribute('data-gate-state', 'upright');
  await expect(forceStartButton).toHaveCount(0);
  await expect(page.locator('.earth-overlay.top-left')).toContainText('Live Race', { timeout: 15_000 });
  await expect(bmxStartGate).toHaveAttribute('data-gate-state', 'dropped');
  const sprintSetupBadge = page.locator('.race-countdown-pause-overlay').filter({ hasText: '500 ft Sprint' });
  await expect(sprintSetupBadge).toContainText('Wattbike Air 5', { timeout: 35_000 });
  await expect(arena.getByLabel(/Demo Rider 1 arena rider/)).toBeVisible();
  await expect(arena.getByLabel(/Demo Rider 2 arena rider/)).toBeVisible();
  await expect(arena.getByLabel(/Demo Rider 3 arena rider/)).toBeVisible();
  await expect(arena.getByLabel(/Demo Rider 4 arena rider/)).toBeVisible();
  await expect(arena).toHaveAttribute('data-race-distance-meters', '152.400');
  const liveStartLineBox = await arena.locator('[data-arena-start-line]').boundingBox();
  expect(liveStartLineBox).not.toBeNull();
  const laneLabelsAreUnobstructed = await arena.locator('[data-arena-lane-label]').evaluateAll((labels) => labels.map((label) => {
    const bounds = label.getBoundingClientRect();
    const topElement = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return topElement === label || label.contains(topElement);
  }));
  expect(laneLabelsAreUnobstructed).toEqual([true, true, true, true]);
  await page.waitForTimeout(1_200);
  const earlyRaceDebug = await page.evaluate(() => (window as typeof window & {
    __tracklabLiveDebug?: {
      raceState?: string;
      routeLengthMeters?: number;
      players?: Array<{
        riderDistanceMeters?: number | null;
        finishedAt?: number | null;
      }>;
    };
  }).__tracklabLiveDebug);
  expect(earlyRaceDebug?.raceState).toBe('racing');
  expect(earlyRaceDebug?.routeLengthMeters).toBeCloseTo(152.4, 3);
  expect(Math.max(...(earlyRaceDebug?.players ?? []).map((player) => player.riderDistanceMeters ?? 0)))
    .toBeLessThan(22);
  expect((earlyRaceDebug?.players ?? []).every((player) => player.finishedAt == null)).toBe(true);
  const firstArenaRider = arena.getByLabel(/Demo Rider 1 arena rider/);
  await expect.poll(async () => Number(await firstArenaRider.getAttribute('data-progress')))
    .toBeGreaterThan(0.01);
  const movingRiderBox = await firstArenaRider.boundingBox();
  const arenaBox = await arena.boundingBox();
  expect(movingRiderBox).not.toBeNull();
  expect(arenaBox).not.toBeNull();
  expect(movingRiderBox!.x + movingRiderBox!.width).toBeGreaterThan(liveStartLineBox!.x + 10);
  expect(movingRiderBox!.x).toBeGreaterThanOrEqual(arenaBox!.x - movingRiderBox!.width * 0.25);
  expect(movingRiderBox!.x + movingRiderBox!.width).toBeLessThanOrEqual(arenaBox!.x + arenaBox!.width + movingRiderBox!.width * 0.25);
  const arenaRiderBoxes = await Promise.all([1, 2, 3, 4].map(async (playerId) => {
    const arenaRider = arena.getByLabel(new RegExp(`Demo Rider ${playerId} arena rider`));
    await expect(arenaRider).toHaveAttribute('data-lane', String(playerId));
    return arenaRider.boundingBox();
  }));
  arenaRiderBoxes.forEach((box) => expect(box).not.toBeNull());
  for (let index = 1; index < arenaRiderBoxes.length; index += 1) {
    expect(arenaRiderBoxes[index]!.y - arenaRiderBoxes[index - 1]!.y).toBeGreaterThan(20);
  }
  const laneBandBoxes = await arena.locator('[data-arena-lane-band]').evaluateAll((bands) => bands.map((band) => {
    const bounds = band.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height };
  }));
  expect(laneBandBoxes).toHaveLength(4);
  laneBandBoxes.forEach((laneBand) => {
    expect(Math.abs(laneBand.height - laneBandBoxes[0].height)).toBeLessThanOrEqual(1);
  });
  for (let index = 1; index < laneBandBoxes.length; index += 1) {
    expect(Math.abs(laneBandBoxes[index].top - laneBandBoxes[index - 1].top - laneBandBoxes[0].height)).toBeLessThanOrEqual(1);
  }
  await expect(arena.locator('[data-arena-wheel="rear"]')).toHaveCount(4);
  await expect(arena.locator('[data-arena-wheel="front"]')).toHaveCount(4);
  const riderPanel = arena.getByLabel('Game arena rider data', { exact: true });
  await expect(riderPanel.locator('.game-arena-hud-card')).toHaveCount(4);
  await expect(page.getByLabel('Race rider positions', { exact: true })).toHaveCount(0);
  await expect(riderPanel).toContainText('Demo Rider 1');
  await expect(riderPanel).toContainText('Demo Rider 2');
  await expect(riderPanel).toContainText('Demo Rider 3');
  await expect(riderPanel).toContainText('Demo Rider 4');
  await expect(riderPanel).toContainText('% track');
  await expect(riderPanel).toContainText(/(?:MPH|KPH)/);
  const arenaMotionStyles = await arena.locator('[data-arena-world]').evaluate((world) => {
    const style = window.getComputedStyle(world);
    return {
      duration: style.transitionDuration,
      timing: style.transitionTimingFunction,
      willChange: style.willChange,
    };
  });
  expect(arenaMotionStyles.duration).toBe('0s');
  expect(arenaMotionStyles.willChange).toContain('transform');
  const arenaBackgroundTiles = arena.locator('[data-arena-background-tile]');
  expect(await arenaBackgroundTiles.count()).toBe(4);
  await expect(arenaBackgroundTiles.nth(0)).toHaveAttribute('data-tile-mirrored', 'false');
  await expect(arenaBackgroundTiles.nth(1)).toHaveAttribute('data-tile-mirrored', 'true');
  const backgroundTileGaps = await arenaBackgroundTiles.evaluateAll((tiles) => tiles.slice(1).map((tile, index) => {
    const previous = tiles[index].getBoundingClientRect();
    const current = tile.getBoundingClientRect();
    return current.left - previous.right;
  }));
  backgroundTileGaps.forEach((gap) => {
    expect(gap).toBeLessThanOrEqual(0.1);
    expect(gap).toBeGreaterThanOrEqual(-3);
  });
  await expect.poll(async () => Number(await firstArenaRider.getAttribute('data-progress')))
    .toBeGreaterThan(0.25);
  const midRaceRiderBoxes = await Promise.all([1, 2, 3, 4].map((playerId) => (
    arena.getByLabel(new RegExp(`Demo Rider ${playerId} arena rider`)).boundingBox()
  )));
  midRaceRiderBoxes.forEach((box) => {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(arenaBox!.x - box!.width * 0.25);
    expect(box!.x + box!.width).toBeLessThanOrEqual(arenaBox!.x + arenaBox!.width + box!.width * 0.25);
  });
  await expect.poll(async () => (
    Number(await arena.locator('[data-arena-world]').getAttribute('data-camera-scroll-percent'))
  )).toBeGreaterThan(0);
  await expect(arena.locator('[data-arena-adaptive-viewport]')).toHaveCount(1);
  if (process.env.TRACKLAB_GAME_ARENA_SCREENSHOT) {
    await page.screenshot({ path: process.env.TRACKLAB_GAME_ARENA_SCREENSHOT });
  }
  await expect(bmxStartGate).toHaveAttribute('data-gate-state', 'dropped');
  await page.getByRole('button', { name: 'Cancel Race', exact: true }).click();
  commentarySpeechKinds.length = 0;
  await page.getByLabel('Sprint distance').selectOption('300');
  const slowerSprintGhost = page.locator('.ghost-leaderboard-entry').filter({ hasText: 'Patient Ghost' });
  await expect(slowerSprintGhost).toBeVisible();
  await slowerSprintGhost.click();
  await expect(slowerSprintGhost).toContainText('Selected to race');
  const restartSprintButton = page.getByRole('button', { name: 'Start Demo Sprint', exact: true });
  await expect(restartSprintButton).toBeVisible();
  await restartSprintButton.click();
  await expect(bmxStartGate).toHaveAttribute('data-gate-phase', 'staging');
  await expect(bmxStartGate).toHaveAttribute('data-gate-state', 'upright');
  await page.getByRole('button', { name: 'Force Start', exact: true }).click();
  await expect(page.locator('.earth-overlay.top-left')).toContainText('Live Race', { timeout: 15_000 });
  await expect(arena).toHaveAttribute('data-race-distance-meters', '91.440');
  await expect.poll(
    () => commentarySpeechKinds.includes('race-start'),
    { timeout: 8_000 },
  ).toBe(true);
  const frameTiming = await arena.evaluate(async (arenaElement) => await new Promise<{
    frameCount: number;
    p95GapMs: number;
    maximumGapMs: number;
    cameraPositions: number;
  }>((resolve) => {
    const gaps: number[] = [];
    const cameraPositions = new Set<string>();
    let frameCount = 0;
    let startedAt = 0;
    let previousAt = 0;
    const collect = (now: number) => {
      if (startedAt === 0) {
        startedAt = now;
        previousAt = now;
      } else {
        gaps.push(now - previousAt);
        previousAt = now;
      }
      frameCount += 1;
      const cameraWorld = arenaElement.querySelector<HTMLElement>('[data-arena-world]');
      cameraPositions.add(cameraWorld?.dataset.cameraScrollPercent ?? '');
      if (now - startedAt < 1_800) {
        requestAnimationFrame(collect);
        return;
      }
      const sortedGaps = [...gaps].sort((left, right) => left - right);
      resolve({
        frameCount,
        p95GapMs: sortedGaps[Math.floor(sortedGaps.length * 0.95)] ?? 0,
        maximumGapMs: sortedGaps.at(-1) ?? 0,
        cameraPositions: cameraPositions.size,
      });
    };
    requestAnimationFrame(collect);
  }));
  expect(frameTiming.frameCount).toBeGreaterThan(30);
  expect(frameTiming.p95GapMs).toBeLessThan(70);
  expect(frameTiming.maximumGapMs).toBeLessThan(350);
  expect(frameTiming.cameraPositions).toBeGreaterThan(2);
  await expect.poll(async () => page.evaluate(() => (
    (window as typeof window & { __tracklabLiveDebug?: { raceState?: string } })
      .__tracklabLiveDebug?.raceState
  )), { timeout: 20_000 }).toBe('finished');
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(page.locator('.platform-shell')).not.toHaveClass(/race-fullscreen/, { timeout: 25_000 });
});

test('regular racers can use published tracks but cannot access mapping tools', async ({ page }) => {
  const authUser = {
    id: 'regular-racer',
    profileKey: 'user:regular-racer',
    email: 'regular-racer@tracklab.test',
    name: 'Regular Racer',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [mockPedalZoneMapping.trackId]: mockPedalZoneMapping },
        count: 1,
      }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [mockPedalZoneMapping.trackId]: mockPedalZoneMapping },
        customRoutes: [],
        bikeProfiles: [],
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();

  await expect(page.getByLabel('Race readiness')).toContainText('Track Ready');
  await expect(page.getByLabel('Race controls')).toBeVisible();
  await expect(page.locator('.race-control-dock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit map' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
  await expect(page.getByLabel('Preview regular user interface')).toHaveCount(0);
  await expect(page.getByText('Map Zones', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Demo/i })).toHaveCount(0);
  await expect(page.getByLabel('Bike source')).toHaveCount(0);
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('button', { name: 'Tracks & Maps' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Developer Tools' })).toHaveCount(0);
});

test('pedal-zone mapping can temporarily use 3D while normal views stay satellite', async ({ page }) => {
  const authUser = {
    id: 'mapping-3d-admin',
    profileKey: 'user:mapping-3d-admin',
    email: 'mapping-3d-admin@tracklab.test',
    name: 'Mapping 3D Admin',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/user-data?profileKey=*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { [mockPedalZoneMapping.trackId]: mockPedalZoneMapping },
        customRoutes: [],
        bikeProfiles: [],
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: 'Edit map' }).click();

  const mappingPanel = page.locator('.mapping-section');
  const adjustPoints = mappingPanel.getByRole('button', { name: 'Adjust points', exact: true });
  await expect(adjustPoints).toBeVisible();
  await adjustPoints.click();
  await expect(adjustPoints).toHaveClass(/selected/);
  await expect(mappingPanel.getByText('Tap a route point, then tap its new location', { exact: false })).toBeVisible();

  await mappingPanel.getByRole('button', { name: 'Pedal Zones', exact: true }).click();
  const obstacleToggle = mappingPanel.locator('.mapping-obstacle-view-toggle');
  await expect(obstacleToggle).toBeVisible();
  await expect(obstacleToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(obstacleToggle.getByText('Racing remains satellite.', { exact: false })).toBeVisible();

  const toggleBounds = await obstacleToggle.boundingBox();
  expect(toggleBounds).not.toBeNull();
  expect(toggleBounds!.height).toBeGreaterThanOrEqual(60);

  await obstacleToggle.click();
  await expect(obstacleToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.earth-header').getByText('3D obstacle view', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use satellite for pedal zone mapping' })).toBeVisible();

  await mappingPanel.getByRole('button', { name: 'Draw path', exact: true }).click();
  await expect(mappingPanel.locator('.mapping-obstacle-view-toggle')).toHaveCount(0);
  await expect(page.locator('.earth-header').getByText('Google satellite view', { exact: true })).toBeVisible();

  await mappingPanel.getByRole('button', { name: 'Pedal Zones', exact: true }).click();
  await expect(mappingPanel.locator('.mapping-obstacle-view-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('advanced connector prompts racer accounts to open the Mac connector', async ({ page }) => {
  const authUser = {
    id: 'connector-racer',
    profileKey: 'user:connector-racer',
    email: 'connector-racer@tracklab.test',
    name: 'Connector Rider',
    admin: false,
    membership: {
      tier: 'racer',
      bikeSeats: 1,
      updatedAt: Date.now(),
    },
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });

  await page.goto('/');

  await page.getByRole('button', { name: 'Open App' }).click();
  await expect(page.getByLabel('Race controls')).toBeVisible();
  await page.getByRole('button', { name: 'Advanced Connector' }).click();

  await expect(page.getByRole('button', { name: 'Open Mac Connector' })).toBeVisible();
  await expect(page.getByText(/runs locally in the background/i)).toBeVisible();
});

test('start here race action enters fullscreen race view', async ({ page }, testInfo) => {
  test.setTimeout(80_000);
  let commentarySpeechRequests = 0;
  let activeLiveSpeechRequests = 0;
  let maximumActiveLiveSpeechRequests = 0;
  const commentarySpeechPayloads: Array<{
    eventKind?: string;
    line?: string;
    riderNames?: string[];
    deliveryStyle?: string;
  }> = [];
  const preRaceRiderNames: string[][] = [];
  const authUser = {
    id: 'quick-start-racer',
    profileKey: 'user:quick-start-racer',
    email: 'preskiranch@gmail.com',
    name: 'Quick Start Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/commentary/config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ aiAvailable: true }),
    });
  });
  await page.route('**/api/commentary/speech', async (route) => {
    commentarySpeechRequests += 1;
    const payload = route.request().postDataJSON() as {
      eventKind?: string;
      line?: string;
      riderNames?: string[];
      deliveryStyle?: string;
    };
    commentarySpeechPayloads.push(payload);
    const isLiveRaceCall = payload.eventKind !== 'pre-race'
      && payload.eventKind !== 'preview'
      && payload.eventKind !== 'race-start';
    if (isLiveRaceCall) {
      activeLiveSpeechRequests += 1;
      maximumActiveLiveSpeechRequests = Math.max(
        maximumActiveLiveSpeechRequests,
        activeLiveSpeechRequests,
      );
    }
    if (payload.eventKind === 'pre-race') {
      await new Promise((resolve) => setTimeout(resolve, 6_500));
    } else if (payload.eventKind !== 'race-start') {
      await new Promise((resolve) => setTimeout(resolve, 2_600));
    }
    try {
      await route.fulfill({
        contentType: 'audio/wav',
        body: silentWavBuffer(3_500),
      });
    } finally {
      if (isLiveRaceCall) {
        activeLiveSpeechRequests -= 1;
      }
    }
  });
  await page.route('**/api/commentary/pre-race', async (route) => {
    const payload = route.request().postDataJSON() as {
      track?: {
        name?: string;
        riders?: Array<{ name?: string }>;
      };
    };
    const names = payload.track?.riders?.flatMap((rider) => (
      typeof rider.name === 'string' ? [rider.name] : []
    )) ?? [];
    preRaceRiderNames.push(names);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        line: `${names.join(', ')} are set for ${payload.track?.name ?? 'the track'} under clear skies. The gate is next.`,
        source: 'ai',
        generatedAt: new Date().toISOString(),
        variableCount: 67,
        supportedVariableCount: 73,
        weather: { available: true, provider: 'MET Norway', summary: 'clear' },
        sources: [{
          title: 'Data from MET Norway',
          url: 'https://www.met.no/en/free-meteorological-data',
          kind: 'weather',
        }],
      }),
    });
  });
  await page.route('**/api/commentary/line', async (route) => {
    const payload = route.request().postDataJSON() as {
      event?: {
        leaderPlayerId?: number;
        riders?: Array<{ playerId?: number; name?: string }>;
      };
      raceLines?: string[];
    };
    const riderNames = payload.event?.riders?.flatMap((rider) => (
      typeof rider.name === 'string' ? [rider.name] : []
    )) ?? [];
    const leaderName = payload.event?.riders?.find(
      (rider) => rider.playerId === payload.event?.leaderPlayerId,
    )?.name ?? riderNames[0] ?? 'The leader';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        line: `${leaderName} leads the charge through the next straight.`,
        deliveryStyle: 'wry',
      }),
    });
  });
  await page.addInitScript(() => {
    const audioWindow = window as typeof window & {
      __tracklabVoiceStartCount?: number;
      __tracklabCadenceVoiceStarts?: number;
      __tracklabGateToneStarts?: Array<number | string>;
      __tracklabTreeLightSequence?: string[];
      __tracklabTreeLightTimes?: number[];
      __tracklabAmbiencePlayCount?: number;
      __tracklabAmbienceLoadCount?: number;
      __tracklabAmbienceElements?: HTMLMediaElement[];
      __tracklabCommentaryPlaybackStarts?: Array<{
        eventKind: string;
        at: number;
      }>;
    };
    const originalMediaLoad = HTMLMediaElement.prototype.load;
    window.addEventListener('tracklab-commentary-playback-start', (event) => {
      const detail = (event as CustomEvent<{
        eventKind?: string;
        at?: number;
      }>).detail;
      if (typeof detail?.eventKind !== 'string' || !Number.isFinite(detail.at)) {
        return;
      }
      audioWindow.__tracklabCommentaryPlaybackStarts = [
        ...(audioWindow.__tracklabCommentaryPlaybackStarts ?? []),
        {
          eventKind: detail.eventKind,
          at: Number(detail.at),
        },
      ];
    });
    HTMLMediaElement.prototype.load = function (...args: Parameters<HTMLMediaElement['load']>) {
      if ((this.currentSrc || this.src).includes('/assets/bmx-event-ambience')) {
        audioWindow.__tracklabAmbienceLoadCount = (audioWindow.__tracklabAmbienceLoadCount ?? 0) + 1;
      }
      return Reflect.apply(originalMediaLoad, this, args);
    };
    const originalMediaPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args: Parameters<HTMLMediaElement['play']>) {
      if ((this.currentSrc || this.src).includes('/assets/uci-random-start.mp3')) {
        audioWindow.__tracklabCadenceVoiceStarts = (audioWindow.__tracklabCadenceVoiceStarts ?? 0) + 1;
      }
      const gateTone = this.getAttribute('data-tracklab-start-gate-tone');
      if (gateTone && gateTone !== 'prime') {
        audioWindow.__tracklabGateToneStarts = [
          ...(audioWindow.__tracklabGateToneStarts ?? []),
          gateTone,
        ];
      }
      if ((this.currentSrc || this.src).includes('/assets/bmx-event-ambience')) {
        audioWindow.__tracklabAmbiencePlayCount = (audioWindow.__tracklabAmbiencePlayCount ?? 0) + 1;
        audioWindow.__tracklabAmbienceElements = [
          ...new Set([...(audioWindow.__tracklabAmbienceElements ?? []), this]),
        ];
      }
      return Reflect.apply(originalMediaPlay, this, args);
    };
    const prototype = window.AudioBufferSourceNode?.prototype;
    if (prototype) {
      const originalStart = prototype.start;
      prototype.start = function (...args: Parameters<AudioBufferSourceNode['start']>) {
        audioWindow.__tracklabVoiceStartCount = (audioWindow.__tracklabVoiceStartCount ?? 0) + 1;
        return Reflect.apply(originalStart, this, args);
      };
    }

    const audioParamPrototype = window.AudioParam?.prototype;
    if (audioParamPrototype) {
      const originalSetValueAtTime = audioParamPrototype.setValueAtTime;
      audioParamPrototype.setValueAtTime = function (
        value: number,
        startTime: number,
      ) {
        if (value >= 631 && value <= 633) {
          audioWindow.__tracklabGateToneStarts = [
            ...(audioWindow.__tracklabGateToneStarts ?? []),
            value,
          ];
        }
        return Reflect.apply(originalSetValueAtTime, this, [value, startTime]);
      };
    }

    window.addEventListener('DOMContentLoaded', () => {
      let previousLight = '';
      const recordActiveLight = () => {
        const activeLights = document.querySelectorAll<HTMLElement>('.tree-lamp.active');
        const activeLight = activeLights.item(activeLights.length - 1)?.getAttribute('aria-label') ?? '';
        if (activeLight && activeLight !== previousLight) {
          audioWindow.__tracklabTreeLightSequence = [
            ...(audioWindow.__tracklabTreeLightSequence ?? []),
            activeLight,
          ];
          audioWindow.__tracklabTreeLightTimes = [
            ...(audioWindow.__tracklabTreeLightTimes ?? []),
            performance.now(),
          ];
          previousLight = activeLight;
        }
      };
      new MutationObserver(recordActiveLight).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }, { once: true });
  });

  await page.goto('/?track=air-time-bmx');

  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  const customDemoNames = ['Miles Power', 'Rasheen "The Machine" Hicks', 'Maya Torres', 'Jordan Lee'];
  for (let index = 0; index < customDemoNames.length; index += 1) {
    const nameInput = page.getByLabel(`Name for player ${index + 1}`);
    await expect(nameInput).toHaveValue(`Demo Rider ${index + 1}`);
    await nameInput.fill(customDemoNames[index]);
    await nameInput.press('Enter');
    await expect(nameInput).toHaveValue(customDemoNames[index]);
  }
  const longDashboardName = page.locator('.rider-stat-identity strong')
    .filter({ hasText: 'Rasheen "The Machine" Hicks' });
  await expect(longDashboardName).toBeVisible();
  const dashboardNameLayout = await longDashboardName.evaluate((name) => ({
    whiteSpace: getComputedStyle(name).whiteSpace,
    textOverflow: getComputedStyle(name).textOverflow,
    fitsWidth: name.scrollWidth <= name.clientWidth + 1,
    fitsHeight: name.scrollHeight <= name.clientHeight + 1,
  }));
  expect(dashboardNameLayout.whiteSpace).toBe('normal');
  expect(dashboardNameLayout.textOverflow).not.toBe('ellipsis');
  expect(dashboardNameLayout.fitsWidth).toBe(true);
  expect(dashboardNameLayout.fitsHeight).toBe(true);
  const longPairingName = page.getByLabel('Name for player 2');
  const pairingNameLayout = await longPairingName.evaluate((name) => ({
    wraps: getComputedStyle(name).whiteSpace === 'pre-wrap',
    fitsWidth: name.scrollWidth <= name.clientWidth + 1,
    fitsHeight: name.scrollHeight <= name.clientHeight + 1,
  }));
  expect(pairingNameLayout.wraps).toBe(true);
  expect(pairingNameLayout.fitsWidth).toBe(true);
  expect(pairingNameLayout.fitsHeight).toBe(true);
  const dashboardAvatarBounds = await page.locator('.rider-stat-avatar').first().boundingBox();
  const setupAvatarBounds = await page.locator('.pairing-rail .rider-photo-editor .rider-avatar').first().boundingBox();
  expect(dashboardAvatarBounds?.width).toBe(44);
  expect(dashboardAvatarBounds?.height).toBe(44);
  expect(setupAvatarBounds?.width).toBe(44);
  expect(setupAvatarBounds?.height).toBe(44);

  await expect(page.getByText('Developer ambient calibration')).toBeVisible();
  const ambientVolume = page.getByLabel('Ambient sound volume');
  await expect(ambientVolume).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock ambient volume' }).click();
  await expect(ambientVolume).toBeEnabled();
  await ambientVolume.fill('0.09');
  await expect(ambientVolume).toHaveValue('0.09');
  await page.getByRole('button', { name: 'Lock ambient volume' }).click();
  await expect(ambientVolume).toBeDisabled();

  const startAction = page.locator('.workflow-step.primary-action');
  await expect(startAction).toContainText('Start Demo Race');
  await startAction.click();

  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(page.locator('.race-staging-countdown')).toBeVisible();
  await expect(page.locator('.race-staging-countdown strong')).toHaveText(/20|1[8-9]/);
  const captureDuringStaging = async () => page.evaluate(() => {
    const capture = (window as typeof window & {
      __tracklabLastRaceCapture?: { status?: string; samples?: unknown[] } | null;
    }).__tracklabLastRaceCapture;
    return {
      samples: capture?.samples?.length ?? -1,
      status: capture?.status ?? 'missing',
    };
  });
  await expect.poll(captureDuringStaging).toEqual({ samples: 0, status: 'armed' });
  await page.waitForTimeout(800);
  expect(await captureDuringStaging()).toEqual({ samples: 0, status: 'armed' });
  await expect(page.locator('.start-tree-light')).toHaveCount(0);
  const riderPanel = page.locator('.race-rider-overlay');
  await expect(riderPanel).toBeVisible();
  for (const customName of customDemoNames) {
    await expect(riderPanel.getByText(customName, { exact: true })).toBeVisible();
  }
  const longFullscreenName = riderPanel.locator('.race-rider-overlay-identity strong')
    .filter({ hasText: 'Rasheen "The Machine" Hicks' });
  const fullscreenNameLayout = await longFullscreenName.evaluate((name) => ({
    whiteSpace: getComputedStyle(name).whiteSpace,
    textOverflow: getComputedStyle(name).textOverflow,
    fitsWidth: name.scrollWidth <= name.clientWidth + 1,
    fitsHeight: name.scrollHeight <= name.clientHeight + 1,
  }));
  expect(fullscreenNameLayout.whiteSpace).toBe('normal');
  expect(fullscreenNameLayout.textOverflow).not.toBe('ellipsis');
  expect(fullscreenNameLayout.fitsWidth).toBe(true);
  expect(fullscreenNameLayout.fitsHeight).toBe(true);
  const fullscreenAvatarBounds = await riderPanel.locator('.race-rider-overlay-avatar').first().boundingBox();
  expect(fullscreenAvatarBounds?.width).toBe(44);
  expect(fullscreenAvatarBounds?.height).toBe(44);
  await expect(page.locator('.race-commentary-caption')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabAmbiencePlayCount?: number;
    }).__tracklabAmbiencePlayCount ?? 0
  )), { timeout: 12_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => {
    const audioWindow = window as typeof window & {
      __tracklabAmbienceElements?: HTMLMediaElement[];
    };
    return (audioWindow.__tracklabAmbienceElements ?? []).filter(
      (ambience) => !ambience.paused && ambience.volume > 0,
    ).length;
  }), { timeout: 5_000 }).toBe(2);
  const activeAmbienceLayers = await page.evaluate(() => {
    const audioWindow = window as typeof window & {
      __tracklabAmbienceElements?: HTMLMediaElement[];
    };
    return (audioWindow.__tracklabAmbienceElements ?? []).map((ambience) => ({
      source: ambience.currentSrc || ambience.src,
      paused: ambience.paused,
      volume: ambience.volume,
    }));
  });
  expect(activeAmbienceLayers).toHaveLength(2);
  expect(activeAmbienceLayers.every((layer) => !layer.paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const audioWindow = window as typeof window & {
      __tracklabAmbienceElements?: HTMLMediaElement[];
    };
    return (audioWindow.__tracklabAmbienceElements ?? [])
      .reduce((total, ambience) => total + ambience.volume, 0);
  }), { timeout: 3_000 }).toBeCloseTo(0.09 * 1.08, 5);
  await expect(riderPanel.locator('.race-rider-overlay-card.positions-pending')).toHaveCount(4);
  await expect(riderPanel.locator('.race-rider-overlay-place')).toHaveCount(0);
  await expect.poll(() => commentarySpeechRequests, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(
    () => preRaceRiderNames.some((names) => customDemoNames.every((name) => names.includes(name))),
    { timeout: 5_000 },
  ).toBe(true);
  await expect.poll(
    () => commentarySpeechPayloads.some((payload) => (
      payload.eventKind === 'pre-race'
      && customDemoNames.every((name) => payload.riderNames?.includes(name))
    )),
    { timeout: 5_000 },
  ).toBe(true);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabCommentaryPlaybackStarts?: Array<{
        eventKind: string;
        at: number;
      }>;
    }).__tracklabCommentaryPlaybackStarts?.length ?? 0
  )), { timeout: 18_000 }).toBeGreaterThan(0);
  await expect.poll(
    () => commentarySpeechPayloads.some((payload) => (
      payload.eventKind === 'race-start'
      && customDemoNames.every((name) => payload.riderNames?.includes(name))
    )),
    { timeout: 5_000 },
  ).toBe(true);

  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  const riderPanelHandle = page.getByRole('button', { name: 'Move rider panel', exact: true });
  const riderPanelHandleBounds = await riderPanelHandle.boundingBox();
  expect(riderPanelHandleBounds).not.toBeNull();
  await page.mouse.move(
    riderPanelHandleBounds!.x + (riderPanelHandleBounds!.width / 2),
    riderPanelHandleBounds!.y + (riderPanelHandleBounds!.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    riderPanelHandleBounds!.x + (riderPanelHandleBounds!.width / 2) + 24,
    riderPanelHandleBounds!.y + (riderPanelHandleBounds!.height / 2) - 18,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);

  const riderPanelResize = page.getByRole('button', { name: 'Resize rider overlay', exact: true });
  const riderPanelResizeBounds = await riderPanelResize.boundingBox();
  expect(riderPanelResizeBounds).not.toBeNull();
  await page.mouse.move(
    riderPanelResizeBounds!.x + (riderPanelResizeBounds!.width / 2),
    riderPanelResizeBounds!.y + (riderPanelResizeBounds!.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(
    riderPanelResizeBounds!.x + (riderPanelResizeBounds!.width / 2) + 20,
    riderPanelResizeBounds!.y + (riderPanelResizeBounds!.height / 2) + 18,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);

  await page.evaluate(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  });
  await page.waitForTimeout(15_500);
  await expect(page.locator('.race-staging-countdown')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabCommentaryPlaybackStarts?: Array<{
        eventKind: string;
        at: number;
      }>;
    }).__tracklabCommentaryPlaybackStarts?.length ?? 0
  )), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const bikeAudio = (window as typeof window & {
      __tracklabBikeRaceAudio?: {
        ready: boolean;
        seenModes: Record<number, string[]>;
      };
    }).__tracklabBikeRaceAudio;
    return {
      ready: bikeAudio?.ready ?? false,
      modes: [...new Set(Object.values(bikeAudio?.seenModes ?? {}).flat())].sort(),
    };
  }), { timeout: 12_000 }).toEqual({
    ready: true,
    modes: ['freewheel', 'pedaling'],
  });
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabCadenceVoiceStarts?: number;
    }).__tracklabCadenceVoiceStarts ?? 0
  )), { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabGateToneStarts?: Array<number | string>;
    }).__tracklabGateToneStarts?.length ?? 0
  )), { timeout: 10_000 }).toBe(4);
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabTreeLightSequence?: string[] }).__tracklabTreeLightSequence ?? []
  )), { timeout: 3_000 }).toEqual(['Red', 'Yellow one', 'Yellow two', 'Green']);
  const treeLightTimes = await page.evaluate(() => (
    (window as typeof window & { __tracklabTreeLightTimes?: number[] }).__tracklabTreeLightTimes ?? []
  ));
  expect(treeLightTimes).toHaveLength(4);
  const treeLightIntervals = treeLightTimes.slice(1).map((time, index) => (
    time - treeLightTimes[index]
  ));
  for (const interval of treeLightIntervals) {
    expect(interval).toBeGreaterThanOrEqual(90);
    expect(interval).toBeLessThanOrEqual(300);
  }
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabCommentaryPlaybackStarts?: Array<{
        eventKind: string;
        at: number;
      }>;
    }).__tracklabCommentaryPlaybackStarts?.filter(
      (playback) => playback.eventKind !== 'pre-race',
    ).length ?? 0
  )), { timeout: 16_000 }).toBeGreaterThanOrEqual(3);
  const commentaryPlaybackStarts = await page.evaluate(() => (
    (window as typeof window & {
      __tracklabCommentaryPlaybackStarts?: Array<{
        eventKind: string;
        at: number;
      }>;
    }).__tracklabCommentaryPlaybackStarts ?? []
  ));
  const raceStartPlayback = commentaryPlaybackStarts.find(
    (playback) => playback.eventKind === 'race-start',
  );
  expect(raceStartPlayback).toBeDefined();
  expect(raceStartPlayback!.at - treeLightTimes.at(-1)!).toBeGreaterThanOrEqual(-100);
  expect(raceStartPlayback!.at - treeLightTimes.at(-1)!).toBeLessThanOrEqual(750);
  const liveCommentaryStarts = commentaryPlaybackStarts.filter(
    (playback) => playback.eventKind !== 'pre-race',
  );
  expect(liveCommentaryStarts.length).toBeGreaterThanOrEqual(3);
  const liveCommentaryStartGaps = liveCommentaryStarts.slice(1).map(
    (playback, index) => playback.at - liveCommentaryStarts[index].at,
  );
  // The fixture is six seconds long and non-start calls are deliberately
  // delayed by 2.6 seconds, leaving no room for a quarter-lap silent start.
  expect(
    Math.max(...liveCommentaryStartGaps),
    JSON.stringify(liveCommentaryStarts),
  ).toBeLessThanOrEqual(10_000);
  expect(commentarySpeechPayloads.filter((payload) => (
    payload.eventKind === 'race-start'
    && customDemoNames.every((name) => payload.riderNames?.includes(name))
    && customDemoNames.every((name) => payload.line?.includes(name))
  ))).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => {
    const audioWindow = window as typeof window & {
      __tracklabAmbienceElements?: HTMLMediaElement[];
      __tracklabAmbienceLoadCount?: number;
    };
    const ambienceLayers = audioWindow.__tracklabAmbienceElements ?? [];
    return {
      loadCount: audioWindow.__tracklabAmbienceLoadCount ?? 0,
      activeLayerCount: ambienceLayers.filter((ambience) => !ambience.paused).length,
      audibleLayerCount: ambienceLayers.filter((ambience) => ambience.volume > 0).length,
    };
  }), { timeout: 3_000 }).toEqual({
    loadCount: 2,
    activeLayerCount: 2,
    audibleLayerCount: 2,
  });
  await expect(riderPanel.locator('.race-rider-overlay-place')).toHaveCount(4, { timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => {
    const capture = (window as typeof window & {
      __tracklabLastRaceCapture?: { status?: string; samples?: unknown[] } | null;
    }).__tracklabLastRaceCapture;
    return capture?.status === 'racing' && (capture.samples?.length ?? 0) > 0;
  }), { timeout: 5_000 }).toBe(true);
  await expect.poll(
    () => commentarySpeechPayloads.some((payload) => (
      payload.eventKind !== 'pre-race'
      && payload.eventKind !== 'preview'
      && payload.eventKind !== 'race-start'
      && customDemoNames.some((name) => payload.line?.includes(name))
      && customDemoNames.every((name) => payload.riderNames?.includes(name))
    )),
    { timeout: 10_000 },
  ).toBe(true);
  await expect.poll(
    () => commentarySpeechPayloads.filter((payload) => (
      payload.eventKind !== 'pre-race'
      && payload.eventKind !== 'preview'
      && payload.eventKind !== 'race-start'
    )).length,
    { timeout: 12_000 },
  ).toBeGreaterThanOrEqual(3);
  expect(maximumActiveLiveSpeechRequests).toBe(1);
  const desktopRiderText = await riderPanel.locator('.race-rider-overlay-card').first().evaluate((card) => {
    const name = card.querySelector('.race-rider-overlay-identity strong');
    const metrics = card.querySelector('.race-rider-overlay-identity span');
    const place = card.querySelector('.race-rider-overlay-place strong');
    const summaryBounds = card.querySelector('.race-rider-overlay-summary')?.getBoundingClientRect();
    const placeBounds = card.querySelector('.race-rider-overlay-place')?.getBoundingClientRect();
    return {
      name: name ? Number.parseFloat(getComputedStyle(name).fontSize) : 0,
      metrics: metrics ? Number.parseFloat(getComputedStyle(metrics).fontSize) : 0,
      place: place ? Number.parseFloat(getComputedStyle(place).fontSize) : 0,
      placeIsBottomRow: Boolean(
        summaryBounds
        && placeBounds
        && placeBounds.top >= summaryBounds.bottom
        && placeBounds.width >= summaryBounds.width
      ),
    };
  });
  expect(desktopRiderText.name).toBeGreaterThanOrEqual(18);
  expect(desktopRiderText.metrics).toBeGreaterThanOrEqual(14);
  expect(desktopRiderText.place).toBeGreaterThanOrEqual(42);
  expect(desktopRiderText.placeIsBottomRow).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(riderPanel.locator('.race-rider-overlay-card')).toHaveCount(4);
  const mobileRiderText = await riderPanel.locator('.race-rider-overlay-card').first().evaluate((card) => {
    const name = card.querySelector('.race-rider-overlay-identity strong');
    const metrics = card.querySelector('.race-rider-overlay-identity span');
    const place = card.querySelector('.race-rider-overlay-place strong');
    return {
      name: name ? Number.parseFloat(getComputedStyle(name).fontSize) : 0,
      metrics: metrics ? Number.parseFloat(getComputedStyle(metrics).fontSize) : 0,
      place: place ? Number.parseFloat(getComputedStyle(place).fontSize) : 0,
    };
  });
  expect(mobileRiderText.name).toBeGreaterThanOrEqual(16);
  expect(mobileRiderText.metrics).toBeGreaterThanOrEqual(12);
  expect(mobileRiderText.place).toBeGreaterThanOrEqual(34);
  const mobileAvatarBounds = await riderPanel.locator('.race-rider-overlay-avatar').first().boundingBox();
  expect(mobileAvatarBounds?.width).toBe(44);
  expect(mobileAvatarBounds?.height).toBe(44);
  const mobileCardsFit = await riderPanel.evaluate((panel) => {
    const panelBounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('.race-rider-overlay-card')].every((card) => {
      const cardBounds = card.getBoundingClientRect();
      return cardBounds.left >= panelBounds.left
        && cardBounds.right <= panelBounds.right
        && cardBounds.top >= panelBounds.top
        && cardBounds.bottom <= panelBounds.bottom;
    });
  });
  expect(mobileCardsFit).toBe(true);
  await testInfo.attach('demo-race-rider-panel-mobile.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(riderPanel.locator('.race-rider-overlay-card')).toHaveCount(4);
  for (const customName of customDemoNames) {
    await expect(riderPanel.getByText(customName, { exact: true })).toBeVisible();
  }
  const tabletCardsFit = await riderPanel.evaluate((panel) => {
    const panelBounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('.race-rider-overlay-card')].every((card) => {
      const cardBounds = card.getBoundingClientRect();
      return cardBounds.left >= panelBounds.left
        && cardBounds.right <= panelBounds.right
        && cardBounds.top >= panelBounds.top
        && cardBounds.bottom <= panelBounds.bottom;
    });
  });
  expect(tabletCardsFit).toBe(true);
  await testInfo.attach('demo-race-rider-panel-tablet.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await testInfo.attach('demo-race-3d.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
  await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
});

test.describe('mobile commentary playback', () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });

  test('keeps AI announcing on iPad-style browsers when delayed media playback is blocked', async ({ page }) => {
    test.setTimeout(65_000);
    let speechRequests = 0;
    const speechEventKinds: string[] = [];
    const speechPayloads: Array<{
      eventKind?: string;
      voicePreset?: string;
      line?: string;
    }> = [];
    let injectedLiveSpeechFailure = false;
    let preRaceReportReleased = false;
    let releasePreRaceReport = () => {};
    const preRaceReportGate = new Promise<void>((resolve) => {
      releasePreRaceReport = resolve;
    });
    let preRaceStudioVoiceStartedBeforeReport = false;
    const authUser = {
      id: 'ipad-commentary-racer',
      profileKey: 'user:ipad-commentary-racer',
      email: 'ipad-commentary@tracklab.test',
      name: 'iPad Commentary Rider',
      admin: true,
      membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
    };

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/commentary/config', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ aiAvailable: true }),
      });
    });
    await page.route('**/api/commentary/speech', async (route) => {
      speechRequests += 1;
      const payload = route.request().postDataJSON() as {
        eventKind?: string;
        voicePreset?: string;
        line?: string;
      };
      speechPayloads.push(payload);
      speechEventKinds.push(payload.eventKind ?? '');
      if (payload.eventKind === 'pre-race' && !preRaceReportReleased) {
        preRaceStudioVoiceStartedBeforeReport = true;
      }
      const liveRaceCall = payload.eventKind !== 'preview'
        && payload.eventKind !== 'pre-race'
        && payload.eventKind !== 'race-start';
      if (liveRaceCall && !injectedLiveSpeechFailure) {
        injectedLiveSpeechFailure = true;
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Temporary natural speech timeout.',
            code: 'speech_unavailable',
          }),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
      await route.fulfill({
        contentType: 'audio/mpeg',
        path: 'public/assets/uci-random-start.mp3',
      });
    });
    await page.route('**/api/commentary/pre-race', async (route) => {
      const payload = route.request().postDataJSON() as {
        track?: { name?: string; riders?: Array<{ name?: string }> };
      };
      const names = payload.track?.riders?.flatMap((rider) => (
        typeof rider.name === 'string' ? [rider.name] : []
      )) ?? [];
      await Promise.race([
        preRaceReportGate,
        new Promise((resolve) => setTimeout(resolve, 30_000)),
      ]);
      preRaceReportReleased = true;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          line: `${names.join(', ')} are ready at ${payload.track?.name ?? 'the track'}. The gate is next.`,
          source: 'ai',
          generatedAt: new Date().toISOString(),
          variableCount: 58,
          supportedVariableCount: 73,
          sources: [],
          weather: { available: false },
        }),
      });
    });
    await page.route('**/api/commentary/line', async (route) => {
      const payload = route.request().postDataJSON() as {
        event?: { riders?: Array<{ name?: string }> };
      };
      const riderName = payload.event?.riders?.[0]?.name ?? 'The leader';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          line: `${riderName} drives the pace while the whole field stays in the fight.`,
          deliveryStyle: 'straight',
        }),
      });
    });
    await page.addInitScript(() => {
      const audioWindow = window as typeof window & {
        __tracklabBlockedMediaPlayCount?: number;
        __tracklabBufferPlaybackCount?: number;
        __tracklabCadenceMediaPlayCount?: number;
        __tracklabAmbienceMediaPlayCount?: number;
        __tracklabBrowserFallbackCount?: number;
      };
      class MockSpeechSynthesisUtterance {
        lang = '';
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pitch = 1;
        rate = 1;
        text: string;
        voice: SpeechSynthesisVoice | null = null;
        volume = 1;

        constructor(text: string) {
          this.text = text;
        }
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: MockSpeechSynthesisUtterance,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel() {},
          getVoices: () => [],
          resume() {},
          speak(utterance: MockSpeechSynthesisUtterance) {
            audioWindow.__tracklabBrowserFallbackCount = (
              audioWindow.__tracklabBrowserFallbackCount ?? 0
            ) + 1;
            window.setTimeout(() => utterance.onend?.(), 0);
          },
        },
      });
      HTMLMediaElement.prototype.play = function () {
        const source = String(this.currentSrc || this.src || '');
        if (source.includes('/assets/uci-random-start.mp3')) {
          audioWindow.__tracklabCadenceMediaPlayCount = (
            audioWindow.__tracklabCadenceMediaPlayCount ?? 0
          ) + 1;
        }
        if (source.includes('/assets/bmx-event-ambience')) {
          audioWindow.__tracklabAmbienceMediaPlayCount = (
            audioWindow.__tracklabAmbienceMediaPlayCount ?? 0
          ) + 1;
        }
        audioWindow.__tracklabBlockedMediaPlayCount = (
          audioWindow.__tracklabBlockedMediaPlayCount ?? 0
        ) + 1;
        return Promise.reject(new DOMException('Playback needs a user gesture.', 'NotAllowedError'));
      };
      const prototype = window.AudioBufferSourceNode?.prototype;
      if (prototype) {
        const originalStart = prototype.start;
        prototype.start = function (...args: Parameters<AudioBufferSourceNode['start']>) {
          audioWindow.__tracklabBufferPlaybackCount = (
            audioWindow.__tracklabBufferPlaybackCount ?? 0
          ) + 1;
          return Reflect.apply(originalStart, this, args);
        };
      }
    });

    await page.goto('/?track=air-time-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();
    await page.getByRole('button', { name: /Demo/i }).first().click();
    await page.waitForTimeout(1_500);
    expect(speechPayloads).toHaveLength(0);
    await expect(page.getByLabel('Announcer voice')).toHaveCount(0);
    await expect(page.getByText('American male', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview selected voice' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Race type' })).toHaveCount(0);
    expect(await page.evaluate(() => ({
      cadence: (window as typeof window & {
        __tracklabCadenceMediaPlayCount?: number;
      }).__tracklabCadenceMediaPlayCount ?? 0,
      ambience: (window as typeof window & {
        __tracklabAmbienceMediaPlayCount?: number;
      }).__tracklabAmbienceMediaPlayCount ?? 0,
    }))).toEqual({ cadence: 0, ambience: 0 });
    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Demo Race');
    await startAction.click();

    await expect.poll(() => speechRequests, { timeout: 8_000 }).toBeGreaterThan(0);
    await expect.poll(
      () => speechEventKinds.includes('pre-race'),
      { timeout: 8_000 },
    ).toBe(true);
    expect(preRaceStudioVoiceStartedBeforeReport).toBe(true);
    expect(speechPayloads.find((payload) => payload.eventKind === 'pre-race')?.voicePreset)
      .toBe('american-man');
    releasePreRaceReport();
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & {
        __tracklabBlockedMediaPlayCount?: number;
      }).__tracklabBlockedMediaPlayCount ?? 0
    ))).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & {
        __tracklabBufferPlaybackCount?: number;
      }).__tracklabBufferPlaybackCount ?? 0
    )), { timeout: 35_000 }).toBeGreaterThanOrEqual(4);
    await expect.poll(
      () => speechEventKinds.includes('race-start'),
      { timeout: 35_000 },
    ).toBe(true);
    await expect.poll(
      () => speechEventKinds.some((kind) => (
        kind !== 'preview'
        && kind !== 'pre-race'
        && kind !== 'race-start'
      )),
      { timeout: 35_000 },
    ).toBe(true);
    expect(injectedLiveSpeechFailure).toBe(true);
    await expect.poll(
      () => speechEventKinds.filter((kind) => (
        kind !== 'preview'
        && kind !== 'pre-race'
        && kind !== 'race-start'
      )).length,
      { timeout: 35_000 },
    ).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => (
      (window as typeof window & {
        __tracklabBrowserFallbackCount?: number;
      }).__tracklabBrowserFallbackCount ?? 0
    ))).toBe(0);
    await expect(page.getByLabel('Race commentary')).toBeAttached();
  });

  test('never switches to robotic browser speech after natural voice quota failure', async ({ page }) => {
    test.setTimeout(35_000);
    let hostedSpeechAttempts = 0;
    const authUser = {
      id: 'ipad-commentary-fallback-racer',
      profileKey: 'user:ipad-commentary-fallback-racer',
      email: 'ipad-commentary-fallback@tracklab.test',
      name: 'Fallback Commentary Rider',
      admin: true,
      membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
    };

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {},
          customRoutes: [],
          bikeProfiles: [],
          studioRiders: [],
          raceViewPreferences: null,
        }),
      });
    });
    await page.route('**/api/commentary/config', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          aiAvailable: true,
          speechStatus: 'ready',
        }),
      });
    });
    await page.route('**/api/commentary/speech', async (route) => {
      hostedSpeechAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Natural commentary is paused because the OpenAI API project has no available quota.',
          code: 'insufficient_quota',
        }),
      });
    });
    await page.route('**/api/commentary/pre-race', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          line: 'All four riders are set and the gate is next.',
          source: 'local',
          generatedAt: new Date().toISOString(),
          variableCount: 12,
          supportedVariableCount: 73,
          sources: [],
          weather: { available: false },
        }),
      });
    });
    await page.addInitScript(() => {
      const audioWindow = window as typeof window & {
        __tracklabBrowserFallbackCalls?: Array<{ line: string; voice: string }>;
      };
      class MockSpeechSynthesisUtterance {
        lang = '';
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        pitch = 1;
        rate = 1;
        text: string;
        voice: SpeechSynthesisVoice | null = null;
        volume = 1;

        constructor(text: string) {
          this.text = text;
        }
      }
      const alexVoice = {
        default: true,
        lang: 'en-US',
        localService: true,
        name: 'Alex',
        voiceURI: 'Alex',
      } as SpeechSynthesisVoice;
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: MockSpeechSynthesisUtterance,
      });
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel() {},
          getVoices: () => [alexVoice],
          resume() {},
          speak(utterance: MockSpeechSynthesisUtterance) {
            audioWindow.__tracklabBrowserFallbackCalls = [
              ...(audioWindow.__tracklabBrowserFallbackCalls ?? []),
              { line: utterance.text, voice: utterance.voice?.name ?? '' },
            ];
            window.setTimeout(() => utterance.onend?.(), 0);
          },
        },
      });
    });

    await page.goto('/?track=air-time-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();
    await page.getByRole('button', { name: /Demo/i }).first().click();
    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Demo Race');
    await startAction.click();

    await expect.poll(() => hostedSpeechAttempts, { timeout: 5_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (
      (window as typeof window & {
        __tracklabBrowserFallbackCalls?: Array<{ line: string; voice: string }>;
      }).__tracklabBrowserFallbackCalls ?? []
    ))).toHaveLength(0);
    await expect(page.getByText('Natural voice paused')).toBeAttached();
    await page.waitForTimeout(1_000);
    const attemptsAfterCircuitOpened = hostedSpeechAttempts;
    await page.waitForTimeout(21_000);
    expect(hostedSpeechAttempts).toBe(attemptsAfterCircuitOpened);
  });
});

test('loop races expose lap controls and ranked ghost selection without a cadence card', async ({ page }, testInfo) => {
  const authUser = {
    id: 'loop-ghost-racer',
    profileKey: 'user:loop-ghost-racer',
    email: 'loop-ghost@tracklab.test',
    name: 'Loop Ghost Rider',
    admin: true,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };
  const ghostPoints = [
    { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
    { elapsedMs: 18_000, distanceMeters: 220, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
  ];

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: { 'black-mountain-bmx': mockLoopMapping }, count: 1 }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ trackMappings: {}, customRoutes: [], bikeProfiles: [] }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    const demoGhosts = Array.from({ length: 4 }, (_, index) => ({
      version: 1,
      id: `demo-loop-ghost-${index + 1}`,
      trackId: 'black-mountain-bmx',
      trackName: 'Black Mountain BMX',
      routeVariantId: 'amateur',
      riderName: `Demo Rider ${index + 1}`,
      ownerKey: authUser.profileKey,
      ownerName: authUser.name,
      colorName: 'lime',
      accent: '#7ade36',
      source: 'personal',
      raceSource: 'demo',
      lapCount: 1,
      finishTimeMs: 14_000 + (index * 1_000),
      thirtyFootTimeMs: 1_700,
      savedAt: Date.now(),
      analyticsPublic: false,
      medalRank: null,
      summary: null,
      zoneResults: [],
      points: ghostPoints,
    }));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ghosts: [
          ...demoGhosts,
          {
            version: 1,
            id: 'personal-loop-ghost',
            trackId: 'black-mountain-bmx',
            trackName: 'Black Mountain BMX',
            routeVariantId: 'amateur',
            riderName: 'Studio Bike One',
            ownerKey: authUser.profileKey,
            ownerName: authUser.name,
            colorName: 'lime',
            accent: '#7ade36',
            source: 'personal',
            raceSource: 'live',
            lapCount: 1,
            finishTimeMs: 18_500,
            thirtyFootTimeMs: 1_800,
            savedAt: Date.now(),
            analyticsPublic: false,
            medalRank: 2,
            summary: null,
            zoneResults: [],
            points: ghostPoints,
          },
          {
            version: 1,
            id: 'world-loop-ghost',
            trackId: 'black-mountain-bmx',
            trackName: 'Black Mountain BMX',
            routeVariantId: 'amateur',
            riderName: 'World Leader',
            ownerKey: 'user:world-leader',
            ownerName: 'World Leader',
            colorName: 'red',
            accent: '#ff4d42',
            source: 'top',
            raceSource: 'live',
            lapCount: 1,
            finishTimeMs: 18_000,
            thirtyFootTimeMs: 1_700,
            savedAt: Date.now(),
            analyticsPublic: false,
            medalRank: 1,
            summary: null,
            zoneResults: [],
            points: ghostPoints,
          },
        ],
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();

  await expect(page.getByRole('heading', { name: 'Number of laps' })).toBeVisible();
  await expect(page.locator('.lap-stepper input')).toHaveValue('1');
  const startHereLapCounter = page.getByRole('group', { name: 'Loop race lap count' });
  await expect(startHereLapCounter).toBeVisible();
  await expect(startHereLapCounter).toContainText('1 lap');
  await expect(page.getByText('Top 3')).toBeVisible();
  await expect(page.getByText('Demo Ghosts')).toHaveCount(0);
  await expect(page.getByText('Demo Rider 1')).toHaveCount(0);
  await expect(page.getByText('Studio Bike One')).toBeVisible();
  await expect(page.getByText('World Leader')).toBeVisible();
  await expect(page.locator('.ghost-section .leaderboard-rank')).toHaveText(['#1', '#2']);
  await expect(page.getByRole('img', { name: 'First place gold cup' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Second place silver cup' })).toBeVisible();
  await expect(page.locator('.ghost-section .leaderboard-rider-avatar')).toHaveCount(2);
  const loopLeaderboardAvatar = await page.locator('.ghost-section .leaderboard-rider-avatar').first().boundingBox();
  expect(loopLeaderboardAvatar?.width).toBe(108);
  expect(loopLeaderboardAvatar?.height).toBe(108);
  await expect(page.getByText('Gate start', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Countdown', exact: true })).toHaveCount(0);
  const personalGhost = page.locator('.ghost-leaderboard-entry').filter({ hasText: 'Studio Bike One' });
  await personalGhost.click();
  await expect(personalGhost.getByText('Selected to race')).toBeVisible();
  await expect(page.locator('.ghost-summary-row')).toContainText('1 selected');
  const ghostWorkflowStep = page.locator('.workflow-step').filter({ hasText: 'Ghost' });
  await expect(ghostWorkflowStep).toHaveClass(/ghost-selected/);
  await expect(ghostWorkflowStep).toContainText('1 selected');
  await page.locator('.loop-race-section').scrollIntoViewIfNeeded();
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('loop-laps-and-ghosts.png'),
  });

  await page.getByRole('button', { name: 'Increase Start Here lap count' }).click();
  await expect(startHereLapCounter).toContainText('2 laps');
  await expect(page.locator('.lap-stepper input')).toHaveValue('2');
  await expect(page.getByText('Complete a live Wattbike race on this track to create the first ranked ghost.')).toBeVisible();
});

test('completed race finishes the active sentence and authoritative placements before returning to dashboard analysis', async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const finishSpeechPayloads: Array<{
    eventKind?: string;
    line?: string;
    riderNames?: string[];
  }> = [];
  let releaseHeldFinishSpeech = () => {};
  const heldFinishSpeech = new Promise<void>((resolve) => {
    releaseHeldFinishSpeech = resolve;
  });
  let holdFinishSpeech = true;
  const authUser = {
    id: 'post-race-review-racer',
    profileKey: 'user:post-race-review-racer',
    email: 'post-race-review@tracklab.test',
    name: 'Review Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  const leaderboardPhotoUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const ghostLeaderboardRiders = ['Alex Rider', 'Sam Carter', 'Jamie Lee', 'Taylor Smith'];
  const ghostLeaderboardLaps = ghostLeaderboardRiders.map((riderName, index) => {
    const finishTimeMs = 28_000 + (index * 1_000);
    const playerId = (index + 1) as 1 | 2 | 3 | 4;
    const topCadence = 146 - (index * 4);
    const topSpeedKph = 48 - index;
    const topWatts = 1_420 - (index * 80);
    return {
      version: 1,
      id: `review-ghost-${index + 1}`,
      trackId: 'black-mountain-bmx',
      trackName: 'Black Mountain BMX',
      routeVariantId: 'amateur',
      riderName,
      ...(index === 3 ? {} : { photoUrl: leaderboardPhotoUrl }),
      ownerKey: index === 0 ? authUser.profileKey : `user:review-ghost-${index + 1}`,
      ownerName: riderName,
      colorName: ['lime', 'blue', 'red', 'yellow'][index],
      accent: ['#7ade36', '#34a8ff', '#ff4d42', '#ffd43b'][index],
      source: index === 0 ? 'personal' : 'top',
      raceSource: 'live',
      lapCount: 1,
      finishTimeMs,
      thirtyFootTimeMs: 1_650 + (index * 75),
      savedAt: Date.UTC(2026, 6, index + 1),
      analyticsPublic: true,
      medalRank: index < 3 ? index + 1 : null,
      summary: {
        playerId,
        riderName,
        colorName: ['lime', 'blue', 'red', 'yellow'][index],
        accent: ['#7ade36', '#34a8ff', '#ff4d42', '#ffd43b'][index],
        deviceLabel: `Review Bike ${index + 1}`,
        rank: index + 1,
        finishTimeMs,
        thirtyFootTimeMs: 1_650 + (index * 75),
        distanceMeters: 120,
        sampleCount: 300,
        topSpeedKph,
        averageSpeedKph: topSpeedKph - 5,
        topCadence,
        averageCadence: topCadence - 22,
        topWatts,
        averageWatts: topWatts - 300,
      },
      zoneResults: [{
        zoneId: 'zone-1',
        zoneName: 'Pedal Zone 1',
        zoneType: 'pedal',
        startMeter: 0,
        endMeter: 25,
        riders: [{
          playerId,
          sampleCount: 20,
          entryElapsedMs: 0,
          exitElapsedMs: 4_000,
          durationMs: 4_000,
          topSpeedKph,
          averageSpeedKph: topSpeedKph - 4,
          topCadence,
          averageCadence: topCadence - 18,
          topWatts,
          averageWatts: topWatts - 250,
        }],
      }],
      points: [
        { elapsedMs: 0, distanceMeters: 0, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: index + 1, actualBranches: {} },
        { elapsedMs: finishTimeMs, distanceMeters: 120, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: index + 1, actualBranches: {} },
      ],
    };
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/commentary/config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ aiAvailable: true }),
    });
  });
  await page.route('**/api/commentary/speech', async (route) => {
    const payload = route.request().postDataJSON() as {
      eventKind?: string;
      line?: string;
      riderNames?: string[];
    };
    if (payload.eventKind === 'finish' || payload.eventKind === 'rider-finish') {
      finishSpeechPayloads.push(payload);
      if (holdFinishSpeech) {
        await heldFinishSpeech;
      }
    }
    await route.fulfill({
      contentType: 'audio/wav',
      // Keep the gate call speaking through this short demo race. The final
      // placement call must queue behind it rather than cutting it off.
      body: silentWavBuffer(payload.eventKind === 'race-start' ? 10_000 : 500),
    });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {
          'black-mountain-bmx': mockPostRaceReviewMapping,
        },
        count: 1,
      }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: [{
          id: 'studio-taylor-smith',
          name: 'Taylor Smith',
          photoUrl: leaderboardPhotoUrl,
          createdAt: Date.UTC(2026, 5, 1),
          updatedAt: Date.UTC(2026, 6, 1),
        }],
      }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ghosts: ghostLeaderboardLaps }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await page.getByLabel('Name for player 1').fill('Rasheen "The Machine" Hicks');
  await page.getByLabel('Name for player 2').fill('Thomas T');
  await page.getByLabel('Name for player 3').fill('Spicy Bean');
  await page.getByLabel('Name for player 4').fill('Wasabi');
  await expect(page.getByText(/1 pedal zone/i).first()).toBeVisible({ timeout: 15_000 });

  const startAction = page.locator('.workflow-step.primary-action');
  await expect(startAction).toContainText('Start Demo Race');
  await startAction.click();
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/, { timeout: 8_000 });

  const finishCountdown = page.locator('.race-finish-countdown');
  await expect.poll(async () => (
    await finishCountdown.isVisible()
    || await page.evaluate(() => (
      (window as typeof window & {
        __tracklabLiveDebug?: { raceState?: string };
      }).__tracklabLiveDebug?.raceState === 'finished'
    ))
  ), { timeout: 60_000 }).toBe(true);
  if (await finishCountdown.isVisible()) {
    await expect(finishCountdown.locator('strong')).toHaveText(/10|[1-9]/);
    await expect(finishCountdown).toContainText('remaining riders still racing');
  }
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  const raceStillActive = await page.evaluate(() => (
    (window as typeof window & {
      __tracklabLiveDebug?: { raceState?: string };
    }).__tracklabLiveDebug?.raceState === 'racing'
  ));
  if (raceStillActive) {
    await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
  }
  await page.waitForTimeout(1_000);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);

  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabLiveDebug?: { raceState?: string };
    }).__tracklabLiveDebug?.raceState
  )), { timeout: 12_000 }).toBe('finished');
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  const finalPlacementCards = page.locator('.race-rider-overlay-place');
  await expect(finalPlacementCards).toHaveCount(4);
  await expect(finalPlacementCards).toHaveText([
    /1st\s*Place/i,
    /2nd\s*Place/i,
    /3rd\s*Place/i,
    /4th\s*Place/i,
  ]);
  await page.waitForTimeout(750);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(finalPlacementCards).toHaveCount(4);
  expect(finishSpeechPayloads.filter((payload) => (
    /wins.*second.*third.*fourth/i.test(payload.line ?? '')
  ))).toHaveLength(0);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('finished-race-zone-label-placement.png'),
  });

  await expect.poll(
    () => finishSpeechPayloads.at(-1)?.line ?? '',
    { timeout: 12_000 },
  ).toMatch(/wins.*second.*third.*fourth/i);
  holdFinishSpeech = false;
  releaseHeldFinishSpeech();
  expect(finishSpeechPayloads.length).toBeGreaterThanOrEqual(1);
  expect(finishSpeechPayloads.length).toBeLessThanOrEqual(2);
  expect(finishSpeechPayloads.at(-1)?.eventKind).toBe('rider-finish');
  expect(finishSpeechPayloads.at(-1)?.riderNames).toHaveLength(4);
  expect(finishSpeechPayloads.map((payload) => payload.line).join(' '))
    .not.toMatch(/still racing|race continues|keeps charging/i);
  await expect(page.locator('.platform-shell')).not.toHaveClass(/race-fullscreen/, { timeout: 12_000 });
  await expect(page.getByRole('region', { name: 'Post-race review' })).toHaveCount(0);
  await expect(page.locator('.race-review-screen')).toHaveCount(0);

  const dashboardAnalysis = page.locator('.analytics-panel');
  const zoneTableCard = dashboardAnalysis.locator('.zone-table-card');
  await expect(zoneTableCard).toBeVisible();
  await expect(zoneTableCard.locator('thead th')).toHaveCount(6);
  await expect(zoneTableCard.getByText('Reaction', { exact: false })).toHaveCount(0);
  const zoneRiderHeaders = zoneTableCard.locator('.zone-rider-header');
  await expect(zoneRiderHeaders).toHaveCount(4);
  await expect(zoneRiderHeaders.nth(0).locator('strong')).toHaveText('Rasheen');
  await expect(zoneRiderHeaders.nth(0).locator('em')).toHaveText('“The Machine”');
  await expect(zoneRiderHeaders.nth(0).locator('span').last()).toHaveText('Hicks');
  await expect(zoneRiderHeaders.nth(1).locator('strong')).toHaveText('Thomas');
  await expect(zoneRiderHeaders.nth(1).locator('span').last()).toHaveText('T');
  await expect(zoneRiderHeaders.nth(3).locator('strong')).toHaveText('Wasabi');

  const riderCells = zoneTableCard.locator('tbody tr').first().locator('.zone-rider-metrics');
  await expect(riderCells).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    const riderCell = riderCells.nth(index);
    for (const metric of ['Max cadence', 'Max speed']) {
      const value = riderCell.locator('.table-metric').filter({ hasText: metric }).locator('strong');
      await expect(value).not.toHaveText('--');
    }
  }
  await expect(dashboardAnalysis.getByText(/Max power|Top watts|Avg watts/i)).toHaveCount(0);

  const zoneTableFits = await zoneTableCard.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(zoneTableFits).toBe(true);
  const summaryAvatarBounds = await dashboardAnalysis.locator('.summary-rider-avatar').first().boundingBox();
  expect(summaryAvatarBounds?.width).toBe(38);
  expect(summaryAvatarBounds?.height).toBe(38);
  const leaderboardCard = dashboardAnalysis.locator('.leaderboard-card');
  await expect(leaderboardCard.getByText('Ghost Racer Leaderboard')).toBeVisible();
  await expect(leaderboardCard.locator('.leaderboard-tabs')).toHaveCount(0);
  await expect(leaderboardCard.getByText('Top 3 — Fastest Lap')).toBeVisible();
  await expect(leaderboardCard.locator('.leaderboard-podium-row')).toHaveCount(3);
  await expect(leaderboardCard.locator('.leaderboard-trophy')).toHaveCount(3);
  await expect(leaderboardCard.locator('.leaderboard-rider-avatar')).toHaveCount(4);
  await expect(leaderboardCard.locator('.leaderboard-rider-avatar img')).toHaveCount(4);
  await expect(leaderboardCard.locator('.leaderboard-podium-row').first()).toContainText('28.00s');
  await expect(leaderboardCard.getByRole('img', { name: 'First place gold cup' })).toBeVisible();
  await expect(leaderboardCard.getByRole('img', { name: 'Second place silver cup' })).toBeVisible();
  await expect(leaderboardCard.getByRole('img', { name: 'Third place bronze cup' })).toBeVisible();
  const fourthLeaderboardRider = leaderboardCard.locator('.leaderboard-ranked-row').first();
  await expect(fourthLeaderboardRider).not.toBeVisible();
  await leaderboardCard.locator('.ghost-rank-dropdown > summary').click();
  await expect(fourthLeaderboardRider).toBeVisible();
  await expect(fourthLeaderboardRider.locator('.leaderboard-rider-avatar')).toBeVisible();
  const podiumLeaderboardAvatar = await leaderboardCard.locator('.leaderboard-podium-row .leaderboard-rider-avatar').first().boundingBox();
  const rankedLeaderboardAvatar = await fourthLeaderboardRider.locator('.leaderboard-rider-avatar').boundingBox();
  expect(podiumLeaderboardAvatar?.width).toBe(108);
  expect(podiumLeaderboardAvatar?.height).toBe(108);
  expect(rankedLeaderboardAvatar?.width).toBe(108);
  expect(rankedLeaderboardAvatar?.height).toBe(108);
  const firstGhostCard = leaderboardCard.locator('.ghost-leaderboard-entry').filter({ hasText: 'Alex Rider' });
  await firstGhostCard.click();
  await expect(firstGhostCard).toContainText('Selected to race');
  const zoneCardBounds = await zoneTableCard.boundingBox();
  const leaderboardBounds = await leaderboardCard.boundingBox();
  expect(zoneCardBounds).not.toBeNull();
  expect(leaderboardBounds).not.toBeNull();
  expect(leaderboardBounds!.y).toBeGreaterThan(zoneCardBounds!.y + zoneCardBounds!.height);

  await zoneTableCard.scrollIntoViewIfNeeded();
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('post-race-dashboard-zone-peaks.png'),
  });
});

test('live race with mapped pedal zones stays active through UCI gate cadence', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const bridge = await createMockBikeBridge();
  let moving = false;
  const sampleTimer = setInterval(() => bridge.broadcast(mockBikeSample({
    watts: moving ? 320 : 0,
    cadence: moving ? 88 : 0,
    speedKph: moving ? 24 : 0,
  })), 120);
  const authUser = {
    id: 'pedal-zone-live-racer',
    profileKey: 'user:pedal-zone-live-racer',
    email: 'pedal-zone-live@tracklab.test',
    name: 'Pedal Zone Live Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 1,
      updatedAt: Date.now(),
    },
  };

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/public-track-mappings', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {
            'black-mountain-bmx': mockPedalZoneMapping,
          },
          count: 1,
        }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {},
          customRoutes: [],
          bikeProfiles: [],
        }),
      });
    });
    await page.route('**/api/ghosts*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ghosts: [{
            version: 1,
            id: 'live-race-ghost',
            trackId: 'black-mountain-bmx',
            trackName: 'Black Mountain BMX',
            routeVariantId: 'amateur',
            riderName: 'Cyan Ghost',
            ownerKey: authUser.profileKey,
            ownerName: authUser.name,
            colorName: 'lime',
            accent: '#7ade36',
            source: 'personal',
            raceSource: 'live',
            lapCount: 1,
            finishTimeMs: 30_000,
            thirtyFootTimeMs: 1_900,
            savedAt: Date.now(),
            analyticsPublic: false,
            medalRank: null,
            summary: null,
            zoneResults: [],
            points: [
              { elapsedMs: 0, distanceMeters: 2, velocityMps: 5, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
              { elapsedMs: 30_000, distanceMeters: 120, velocityMps: 0, phase: 'pedaling', pitch: 0, rank: 1, actualBranches: {} },
            ],
          }],
        }),
      });
    });
    await page.route('**/api/multiplayer/leaderboards*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ rpm: [], speed: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();

    await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
    await expect(page.getByText(/1 connected bike/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/2 pedal zones/i).first()).toBeVisible({ timeout: 15_000 });
    const ghostOption = page.locator('.ghost-leaderboard-entry').filter({ hasText: 'Cyan Ghost' });
    await ghostOption.click();
    await expect(ghostOption.getByText('Selected to race')).toBeVisible();
    await expect(page.locator('.workflow-step').filter({ hasText: 'Ghost' })).toHaveClass(/ghost-selected/);

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown')).toBeVisible();
    await expect(page.getByLabel('Race layout locked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock View', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unlock rider panel', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resize rider overlay', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rotate map left', exact: true })).toHaveCount(0);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/20|1[8-9]/);
    await expect(page.locator('.start-tree-light')).toHaveCount(0);
    await expect(page.locator('.rider-stat.ghost')).toContainText('Ghost 1 / 0%');
    await page.waitForTimeout(8_500);

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/1[0-2]/);
    await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
    await expect(page.getByText(/False start/i)).toHaveCount(0);
    await page.screenshot({
      fullPage: false,
      path: testInfo.outputPath('mapped-pedal-zone-live-race.png'),
    });
    await expect.poll(async () => page.evaluate(() => {
      const debug = (window as typeof window & {
        __tracklabLiveDebug?: {
          raceState?: string;
        };
      }).__tracklabLiveDebug;
      return debug?.raceState;
    }), { timeout: 23_000 }).toBe('racing');
    moving = true;
    await expect.poll(async () => page.evaluate(() => {
      const debug = (window as typeof window & {
        __tracklabLiveDebug?: {
          players?: Array<{ riderDistanceMeters?: number | null }>;
        };
      }).__tracklabLiveDebug;
      return debug?.players?.[0]?.riderDistanceMeters ?? 0;
    }), { timeout: 3_000 }).toBeGreaterThan(0.25);
    await expect.poll(async () => page.evaluate(() => {
      const rider = (window as typeof window & {
        __tracklabLiveDebug?: {
          players?: Array<{
            riderDistanceMeters?: number | null;
            riderDriveAllowed?: boolean | null;
            riderDriveSource?: string | null;
            riderPedalPhase?: number | null;
          }>;
        };
      }).__tracklabLiveDebug?.players?.[0];
      return rider?.riderDriveAllowed === false
        ? {
          distanceInCoastZone: (
            (rider.riderDistanceMeters ?? 0) >= 30
            && (rider.riderDistanceMeters ?? 0) < 60
          ),
          driveSource: rider.riderDriveSource,
          pedalPhase: rider.riderPedalPhase,
        }
        : null;
    }), { timeout: 10_000 }).toEqual({
      distanceInCoastZone: true,
      driveSource: 'blocked',
      pedalPhase: 0,
    });
    await expect.poll(async () => page.evaluate(() => {
      const rider = (window as typeof window & {
        __tracklabLiveDebug?: {
          players?: Array<{
            riderDistanceMeters?: number | null;
            riderDriveAllowed?: boolean | null;
          }>;
        };
      }).__tracklabLiveDebug?.players?.[0];
      return (
        (rider?.riderDistanceMeters ?? 0) >= 60
        && rider?.riderDriveAllowed === true
      );
    }), { timeout: 10_000 }).toBe(true);
    await expect(page.getByText(/False start/i)).toHaveCount(0);
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});

test('live cadence detects a false start and automatically rearms after five seconds', async ({ page }, testInfo) => {
  test.setTimeout(80_000);
  const bridge = await createMockBikeBridge();
  let moving = false;
  const sampleTimer = setInterval(() => bridge.broadcast(mockBikeSample({
    watts: moving ? 140 : 0,
    cadence: moving ? 25 : 0,
    speedKph: moving ? 3 : 0,
  })), 120);
  const authUser = {
    id: 'false-start-live-racer',
    profileKey: 'user:false-start-live-racer',
    email: 'false-start-live@tracklab.test',
    name: 'False Start Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 1,
      updatedAt: Date.now(),
    },
  };

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/public-track-mappings', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {
            'black-mountain-bmx': mockNoPedalZoneMapping,
          },
          count: 1,
        }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ trackMappings: {}, customRoutes: [], bikeProfiles: [] }),
      });
    });
    await page.route('**/api/ghosts*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ghosts: [] }),
      });
    });
    await page.route('**/api/multiplayer/leaderboards*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ rpm: [], speed: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();
    await expect(page.getByText(/1 connected bike/i).first()).toBeVisible({ timeout: 15_000 });

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();
    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.start-tree-light')).toBeVisible({ timeout: 25_000 });

    moving = true;
    const falseStart = page.locator('.race-staging-countdown').filter({ hasText: 'False start' });
    await expect(falseStart).toBeVisible({ timeout: 5_000 });
    await expect(falseStart.locator('strong')).toHaveText(/[1-5]/);
    moving = false;

    await page.screenshot({
      fullPage: false,
      path: testInfo.outputPath('live-false-start-reset.png'),
    });

    await expect(falseStart).toHaveCount(0, { timeout: 7_000 });
    await expect(page.locator('.start-tree-light')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect.poll(async () => page.evaluate(() => {
      const debug = (window as typeof window & {
        __tracklabLiveDebug?: { raceState?: string };
      }).__tracklabLiveDebug;
      return debug?.raceState;
    })).toBe('ready');
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});

test('two-bike live race stays fullscreen through UCI cadence with no pedal zones', async ({ page }, testInfo) => {
  const bridge = await createMockBikeBridge([58701, 58702]);
  const raceViewPreferencePatches: Array<{
    cameraLocked?: boolean;
    riderOverlaysByTrack?: Record<string, { locked?: boolean }>;
  }> = [];
  const sampleTimer = setInterval(() => {
    bridge.broadcast(mockBikeSample({
      deviceId: 58701,
      watts: 260,
      cadence: 72,
      speedKph: 18,
      signal: 93,
    }));
    bridge.broadcast(mockBikeSample({
      deviceId: 58702,
      watts: 220,
      cadence: 68,
      speedKph: 16,
      signal: 91,
    }));
  }, 120);
  const authUser = {
    id: 'two-bike-live-racer',
    profileKey: 'user:two-bike-live-racer',
    email: 'preskiranch@gmail.com',
    name: 'Two Bike Live Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 2,
      updatedAt: Date.now(),
    },
  };

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/public-track-mappings', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {
            'black-mountain-bmx': mockNoPedalZoneMapping,
          },
          count: 1,
        }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      const payload = route.request().method() === 'PATCH'
        ? route.request().postDataJSON() as {
          raceViewPreferences?: {
            cameraLocked?: boolean;
            riderOverlaysByTrack?: Record<string, { locked?: boolean }>;
          };
        }
        : null;
      if (payload?.raceViewPreferences) {
        raceViewPreferencePatches.push(payload.raceViewPreferences);
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {},
          customRoutes: [],
          bikeProfiles: [],
          ...(payload?.raceViewPreferences
            ? { raceViewPreferences: payload.raceViewPreferences }
            : {}),
        }),
      });
    });
    await page.route('**/api/ghosts*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ghosts: [] }),
      });
    });
    await page.route('**/api/multiplayer/leaderboards*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ rpm: [], speed: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();

    await expect(page.getByRole('button', { name: 'Straight Sprint', exact: true })).toBeVisible();
    await expect(page.getByText(/2 connected bikes/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/0 entered \/ 2 connected/i)).toBeVisible();

    await expect(page.locator('.workflow-step').filter({ hasText: 'Race' })).toContainText('Choose racer');
    await page.getByRole('button', { name: /Enter monitor ID 701 in live race/i }).click();
    await expect(page.getByText(/1 entered \/ 2 connected/i)).toBeVisible();

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown')).toBeVisible();
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('20');
    await expect(page.locator('.start-tree-light')).toHaveCount(0);
    await page.getByRole('button', { name: 'Pause Countdown', exact: true }).click();
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('PAUSED');
    const pausedDetail = await page.locator('.race-staging-countdown span').innerText();
    await page.waitForTimeout(1_200);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('PAUSED');
    await expect(page.locator('.race-staging-countdown span')).toHaveText(pausedDetail);

    await page.getByRole('button', { name: 'Lock View', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View Locked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Rotate map left', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Lock rider panel position and size', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlock rider panel', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Resize rider overlay', exact: true })).toHaveCount(0);
    await expect.poll(() => raceViewPreferencePatches.some((preferences) => (
      preferences.cameraLocked === true
      && preferences.riderOverlaysByTrack?.['black-mountain-bmx']?.locked === true
    )), { timeout: 5_000 }).toBe(true);

    await page.getByRole('button', { name: 'Resume Countdown', exact: true }).click();
    await expect(page.locator('.race-staging-countdown strong')).not.toHaveText('PAUSED');
    await page.waitForTimeout(8_500);

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/1[0-2]/);
    await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
    await page.screenshot({
      fullPage: false,
      path: testInfo.outputPath('two-bike-live-race-no-pedal-zones.png'),
    });
    await page.getByRole('button', { name: /Cancel Race/i }).click();
    await expect(page.locator('.platform-shell')).not.toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown')).toHaveCount(0);
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});

test('connected bike names remain bound to their monitor IDs after reload', async ({ page }) => {
  const deviceIds = [43853, 58701];
  const wattbikePmLabels = ['WattbikePM25043950', 'WattbikePM25043851'];
  const bridge = await createMockBikeBridge(deviceIds);
  const sampleTimer = setInterval(() => {
    deviceIds.forEach((deviceId, index) => {
      bridge.broadcast(mockBikeSample({
        deviceId,
        label: wattbikePmLabels[index],
        watts: 180 + index * 20,
        cadence: 64 + index * 4,
        speedKph: 0,
      }));
    });
  }, 120);
  const authUser = {
    id: 'bike-profile-racer',
    profileKey: 'user:bike-profile-racer',
    email: 'bike-profile@tracklab.test',
    name: 'Bike Profile Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  let cloudBikeProfiles = deviceIds.map((deviceId, index) => ({
    deviceId,
    name: 'Bike 58701Watt',
    colorName: index === 0 ? 'red' : 'yellow',
    accent: index === 0 ? '#ff4d42' : '#ffd83d',
    updatedAt: 100 + index,
  }));

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as { bikeProfiles?: typeof cloudBikeProfiles };
        if (Array.isArray(patch.bikeProfiles)) {
          cloudBikeProfiles = patch.bikeProfiles;
        }
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {},
          customRoutes: [],
          bikeProfiles: cloudBikeProfiles,
        }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();

    await expect(page.getByText(/2 connected bikes/i)).toBeVisible({ timeout: 15_000 });
    const raceEntry = page.locator('.workflow-race-entry');
    await expect(raceEntry.getByText('Bike 43853', { exact: true })).toHaveCount(0);
    await expect(raceEntry.getByText('Bike 58701Watt', { exact: true })).toHaveCount(0);
    await expect(raceEntry.getByText('950', { exact: true })).toBeVisible();
    await expect(raceEntry.getByText('851', { exact: true })).toBeVisible();
    await expect(raceEntry.getByText('950', { exact: true })).toHaveCSS('font-size', '18px');
    await expect(raceEntry.locator('.race-entry-monitor-id').first()).toHaveCSS('display', 'grid');

    await page.getByRole('button', { name: /Enter monitor ID 950 in live race/i }).click();
    await expect(page.locator('.rider-strip .rider-stat').filter({ hasText: 'Bike 950' })).toBeVisible();

    await page.getByLabel('Name for player 1').fill('Gate Trainer');
    await page.getByLabel('Name for player 2').fill('Rhythm Trainer');

    await expect.poll(() => cloudBikeProfiles.find((profile) => profile.deviceId === 43853)?.name)
      .toBe('Gate Trainer');
    await expect.poll(() => cloudBikeProfiles.find((profile) => profile.deviceId === 58701)?.name)
      .toBe('Rhythm Trainer');

    await page.reload();
    await expect(page.getByText(/2 connected bikes/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Name for player 1')).toHaveValue('Gate Trainer');
    await expect(page.getByLabel('Name for player 2')).toHaveValue('Rhythm Trainer');
    await expect(page.locator('.workflow-race-entry').getByText('Gate Trainer', { exact: true })).toBeVisible();
    await expect(page.locator('.workflow-race-entry').getByText('Rhythm Trainer', { exact: true })).toBeVisible();
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});

test('demo rider names and the last track view restore from the signed-in account after reload', async ({ page }) => {
  const authUser = {
    id: 'race-view-racer',
    profileKey: 'user:race-view-racer',
    email: 'preskiranch@gmail.com',
    name: 'Race View Rider',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  let cloudRaceViewPreferences = {
    cameraLocked: false,
    cameraLockedUpdatedAt: 100,
    earthCamerasByTrack: {
      'black-mountain-bmx': {
        angle: 47,
        heading: 180,
        center: { lat: 33.71225, lng: -112.0663 },
        zoom: 20,
        updatedAt: 100,
      },
    },
    riderOverlaysByTrack: {},
    riderOverlayUpdatedAtByTrack: {},
    demoRiderNames: {
      1: 'Maya Torres',
      2: 'Jordan Lee',
      3: 'Taylor Reed',
      4: 'Avery Cole',
    },
    demoRiderNamesUpdatedAt: 100,
    demoRiderPhotos: {} as Partial<Record<number, string>>,
    demoRiderPhotosUpdatedAt: 100,
    commentary: {
      enabled: true,
      ambientEnabled: true,
      ambientVolume: 0.065,
      ambientVolumeLocked: true,
      voicePreset: 'american-man',
      volume: 0.9,
      adaptiveMemory: true,
      recentLines: [],
    },
    commentaryUpdatedAt: 100,
  };
  let globalRaceViewPreferences: typeof cloudRaceViewPreferences | null = null;

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: authUser }),
    });
  });
  await page.route('**/api/public-track-mappings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { 'black-mountain-bmx': mockPedalZoneMapping },
        count: 1,
      }),
    });
  });
  await page.route('**/api/user-data*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as {
        raceViewPreferences?: typeof cloudRaceViewPreferences;
      };
      if (patch.raceViewPreferences) {
        cloudRaceViewPreferences = patch.raceViewPreferences;
      }
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: { 'black-mountain-bmx': mockPedalZoneMapping },
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: [],
        raceViewPreferences: cloudRaceViewPreferences,
      }),
    });
  });
  await page.route('**/api/global-race-view', async (route) => {
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON() as {
        raceViewPreferences?: typeof cloudRaceViewPreferences;
      };
      if (payload.raceViewPreferences) {
        globalRaceViewPreferences = {
          ...payload.raceViewPreferences,
          cameraLocked: true,
        };
      }
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ raceViewPreferences: globalRaceViewPreferences }),
    });
  });
  await page.route('**/api/ghosts*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ghosts: [] }),
    });
  });
  await page.route('**/api/multiplayer/leaderboards*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ rpm: [], speed: [] }),
    });
  });
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await expect(page.getByLabel('Name for player 1')).toHaveValue('Maya Torres');
  await expect(page.getByLabel('Name for player 2')).toHaveValue('Jordan Lee');
  await expect(page.getByText('Angle 47 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 180 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Coach', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tilt map up', exact: true })).toHaveCount(0);

  await page.getByLabel('Name for player 1').fill('Gate Master');
  await page.getByLabel('Name for player 2').fill('Rhythm Queen');
  await page.getByLabel('Upload photo for Gate Master').setInputFiles({
    name: 'gate-master.png',
    mimeType: 'image/png',
    buffer: tinyPngBuffer(),
  });
  await page.getByRole('button', { name: 'Edit map' }).click();
  await page.getByRole('button', { name: 'Tilt map up', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate map right', exact: true }).click();
  await page.locator('.mapping-section').getByRole('button', { name: 'View', exact: true }).click();

  await expect.poll(() => cloudRaceViewPreferences.demoRiderNames[1]).toBe('Gate Master');
  await expect.poll(() => cloudRaceViewPreferences.demoRiderNames[2]).toBe('Rhythm Queen');
  await expect.poll(() => cloudRaceViewPreferences.demoRiderPhotos[1]).toMatch(/^data:image\/jpeg;base64,/);
  await expect.poll(() => cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].angle).toBe(52);
  await expect.poll(() => cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].heading).toBe(195);
  expect(cloudRaceViewPreferences.demoRiderNamesUpdatedAt).toBeGreaterThan(100);
  expect(cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].updatedAt).toBeGreaterThan(100);

  await page.locator('.workflow-step.primary-action').click();
  await expect(page.getByRole('button', { name: 'Lock View', exact: true })).toBeVisible();
  await expect(
    page.locator('.race-rider-overlay-card').filter({ hasText: 'Gate Master' }).locator('.rider-avatar img'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Lock View', exact: true }).click();
  await expect.poll(() => globalRaceViewPreferences?.cameraLocked).toBe(true);
  await expect.poll(
    () => globalRaceViewPreferences?.earthCamerasByTrack['black-mountain-bmx'].angle,
  ).toBe(52);
  await expect.poll(
    () => globalRaceViewPreferences?.earthCamerasByTrack['black-mountain-bmx'].heading,
  ).toBe(195);
  await page.getByRole('button', { name: /Cancel Race/i }).click();

  cloudRaceViewPreferences = {
    ...cloudRaceViewPreferences,
    cameraLocked: false,
    cameraLockedUpdatedAt: Date.now() + 2_000,
    earthCamerasByTrack: {
      ...cloudRaceViewPreferences.earthCamerasByTrack,
      'black-mountain-bmx': {
        ...cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'],
        angle: 10,
        heading: 20,
        updatedAt: Date.now() + 2_000,
      },
    },
  };
  await page.evaluate(() => {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('tracklab-bmx-race-view-preferences-v1'))
      .forEach((key) => window.localStorage.removeItem(key));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /Demo/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await expect(page.getByLabel('Name for player 1')).toHaveValue('Gate Master');
  await expect(page.getByLabel('Name for player 2')).toHaveValue('Rhythm Queen');
  await expect(
    page.getByRole('complementary', { name: 'Bike pairing' })
      .getByLabel('Gate Master profile picture')
      .locator('img'),
  ).toBeVisible();
  await expect(page.getByText('Angle 52 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 195 deg', { exact: true })).toBeVisible();
});

test('club athletes see only their own connection and never the studio roster', async ({ page }) => {
  const now = Date.now();
  const authUser = {
    id: 'club-athlete-racer',
    profileKey: 'user:club-athlete-racer',
    email: 'club-athlete@tracklab.test',
    name: 'Rasheen Hicks (The Machine)',
    admin: false,
    membership: {
      tier: 'spectator',
      bikeSeats: 1,
      updatedAt: now,
    },
  };
  const contaminatedRoster = [
    { id: 'studio-bobby', name: 'Bobby', createdAt: now, updatedAt: now },
    { id: 'studio-cali', name: 'Cali', createdAt: now, updatedAt: now },
  ];

  await page.addInitScript(({ roster }) => {
    // Reproduce the previous shared-browser leak as well as an already
    // contaminated cloud profile. Neither source may reach an athlete UI.
    window.localStorage.setItem('tracklab-bmx-studio-riders-v1', JSON.stringify(roster));
  }, { roster: contaminatedRoster });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: contaminatedRoster,
        accountProfile: { updatedAt: now },
      }),
    });
  });
  await page.route('**/api/club-connect*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        canManageClub: false,
        ownedClub: null,
        memberships: [{
          clubId: 'club-preski-ranch',
          clubName: 'Preski Ranch LLC',
          studioRiderId: 'studio-rasheen',
          riderName: 'Rasheen “The Machine” Hicks',
          claimedAt: now,
        }],
      }),
    });
  });
  await page.route('**/api/training-sessions*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], totals: {} }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await openApp.click({ timeout: 2_000 }).catch(() => undefined);
  }
  await page.getByRole('button', { name: 'My Profile', exact: true }).click();

  const clubConnect = page.getByLabel('Club Connect');
  await expect(clubConnect.getByText('Connected to Preski Ranch LLC')).toBeVisible();
  await expect(clubConnect.getByText('Studio rider: Rasheen “The Machine” Hicks', { exact: false })).toBeVisible();
  await expect(clubConnect.locator('.club-owner-roster')).toHaveCount(0);
  await expect(clubConnect.getByRole('button', { name: /Invite|New link|Remove access/ })).toHaveCount(0);
  await expect(clubConnect.getByText('Bobby', { exact: true })).toHaveCount(0);
  await expect(clubConnect.getByText('Cali', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Club Live Monitor', exact: true })).toHaveCount(0);
  await expect(page.getByText('Owner-only view', { exact: true })).toHaveCount(0);
});

test('club owners can open the read-only Club Live Monitor while athletes cannot control sessions', async ({ page }) => {
  const now = Date.now();
  const studioRider = {
    id: 'studio-rasheen',
    name: 'Rasheen “The Machine” Hicks',
    createdAt: now,
    updatedAt: now,
  };
  const authUser = {
    id: 'club-owner',
    profileKey: 'user:club-owner',
    email: 'owner@tracklab.test',
    name: 'Club Owner',
    admin: false,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: now,
    },
  };

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: [studioRider],
        accountProfile: { updatedAt: now },
      }),
    });
  });
  await page.route('**/api/club-connect*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        canManageClub: true,
        ownedClub: {
          id: 'club-preski-ranch',
          name: 'Preski Ranch LLC',
          members: [{
            studioRiderId: studioRider.id,
            riderName: studioRider.name,
            status: 'claimed',
          }],
        },
        memberships: [],
      }),
    });
  });
  await page.route('**/api/training-sessions*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], totals: {} }),
    });
  });
  await page.route('**/api/club-live/sessions', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        club: { id: 'club-preski-ranch', name: 'Preski Ranch LLC' },
        sessions: [{
          id: 'club-preski-ranch:studio-rasheen',
          clubId: 'club-preski-ranch',
          studioRiderId: studioRider.id,
          riderName: studioRider.name,
          athleteName: 'Rasheen Hicks',
          activityType: 'explore',
          status: 'active',
          progress: { fraction: 0.42, label: '42% complete' },
          metrics: {
            watts: 312,
            cadence: 91,
            speedKph: 31.2,
            distanceMeters: 2_414,
            elapsedMs: 321_000,
            position: 2,
            participantCount: 4,
          },
          destinationLabel: 'Golden Gate Bridge',
          multiplayer: true,
          startedAt: now - 321_000,
          updatedAt: now,
          expiresAt: now + 60_000,
        }],
      }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await openApp.click({ timeout: 2_000 }).catch(() => undefined);
  }

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Club Live Monitor', exact: true }).click();

  await expect(page.locator('.platform-shell')).toHaveClass(/utility-fullscreen/);

  const monitor = page.getByLabel('Club Live Monitor');
  await expect(monitor.getByText('Owner-only view', { exact: true })).toBeVisible();
  await expect(monitor.getByRole('heading', { name: 'Rasheen Hicks' })).toBeVisible();
  await expect(monitor.getByText('Explore the World', { exact: true })).toBeVisible();
  await expect(monitor.getByText('Golden Gate Bridge', { exact: true })).toBeVisible();
  await expect(monitor.getByText('Private room', { exact: true })).toBeVisible();
  await expect(monitor.getByText('312', { exact: true })).toBeVisible();
  await expect(monitor.getByText('watts', { exact: true })).toBeVisible();
  await expect(monitor.getByText('Read-only live feed', { exact: true })).toBeVisible();
  await expect(monitor.getByRole('button', { name: /Pause|Resume|Stop|Cancel|Control/i })).toHaveCount(0);
});

test('club owner enrolls a shared tablet that stays in athlete-only kiosk mode between sessions', async ({ page }) => {
  const now = Date.now();
  const authUser = {
    id: 'club-tablet-owner',
    profileKey: 'user:club-tablet-owner',
    email: 'tablet-owner@tracklab.test',
    name: 'Club Tablet Owner',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: now,
    },
  };
  const tabletDevice = {
    id: 'tablet-front-desk',
    name: 'Preski Front Desk',
    clubId: 'club-preski-ranch',
    clubName: 'Preski Ranch LLC',
    createdAt: now,
    lastSeenAt: now,
  };
  const athletes = [
    {
      studioRiderId: 'studio-bobby',
      riderName: 'Bobby',
      athleteName: null,
      status: 'unclaimed',
    },
    {
      studioRiderId: 'studio-rasheen',
      riderName: 'Rasheen “The Machine” Hicks',
      athleteName: 'Rasheen Hicks',
      status: 'claimed',
    },
  ];
  const session = {
    clubId: tabletDevice.clubId,
    clubName: tabletDevice.clubName,
    studioRiderId: 'studio-rasheen',
    riderName: 'Rasheen “The Machine” Hicks',
    athleteName: 'Rasheen Hicks',
    bikeDeviceId: 58701,
    expiresAt: now + 10 * 60_000,
  };
  let enrollmentRequest: unknown = null;
  let rosterAuthorization = '';
  let failNextRosterAuthorization = false;
  let sessionRequest: unknown = null;
  let sessionDeletes = 0;

  await page.addInitScript(() => {
    const packet = new ArrayBuffer(6);
    const packetView = new DataView(packet);
    packetView.setUint16(0, 0x40, true);
    packetView.setUint16(2, 2_500, true);
    packetView.setInt16(4, 220, true);
    let notificationTimer = 0;
    const characteristic = Object.assign(new EventTarget(), {
      value: packetView,
      startNotifications: async () => {
        if (!notificationTimer) {
          notificationTimer = window.setInterval(() => {
            characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
          }, 200);
        }
        return characteristic;
      },
      stopNotifications: async () => {
        window.clearInterval(notificationTimer);
        notificationTimer = 0;
        return characteristic;
      },
    });
    const server = {
      connected: true,
      disconnect: () => undefined,
      getPrimaryService: async (uuid: string) => {
        if (!uuid.startsWith('00001826')) {
          throw new Error('Service unavailable in test device.');
        }
        return { getCharacteristic: async () => characteristic };
      },
    };
    const device = Object.assign(new EventTarget(), {
      id: 'browser-club-tablet-bike',
      name: 'WattbikePM25058701',
      gatt: {
        connected: true,
        connect: async () => server,
      },
    });
    window.localStorage.setItem(
      'tracklab.bluetooth-bike-identities.v1',
      JSON.stringify({ 'browser-club-tablet-bike': 58701 }),
    );
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: async () => [device],
        requestDevice: async () => device,
      },
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: authUser }) });
  });
  await page.route('**/api/user-data*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        trackMappings: {},
        customRoutes: [],
        bikeProfiles: [],
        studioRiders: athletes.map((athlete) => ({
          id: athlete.studioRiderId,
          name: athlete.riderName,
          createdAt: now,
          updatedAt: now,
        })),
        accountProfile: { updatedAt: now },
      }),
    });
  });
  await page.route('**/api/club-connect*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        canManageClub: true,
        ownedClub: {
          id: tabletDevice.clubId,
          name: tabletDevice.clubName,
          members: athletes.map((athlete) => ({
            studioRiderId: athlete.studioRiderId,
            riderName: athlete.riderName,
            status: athlete.status,
          })),
        },
        memberships: [],
      }),
    });
  });
  await page.route('**/api/club-tablet/devices', async (route) => {
    if (route.request().method() === 'POST') {
      enrollmentRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ device: tabletDevice, deviceToken: 'tablet-device-token' }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ devices: [] }),
    });
  });
  await page.route('**/api/club-tablet/roster', async (route) => {
    rosterAuthorization = route.request().headers().authorization ?? '';
    await new Promise((resolve) => setTimeout(resolve, 175));
    if (failNextRosterAuthorization) {
      failNextRosterAuthorization = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary authorization check failure' }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ device: tabletDevice, athletes }),
    });
  });
  await page.route('**/api/club-tablet/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      sessionRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'tablet-athlete-session-token',
          session,
          heartbeatTtlMs: 120_000,
          pollAfterMs: 30_000,
        }),
      });
      return;
    }
    sessionDeletes += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ stopped: true }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  const openApp = page.getByRole('button', { name: 'Open App' });
  if (await openApp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await openApp.click({ timeout: 2_000 }).catch(() => undefined);
  }
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Club Tablets', exact: true }).click();

  await page.getByLabel('Tablet name').fill(tabletDevice.name);
  await page.getByRole('button', { name: 'Authorize this tablet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifying tablet authorization…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who is training on this tablet?' })).toBeVisible();
  expect(enrollmentRequest).toEqual({ name: tabletDevice.name });
  expect(rosterAuthorization).toBe('Bearer tablet-device-token');

  const primaryNav = page.getByRole('navigation', { name: 'Primary' });
  await expect(primaryNav.getByRole('button')).toHaveCount(1);
  await expect(primaryNav.getByRole('button', { name: 'Club Tablet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Profile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Club Live Monitor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tracks & Maps', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Authorized club tablets')).toHaveCount(0);

  await expect(page.getByRole('button', { name: /Bobby/ })).toBeVisible();
  const rasheen = page.getByRole('button', { name: /Rasheen Hicks/ });
  await expect(rasheen).toBeVisible();
  const startAthlete = page.getByRole('button', { name: 'Start athlete session', exact: true });
  await expect(startAthlete).toBeDisabled();
  const bikeChoices = page.locator('.club-tablet-bikes');
  await expect(bikeChoices.getByRole('button')).toHaveCount(1);
  await expect(bikeChoices.getByText('WattbikePM25058701', { exact: false })).toBeVisible();

  await rasheen.click();
  await expect(startAthlete).toBeEnabled();
  await startAthlete.click();
  expect(sessionRequest).toEqual({ studioRiderId: 'studio-rasheen', bikeDeviceId: '58701' });

  const programs = page.locator('.club-tablet-programs');
  await expect(programs.getByRole('button')).toHaveCount(3);
  await expect(programs.getByRole('button', { name: /BMX Race Intervals/ })).toBeVisible();
  await expect(programs.getByRole('button', { name: /Straight Sprint/ })).toBeVisible();
  await expect(programs.getByRole('button', { name: /Explore the World/ })).toBeVisible();

  await page.locator('.club-tablet-active-card')
    .getByRole('button', { name: 'End athlete session', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Who is training on this tablet?' })).toBeVisible();
  await expect(page.getByText('Athlete signed out. The Wattbike remains paired to this tablet for the next student.')).toBeVisible();
  expect(sessionDeletes).toBe(1);
  expect(await page.evaluate(() => ({
    device: JSON.parse(window.localStorage.getItem('tracklab.club-tablet-device.v1') ?? 'null'),
    session: window.sessionStorage.getItem('tracklab.club-tablet-athlete-session.v1'),
    pairedBikeMonitorId: JSON.parse(
      window.localStorage.getItem('tracklab.bluetooth-bike-identities.v1') ?? '{}',
    )['browser-club-tablet-bike'] ?? null,
  }))).toEqual({
    device: { device: tabletDevice, deviceToken: 'tablet-device-token' },
    session: null,
    pairedBikeMonitorId: 58701,
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who is training on this tablet?' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Rasheen Hicks/ })).toBeVisible();

  failNextRosterAuthorization = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Could not verify this club tablet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair a Wattbike' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry authorization', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifying tablet authorization…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who is training on this tablet?' })).toBeVisible();
});

test('studio rider roster syncs to the account and can be assigned to a connected bike', async ({ page }) => {
  const bridge = await createMockBikeBridge([58701]);
  const sampleTimer = setInterval(() => {
    bridge.broadcast(mockBikeSample({
      deviceId: 58701,
      watts: 210,
      cadence: 72,
      speedKph: 0,
    }));
  }, 120);
  const authUser = {
    id: 'studio-roster-racer',
    profileKey: 'user:studio-roster-racer',
    email: 'studio-roster@tracklab.test',
    name: 'Studio Coach',
    admin: true,
    membership: {
      tier: 'racer',
      bikeSeats: 4,
      updatedAt: Date.now(),
    },
  };
  let cloudStudioRiders: Array<{
    id: string;
    name: string;
    photoUrl?: string;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
  }> = [];

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    });
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: authUser }),
      });
    });
    await page.route('**/api/user-data*', async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as { studioRiders?: typeof cloudStudioRiders };
        if (Array.isArray(patch.studioRiders)) {
          cloudStudioRiders = patch.studioRiders;
        }
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          trackMappings: {},
          customRoutes: [],
          bikeProfiles: [],
          studioRiders: cloudStudioRiders,
        }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();
    await expect(page.getByText(/1 connected bike/i)).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder('Add student').fill('Jordan H');
    await page.getByRole('button', { name: 'Add studio rider' }).click();
    await expect.poll(() => cloudStudioRiders.find((rider) => !rider.deletedAt)?.name).toBe('Jordan H');
    await page.getByLabel('Upload photo for Jordan H').setInputFiles({
      name: 'jordan.png',
      mimeType: 'image/png',
      buffer: tinyPngBuffer(),
    });
    await expect.poll(() => cloudStudioRiders.find((rider) => !rider.deletedAt)?.photoUrl)
      .toMatch(/^data:image\/jpeg;base64,/);

    const studentSelect = page.getByLabel(/Student assigned to monitor ID 701/i);
    await studentSelect.selectOption({ label: 'Jordan H' });
    await expect(studentSelect).toHaveValue(cloudStudioRiders[0].id);
    await expect(page.getByText(/1 entered \/ 1 connected/i)).toBeVisible();
    await expect(page.locator('.race-entry-rider-photo .rider-avatar img')).toBeVisible();
    const raceEntryAvatarBounds = await page.locator('.race-entry-rider-photo .rider-avatar').boundingBox();
    expect(raceEntryAvatarBounds?.width).toBe(34);
    expect(raceEntryAvatarBounds?.height).toBe(34);

    await page.reload();
    await expect(page.getByText(/1 connected bike/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('option', { name: 'Jordan H' })).toBeAttached();
    const studioManager = page.locator('.studio-rider-manager');
    if (await studioManager.getAttribute('open') == null) {
      await studioManager.locator('summary').click();
    }
    await expect(page.getByLabel('Jordan H profile picture').locator('img')).toBeVisible();
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});
