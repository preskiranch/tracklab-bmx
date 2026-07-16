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

  await page.goto('/');

  await expect(page).toHaveTitle(/TrackLab|BMX|Wattbike/i);
  await expect(page.getByRole('heading', { name: 'TrackLab BMX' }).first()).toBeVisible();
  await expect(page.getByLabel('Required profile')).toBeVisible();

  await page.getByLabel('Name').fill('Playwright Rider');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('playwright-pass-2026');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();

  await expect(page.getByRole('button', { name: /Custom Location/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo/i }).first()).toBeVisible();
  await expect(page.getByText(/Track Mapping|Trace route/i).first()).toBeVisible();
  await page.getByText('Loading Google imagery').waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);

  await page.getByRole('button', { name: 'Track Locator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a BMX racing track' })).toBeVisible();
  await expect(page.getByText('1,305 tracks', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open App', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Race Dashboard', exact: true })).toBeVisible();

  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('tracklab-dashboard-smoke.png'),
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('Bluetooth pairing stays pending until TrackLab verifies a bike connection', async ({ page }) => {
  const authUser = {
    id: 'bluetooth-pairing-racer',
    profileKey: 'user:bluetooth-pairing-racer',
    email: 'bluetooth-pairing@tracklab.test',
    name: 'Bluetooth Pairing Rider',
    admin: false,
    membership: { tier: 'racer', bikeSeats: 4, updatedAt: Date.now() },
  };

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: async () => [],
        requestDevice: () => new Promise(() => undefined),
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

  const pairButton = page.getByRole('button', { name: 'Pair Wattbike', exact: true });
  await expect(pairButton).toBeVisible();
  await pairButton.click();
  await expect(page.getByRole('button', { name: 'Pairing...', exact: true })).toBeDisabled();
  await expect(page.getByText('Pairing with the selected Wattbike and verifying its live data service.').first()).toBeVisible();
  await expect(page.getByText(/connected \/ 0 detected/)).toBeVisible();
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
  await expect(page.locator('.earth-panel')).toBeVisible();
  await expect(page.locator('.analytics-panel')).toBeVisible();

  const mapBounds = await page.locator('.earth-panel').boundingBox();
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
  await page.getByRole('button', { name: 'Edit map' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Saved and published across browsers.')).toBeVisible();
  expect(savedMapping?.trackId).toBe('black-mountain-bmx');
  expect(savedMapping?.zones[0]).toMatchObject({ startMeter: 0, endMeter: 30 });
  expect(savedMapping?.zones).toHaveLength(2);
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
  await expect(page.getByRole('button', { name: /Custom Location/i })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced Connector' }).click();

  await expect(page.getByRole('button', { name: 'Open Mac Connector' })).toBeVisible();
  await expect(page.getByText(/runs locally in the background/i)).toBeVisible();
});

test('start here race action enters fullscreen race view', async ({ page }) => {
  test.setTimeout(45_000);
  const authUser = {
    id: 'quick-start-racer',
    profileKey: 'user:quick-start-racer',
    email: 'quick-start@tracklab.test',
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
  await page.addInitScript(() => {
    const prototype = window.AudioBufferSourceNode?.prototype;
    if (!prototype) {
      return;
    }

    const originalStart = prototype.start;
    prototype.start = function (...args: Parameters<AudioBufferSourceNode['start']>) {
      const audioWindow = window as typeof window & { __tracklabVoiceStartCount?: number };
      audioWindow.__tracklabVoiceStartCount = (audioWindow.__tracklabVoiceStartCount ?? 0) + 1;
      return Reflect.apply(originalStart, this, args);
    };
  });

  await page.goto('/?track=air-time-bmx');

  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();

  const startAction = page.locator('.workflow-step.primary-action');
  await expect(startAction).toContainText('Start Demo Race');
  await startAction.click();

  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(page.locator('.race-staging-countdown')).toBeVisible();
  await expect(page.locator('.race-staging-countdown strong')).toHaveText(/1[3-5]/);
  await expect(page.locator('.start-tree-light')).toHaveCount(0);
  await page.waitForTimeout(15_500);
  await expect(page.locator('.race-staging-countdown')).toHaveCount(0);
  await expect(page.locator('.start-tree-light')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __tracklabVoiceStartCount?: number }).__tracklabVoiceStartCount ?? 0
  )), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
});

test('loop races expose lap controls and privacy-safe ghost selection without a cadence card', async ({ page }, testInfo) => {
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
  await expect(page.getByText('My Ghosts')).toBeVisible();
  await expect(page.getByText('Demo Ghosts')).toHaveCount(0);
  await expect(page.getByText('Demo Rider 1')).toHaveCount(0);
  await expect(page.getByText('Studio Bike One')).toBeVisible();
  await expect(page.getByText('Worldwide')).toBeVisible();
  await expect(page.getByText('Gold')).toBeVisible();
  await expect(page.getByText('Replay public / performance private')).toBeVisible();
  await expect(page.getByText('Gate start', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Countdown', exact: true })).toHaveCount(0);
  const personalGhost = page.locator('.ghost-option').filter({ hasText: 'Studio Bike One' });
  await personalGhost.getByText('Select this ghost').click();
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
  await expect(page.getByText('Complete a live Wattbike race on this track to create your personal ghost.')).toBeVisible();
});

test('completed race holds five seconds after the first finisher then returns to dashboard analysis', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
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

  await page.setViewportSize({ width: 1366, height: 900 });
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
      body: JSON.stringify({ rpm: [], speed: [], watts: [] }),
    });
  });

  await page.goto('/?track=black-mountain-bmx');
  await page.getByRole('button', { name: 'Open App' }).click();
  await page.getByRole('button', { name: /Demo/i }).first().click();
  await expect(page.getByText(/1 pedal zone/i).first()).toBeVisible({ timeout: 15_000 });

  const startAction = page.locator('.workflow-step.primary-action');
  await expect(startAction).toContainText('Start Demo Race');
  await startAction.click();
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/, { timeout: 8_000 });

  const finishCountdown = page.locator('.race-finish-countdown');
  await expect(finishCountdown).toBeVisible({ timeout: 60_000 });
  await expect(finishCountdown.locator('strong')).toHaveText(/[1-5]/);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);

  await expect(page.locator('.platform-shell')).not.toHaveClass(/race-fullscreen/, { timeout: 7_000 });
  await expect(page.getByRole('region', { name: 'Post-race review' })).toHaveCount(0);
  await expect(page.locator('.race-review-screen')).toHaveCount(0);

  const dashboardAnalysis = page.locator('.analytics-panel');
  const zoneTableCard = dashboardAnalysis.locator('.zone-table-card');
  await expect(zoneTableCard).toBeVisible();
  await expect(zoneTableCard.locator('thead th')).toHaveCount(6);
  await expect(zoneTableCard.getByText('Reaction', { exact: false })).toHaveCount(0);

  const riderCells = zoneTableCard.locator('tbody tr').first().locator('.zone-rider-metrics');
  await expect(riderCells).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    const riderCell = riderCells.nth(index);
    for (const metric of ['Max cadence', 'Max speed', 'Max power']) {
      const value = riderCell.locator('.table-metric').filter({ hasText: metric }).locator('strong');
      await expect(value).not.toHaveText('--');
    }
  }

  const zoneTableFits = await zoneTableCard.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(zoneTableFits).toBe(true);
  const zoneCardBounds = await zoneTableCard.boundingBox();
  const leaderboardBounds = await dashboardAnalysis.locator('.leaderboard-card').boundingBox();
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
        body: JSON.stringify({ rpm: [], speed: [], watts: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();

    await expect(page.getByRole('button', { name: /Custom Location/i })).toBeVisible();
    await expect(page.getByText(/1 connected bike/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/2 pedal zones/i).first()).toBeVisible({ timeout: 15_000 });
    const ghostOption = page.locator('.ghost-option').filter({ hasText: 'Cyan Ghost' });
    await ghostOption.getByText('Select this ghost').click();
    await expect(ghostOption.getByText('Selected to race')).toBeVisible();
    await expect(page.locator('.workflow-step').filter({ hasText: 'Ghost' })).toHaveClass(/ghost-selected/);

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown')).toBeVisible();
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/1[3-5]/);
    await expect(page.locator('.start-tree-light')).toHaveCount(0);
    await expect(page.locator('.rider-stat.ghost')).toContainText('0% / ghost');
    await page.waitForTimeout(8_500);

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/[5-7]/);
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
    }), { timeout: 18_000 }).toBe('racing');
    moving = true;
    await expect.poll(async () => page.evaluate(() => {
      const debug = (window as typeof window & {
        __tracklabLiveDebug?: {
          players?: Array<{ riderDistanceMeters?: number | null }>;
        };
      }).__tracklabLiveDebug;
      return debug?.players?.[0]?.riderDistanceMeters ?? 0;
    }), { timeout: 3_000 }).toBeGreaterThan(0.25);
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
        body: JSON.stringify({ rpm: [], speed: [], watts: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();
    await expect(page.getByText(/1 connected bike/i).first()).toBeVisible({ timeout: 15_000 });

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();
    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.start-tree-light')).toBeVisible({ timeout: 20_000 });

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
    email: 'two-bike-live@tracklab.test',
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
        body: JSON.stringify({ ghosts: [] }),
      });
    });
    await page.route('**/api/multiplayer/leaderboards*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ rpm: [], speed: [], watts: [] }),
      });
    });

    await page.goto('/?track=black-mountain-bmx');
    await page.getByRole('button', { name: 'Open App' }).click();

    await expect(page.getByRole('button', { name: /Custom Location/i })).toBeVisible();
    await expect(page.getByText(/2 connected bikes/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/0 entered \/ 2 connected/i)).toBeVisible();

    await expect(page.locator('.workflow-step').filter({ hasText: 'Race' })).toContainText('Choose racer');
    await page.getByRole('button', { name: /Enter Bike 58701 in live race/i }).click();
    await expect(page.getByText(/1 entered \/ 2 connected/i)).toBeVisible();

    const startAction = page.locator('.workflow-step.primary-action');
    await expect(startAction).toContainText('Start Live Race');
    await startAction.click();

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown')).toBeVisible();
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('15');
    await expect(page.locator('.start-tree-light')).toHaveCount(0);
    await page.waitForTimeout(8_500);

    await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText(/[5-7]/);
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
  const bridge = await createMockBikeBridge(deviceIds);
  const sampleTimer = setInterval(() => {
    deviceIds.forEach((deviceId, index) => {
      bridge.broadcast(mockBikeSample({
        deviceId,
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
    await expect(raceEntry.getByText('Bike 43853', { exact: true })).toBeVisible();
    await expect(raceEntry.getByText('Bike 58701Watt', { exact: true })).toBeVisible();

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

    const studentSelect = page.getByLabel(/Student riding Bike 58701/i);
    await studentSelect.selectOption({ label: 'Jordan H' });
    await expect(studentSelect).toHaveValue(cloudStudioRiders[0].id);
    await expect(page.getByText(/1 entered \/ 1 connected/i)).toBeVisible();

    await page.reload();
    await expect(page.getByText(/1 connected bike/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('option', { name: 'Jordan H' })).toBeAttached();
  } finally {
    clearInterval(sampleTimer);
    await bridge.close();
  }
});
