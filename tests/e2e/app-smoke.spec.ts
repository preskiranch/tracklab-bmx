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

  await expect(page.getByRole('button', { name: /Custom Location/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo/i }).first()).toBeVisible();
  await expect(page.getByText(/Track Mapping|Trace route/i).first()).toBeVisible();
  await page.getByText('Loading Google imagery').waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);

  await page.getByRole('button', { name: 'Track Locator', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a BMX racing track' })).toBeVisible();
  await expect(page.getByText('1,305 tracks', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open App', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Race Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Commentary brain', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Fast|Balanced|Studio/i })).toHaveCount(0);
  await expect(page.getByLabel('Announcer voice')).toHaveCount(0);
  await expect(page.getByText('American male', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Adaptive memory', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview selected voice' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Race type' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Intervals' })).toHaveCount(0);
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

test('start here race action enters fullscreen race view', async ({ page }, testInfo) => {
  test.setTimeout(55_000);
  let commentarySpeechRequests = 0;
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
    if (payload.eventKind === 'pre-race') {
      await new Promise((resolve) => setTimeout(resolve, 6_500));
    }
    await route.fulfill({
      contentType: 'audio/mpeg',
      path: 'public/assets/uci-random-start.mp3',
    });
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
    };
    const originalMediaLoad = HTMLMediaElement.prototype.load;
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
  const customDemoNames = ['Miles Power', 'Cadence Watts', 'Maya Torres', 'Jordan Lee'];
  for (let index = 0; index < customDemoNames.length; index += 1) {
    const nameInput = page.getByLabel(`Name for player ${index + 1}`);
    await expect(nameInput).toHaveValue(`Demo Rider ${index + 1}`);
    await nameInput.fill(customDemoNames[index]);
    await nameInput.press('Enter');
    await expect(nameInput).toHaveValue(customDemoNames[index]);
  }

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
  await expect(page.locator('.race-staging-countdown strong')).toHaveText(/1[3-5]/);
  await expect(page.locator('.start-tree-light')).toHaveCount(0);
  const riderPanel = page.locator('.race-rider-overlay');
  await expect(riderPanel).toBeVisible();
  for (const customName of customDemoNames) {
    await expect(riderPanel.getByText(customName, { exact: true })).toBeVisible();
  }
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
      __tracklabVoiceStartCount?: number;
    }).__tracklabVoiceStartCount ?? 0
  )), { timeout: 12_000 }).toBeGreaterThan(0);
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
    (window as typeof window & { __tracklabVoiceStartCount?: number }).__tracklabVoiceStartCount ?? 0
  )), { timeout: 5_000 }).toBeGreaterThan(0);
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
      };
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
    await expect.poll(
      () => speechPayloads.filter((payload) => payload.eventKind === 'race-start').length,
      { timeout: 8_000 },
    ).toBeGreaterThanOrEqual(1);
    const initialStartPrefetchCount = speechPayloads.filter(
      (payload) => payload.eventKind === 'race-start',
    ).length;
    await page.waitForTimeout(1_500);
    expect(speechPayloads.filter((payload) => (
      payload.eventKind === 'race-start'
    ))).toHaveLength(initialStartPrefetchCount);
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
    await expect(page.getByLabel('Race commentary')).toBeAttached();
  });

  test('does not substitute a robotic device voice when natural speech is unavailable', async ({ page }) => {
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
        body: JSON.stringify({ aiAvailable: true }),
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

    await expect.poll(() => hostedSpeechAttempts, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & {
        __tracklabBrowserFallbackCalls?: Array<{ line: string; voice: string }>;
      }).__tracklabBrowserFallbackCalls ?? []
    )), { timeout: 2_000 }).toHaveLength(0);
  });
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
  await expect(page.getByText('Top 3')).toBeVisible();
  await expect(page.getByText('Demo Ghosts')).toHaveCount(0);
  await expect(page.getByText('Demo Rider 1')).toHaveCount(0);
  await expect(page.getByText('Studio Bike One')).toBeVisible();
  await expect(page.getByText('World Leader')).toBeVisible();
  await expect(page.locator('.ghost-rank-badge')).toHaveText(['#1', '#2']);
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
  await expect(page.getByText('Complete a live Wattbike race on this track to create the first ranked ghost.')).toBeVisible();
});

test('completed race waits for the authoritative final result before returning to dashboard analysis', async ({ page }, testInfo) => {
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
      body: silentWavBuffer(500),
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
  await expect(finishCountdown.locator('strong')).toHaveText(/10|[1-9]/);
  await expect(finishCountdown).toContainText('remaining riders still racing');
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await expect(page.getByRole('button', { name: /Cancel Race/i })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);

  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & {
      __tracklabLiveDebug?: { raceState?: string };
    }).__tracklabLiveDebug?.raceState
  )), { timeout: 12_000 }).toBe('finished');
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await page.waitForTimeout(750);
  await expect(page.locator('.platform-shell')).toHaveClass(/race-fullscreen/);
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath('finished-race-zone-label-placement.png'),
  });

  holdFinishSpeech = false;
  releaseHeldFinishSpeech();
  await expect.poll(
    () => finishSpeechPayloads.at(-1)?.line ?? '',
    { timeout: 12_000 },
  ).toMatch(/wins.*second.*third.*fourth/i);
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
    await expect(page.getByLabel('Race layout locked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lock View', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unlock rider panel', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resize rider overlay', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rotate map left', exact: true })).toBeDisabled();
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
    await page.getByRole('button', { name: 'Pause Countdown', exact: true }).click();
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('PAUSED');
    const pausedDetail = await page.locator('.race-staging-countdown span').innerText();
    await page.waitForTimeout(1_200);
    await expect(page.locator('.race-staging-countdown strong')).toHaveText('PAUSED');
    await expect(page.locator('.race-staging-countdown span')).toHaveText(pausedDetail);

    await page.getByRole('button', { name: 'Lock View', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View Locked', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Rotate map left', exact: true })).toBeDisabled();
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
      body: JSON.stringify({ rpm: [], speed: [], watts: [] }),
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

  await page.getByLabel('Name for player 1').fill('Gate Master');
  await page.getByLabel('Name for player 2').fill('Rhythm Queen');
  await page.getByRole('button', { name: 'Tilt map up', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate map right', exact: true }).click();

  await expect.poll(() => cloudRaceViewPreferences.demoRiderNames[1]).toBe('Gate Master');
  await expect.poll(() => cloudRaceViewPreferences.demoRiderNames[2]).toBe('Rhythm Queen');
  await expect.poll(() => cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].angle).toBe(52);
  await expect.poll(() => cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].heading).toBe(195);
  expect(cloudRaceViewPreferences.demoRiderNamesUpdatedAt).toBeGreaterThan(100);
  expect(cloudRaceViewPreferences.earthCamerasByTrack['black-mountain-bmx'].updatedAt).toBeGreaterThan(100);

  await page.locator('.workflow-step.primary-action').click();
  await expect(page.getByRole('button', { name: 'Lock View', exact: true })).toBeVisible();
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
  await expect(page.getByText('Angle 52 deg', { exact: true })).toBeVisible();
  await expect(page.getByText('Heading 195 deg', { exact: true })).toBeVisible();
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
