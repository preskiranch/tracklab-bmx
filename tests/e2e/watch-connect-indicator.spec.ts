import { expect, test, type Page } from '@playwright/test';
import { WebSocket, WebSocketServer } from 'ws';

async function createWatchBikeBridge(deviceId = 58701) {
  const url = new URL(process.env.PLAYWRIGHT_BRIDGE_URL ?? 'ws://127.0.0.1:19787');
  const clients = new Set<WebSocket>();
  const server = await new Promise<WebSocketServer>((resolve, reject) => {
    const candidate = new WebSocketServer({ host: url.hostname, port: Number(url.port) });
    candidate.once('listening', () => resolve(candidate));
    candidate.once('error', reject);
  });
  const sample = () => JSON.stringify({
    type: 'bike-sample',
    at: Date.now(),
    source: 'bluetooth',
    deviceId,
    label: `WattbikePM250${deviceId}`,
    watts: 0,
    cadence: 0,
    speedKph: 0,
    signal: 90,
  });
  server.on('connection', (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({
      type: 'bridge-status',
      mode: 'bluetooth',
      sourceState: 'running',
      message: 'Mock connector running.',
      connectedDevices: [{
        deviceId,
        label: `WattbikePM250${deviceId}`,
        connected: true,
        source: 'bluetooth',
        signal: 90,
        at: Date.now(),
      }],
    }));
    socket.send(sample());
    socket.on('close', () => clients.delete(socket));
  });
  const timer = setInterval(() => clients.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(sample());
  }), 150);
  return async () => {
    clearInterval(timer);
    clients.forEach((socket) => socket.terminate());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

function signedInUser(id: string, name: string) {
  return {
    id,
    profileKey: `user:${id}`,
    email: `${id}@tracklab.test`,
    name,
    admin: false,
    membership: { tier: 'racer', bikeSeats: 1, updatedAt: Date.now() },
  };
}

async function routeSignedInShell(page: Page, user: ReturnType<typeof signedInUser>) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user }),
  }));
  await page.route('**/api/user-data*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      trackMappings: {},
      customRoutes: [],
      bikeProfiles: [],
      studioRiders: [],
      accountProfile: { updatedAt: Date.now() },
    }),
  }));
  await page.route('**/api/heart-rate/account-blocks', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ blocks: [] }),
  }));
  await page.route('**/api/heart-rate/pairings', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ pairings: [] }),
  }));
  await page.route('https://maps.googleapis.com/**', (route) => route.abort());
}

async function openApp(page: Page) {
  const open = page.getByRole('button', { name: 'Open App' });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await open.or(navigation).first().waitFor({ state: 'visible' });
  if (await open.isVisible()) await open.click();
}

test('same-account iPad separates an active Watch session from heart-rate freshness', async ({ page }) => {
  test.setTimeout(45_000);
  const user = signedInUser('ipad-watch-indicator', 'iPad Watch Rider');
  let connectionId = 'connection-ipad-live';
  let readingConnectionId = connectionId;
  const enrollmentId = 'enrollment-ipad-live';
  const clockNow = Date.now();
  const connectedAt = clockNow - 60_000;
  const connectedUntil = connectedAt + 4 * 60 * 60 * 1_000;
  let connectionState: 'connected' | 'stopped' = 'connected';
  let sampleRecordedAt = clockNow - 500;

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.clock.install({ time: clockNow });
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
  });
  await routeSignedInShell(page, user);
  await page.route('**/api/heart-rate/watch-connect', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      enrollments: [{
        id: enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'trusted',
        liveStudioConsent: false,
        sessionStudioConsent: false,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      }],
      connections: [{
        id: connectionId,
        enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: connectionState,
        connectedAt,
        connectedUntil,
        remainingMs: Math.max(0, connectedUntil - Date.now()),
        liveStudioConsent: false,
        sessionStudioConsent: false,
      }],
    }),
  }));
  await page.route('**/api/heart-rate/live/latest', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      freshnessMs: 10_000,
      reading: {
        streamId: 'stream-ipad-live',
        sessionId: `watch-connect:${readingConnectionId}`,
        relayScope: 'account-block',
        riderId: `account:${user.id}`,
        playerId: null,
        bpm: 148,
        recordedAt: sampleRecordedAt,
        receivedAt: sampleRecordedAt + 100,
        freshUntil: sampleRecordedAt + 10_000,
        activeElapsedMs: 30_000,
      },
    }),
  }));

  await page.goto('/?track=air-time-bmx');
  await openApp(page);
  const indicator = page.locator('[data-watch-connect-status]').filter({ visible: true });
  await expect(indicator).toHaveAttribute('data-watch-connect-status', 'live');
  await expect(indicator).toContainText('Watch live');
  await expect(indicator).toContainText('148 BPM');
  await expect(indicator).toHaveAttribute('aria-label', /148 beats per minute/);
  await expect(indicator).toHaveAttribute('aria-label', /Live through the paired iPhone/);
  await expect.poll(async () => (await indicator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.getByRole('button', { name: 'My Profile', exact: true }).click();
  await expect(indicator).toContainText('148 BPM');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(indicator).toContainText('148 BPM');

  // Reconnecting from A to B must clear A immediately, even while A remains
  // fresh in the latest-reading response. Only B can repopulate program UI.
  connectionId = 'connection-ipad-next';
  for (let poll = 0; poll < 3; poll += 1) {
    sampleRecordedAt += 5_000;
    await page.clock.fastForward(5_000);
  }
  const nextConnection = page.locator('[data-watch-connect-status]').filter({ visible: true });
  await expect(nextConnection).toHaveAttribute('data-watch-connect-status', 'connected');
  await expect(nextConnection).not.toContainText('148 BPM');
  await expect(nextConnection).not.toHaveAttribute('aria-label', /beats per minute/);
  readingConnectionId = connectionId;
  sampleRecordedAt += 5_000;
  await page.clock.fastForward(5_000);
  await expect(nextConnection).toContainText('148 BPM');

  // The stale sample is no longer usable, but the exact unexpired cloud session
  // remains connected without a reload or a new connection response.
  await page.clock.fastForward(11_000);
  await expect(indicator).toHaveAttribute('data-watch-connect-status', 'connected');
  await expect(indicator).toContainText('Watch connected');
  await expect(indicator).toHaveAttribute('aria-label', /Waiting for a fresh heart rate reading/);

  sampleRecordedAt += 11_000;
  await page.reload();
  await openApp(page);
  const refreshed = page.locator('[data-watch-connect-status]').filter({ visible: true });
  await expect(refreshed).toHaveAttribute('data-watch-connect-status', 'live');
  await refreshed.click();
  const readOnlyCard = page.getByRole('region', { name: 'iPad Watch Rider Watch Connect' });
  await expect(readOnlyCard).toBeVisible();
  await expect(readOnlyCard.getByRole('button', { name: /Disconnect|Watch Connect/ })).toHaveCount(0);

  connectionState = 'stopped';
  readingConnectionId = 'connection-after-stop';
  sampleRecordedAt += 5_000;
  await page.clock.fastForward(5_000);
  const stopped = page.locator('[data-watch-connect-status]').filter({ visible: true });
  await expect(stopped).toHaveAttribute('data-watch-connect-status', 'disconnected');
  await expect(stopped).not.toContainText('148 BPM');
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test('iPhone native connecting event cannot cancel its newly created Watch connection', async ({ page }) => {
  test.setTimeout(45_000);
  const user = {
    ...signedInUser('iphone-watch-ordering', 'iPhone Watch Rider'),
    email: 'preskiranch@gmail.com',
    admin: true,
  };
  const enrollmentId = 'enrollment-iphone-new';
  const connectionId = 'connection-iphone-new';
  const connectedAt = Date.now();
  const connectedUntil = connectedAt + 4 * 60 * 60 * 1_000;
  let started = false;
  const closeBikeBridge = await createWatchBikeBridge();

  try {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ deadline, id, pairing }) => {
    type Callback = (payload: unknown) => void;
    type TestWindow = typeof window & {
      webkit?: { messageHandlers: { bridge: { postMessage: (message: unknown) => void } } };
      Capacitor?: {
        PluginHeaders: Array<{ name: string; methods: Array<{ name: string; rtype: 'promise' | 'callback' }> }>;
        nativePromise: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
        nativeCallback: (
          plugin: string,
          method: string,
          options: { eventName?: string; callbackId?: string },
          callback?: Callback,
        ) => Promise<string>;
      };
      __watchOrdering?: { snapshot: () => { clearCalls: number; startCalls: number; phase: string } };
    };
    const testWindow = window as TestWindow;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    window.localStorage.setItem('tracklab-bmx-bike-connection-source-v1', 'advanced');
    testWindow.webkit = { messageHandlers: { bridge: { postMessage: () => undefined } } };
    const listeners = new Map<string, Map<string, Callback>>();
    let sequence = 0;
    let clearCalls = 0;
    let startCalls = 0;
    let phase = 'inactive';
    const state = () => ({
      version: 1,
      state: phase,
      scope: phase === 'inactive' ? null : 'personal',
      connectionId: phase === 'inactive' ? null : id,
      sessionId: phase === 'inactive' ? null : `watch-connect:${id}`,
      connectedUntil: phase === 'inactive' ? null : deadline,
      remainingMs: phase === 'inactive' ? 0 : Math.max(0, deadline - Date.now()),
      requiresUserStart: phase === 'inactive',
      workoutReady: phase === 'connected',
      relayConfigured: phase !== 'inactive',
    });
    const emit = () => listeners.get('heartRateStatus')?.forEach((callback) => callback({
      version: 1,
      state: phase === 'connected' ? 'active' : phase === 'connecting' ? 'connecting' : 'idle',
      sessionId: phase === 'inactive' ? null : `watch-connect:${pairing}`,
      at: Date.now(),
      watchConnect: state(),
    }));
    const emitSample = () => listeners.get('heartRateSample')?.forEach((callback) => callback({
      version: 1,
      source: 'apple-watch',
      sessionId: `watch-connect:${pairing}`,
      sequence: 1,
      bpm: 152,
      measuredAt: Date.now(),
      receivedAt: Date.now(),
    }));
    const promiseMethods = [
      'getAvailability', 'getState', 'getRelayState', 'getWatchConnectIdentity',
      'getWatchConnectState', 'startWatchConnect', 'stopWatchConnect',
      'startWorkout', 'pauseWorkout', 'resumeWorkout', 'endWorkout',
      'configureRelay', 'pauseRelay', 'resumeRelay', 'finalizeRelay',
      'clearRelay', 'clearAllRelays',
    ];
    testWindow.__watchOrdering = {
      snapshot: () => ({ clearCalls, startCalls, phase }),
    };
    testWindow.Capacitor = {
      PluginHeaders: [{
        name: 'TrackLabHeartRate',
        methods: [
          ...promiseMethods.map((name) => ({ name, rtype: 'promise' as const })),
          { name: 'addListener', rtype: 'callback' },
          { name: 'removeListener', rtype: 'callback' },
        ],
      }],
      nativePromise: async (_plugin, method) => {
        if (method === 'getAvailability') return {
          version: 1,
          supported: true,
          platform: 'iphone',
          paired: true,
          watchAppInstalled: true,
          healthDataAvailable: true,
          minimumIOS: '17.0',
          minimumWatchOS: '10.0',
        };
        if (method === 'getState') return {
          version: 1,
          state: 'idle',
          sessionId: null,
          at: Date.now(),
          watchConnect: state(),
        };
        if (method === 'getWatchConnectState') return state();
        if (method === 'getRelayState') return {
          version: 3,
          configured: false,
          syncing: false,
          clearing: false,
          queuedSessionIds: [],
          queuedCount: 0,
          pendingSampleCount: 0,
          droppedSampleCount: 0,
          sessions: [],
        };
        if (method === 'getWatchConnectIdentity') {
          return { version: 1, installId: `wci_${'4'.repeat(64)}` };
        }
        if (method === 'startWatchConnect') {
          startCalls += 1;
          phase = 'connecting';
          emit();
          emitSample();
          // Reproduce the device ordering: the listener reaches React before
          // the native promise resolves.
          await new Promise((resolve) => window.setTimeout(resolve, 150));
          phase = 'connected';
          emit();
          return state();
        }
        if (method === 'clearAllRelays') {
          clearCalls += 1;
          phase = 'inactive';
          emit();
          return { configured: false };
        }
        if (method === 'stopWatchConnect') {
          phase = 'inactive';
          emit();
          return state();
        }
        return {};
      },
      nativeCallback: async (_plugin, method, options, callback) => {
        if (method === 'addListener' && options.eventName && callback) {
          const callbackId = `${options.eventName}-${sequence += 1}`;
          const callbacks = listeners.get(options.eventName) ?? new Map<string, Callback>();
          callbacks.set(callbackId, callback);
          listeners.set(options.eventName, callbacks);
          return callbackId;
        }
        if (method === 'removeListener' && options.eventName && options.callbackId) {
          listeners.get(options.eventName)?.delete(options.callbackId);
        }
        return options.callbackId ?? 'removed';
      },
    };
  }, { deadline: connectedUntil, id: connectionId, pairing: 'pairing-iphone-new' });
  await routeSignedInShell(page, user);
  await page.route('**/api/heart-rate/watch-connect/enrollments', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      enrollment: {
        id: enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'trusted',
        liveStudioConsent: false,
        sessionStudioConsent: false,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      },
      replayed: false,
    }),
  }));
  await page.route('**/api/heart-rate/watch-connect/connections', (route) => {
    started = true;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        connection: {
          id: connectionId,
          enrollmentId,
          scope: 'personal',
          clubId: null,
          studioRiderId: null,
          state: 'connected',
          connectedAt,
          connectedUntil,
          remainingMs: connectedUntil - connectedAt,
          liveStudioConsent: false,
          sessionStudioConsent: false,
        },
        credentials: {
          connectionId,
          pairingId: 'pairing-iphone-new',
          relaySessionId: `watch-connect:${connectionId}`,
          ingestToken: 'test-private-ingest-token',
          expiresAt: connectedUntil,
        },
        replayed: false,
      }),
    });
  });
  await page.route('**/api/heart-rate/watch-connect', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(started ? {
      enrollments: [{
        id: enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'trusted',
        liveStudioConsent: false,
        sessionStudioConsent: false,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      }],
      connections: [{
        id: connectionId,
        enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'connected',
        connectedAt,
        connectedUntil,
        remainingMs: Math.max(0, connectedUntil - Date.now()),
        liveStudioConsent: false,
        sessionStudioConsent: false,
      }],
    } : { enrollments: [], connections: [] }),
  }));
  await page.route('**/api/heart-rate/live/latest', (route) => {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        freshnessMs: 10_000,
        reading: null,
      }),
    });
  });

  await page.goto('/?track=air-time-bmx');
  await openApp(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Watch Connect', exact: true }).click();
  const card = page.getByRole('region', { name: 'iPhone Watch Rider Watch Connect' });
  await card.getByRole('button', { name: 'Watch Connect', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __watchOrdering?: { snapshot: () => { clearCalls: number; startCalls: number; phase: string } };
    }
  ).__watchOrdering?.snapshot())).toEqual({ clearCalls: 0, startCalls: 1, phase: 'connected' });
  await expect(card.getByText(/Connected ·/)).toBeVisible();
  await expect(card.getByLabel(/152 beats per minute/)).toBeVisible();
  const indicator = page.locator('[data-watch-connect-status]').filter({ visible: true });
  await expect(indicator).toHaveAttribute('data-watch-connect-status', 'live');
  await expect.poll(async () => (await indicator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);

  await page.getByRole('button', { name: 'Get Pulled', exact: true }).click();
  const pull = page.getByLabel('Get Pulled timed Wattbike test');
  const athlete = pull.getByRole('combobox', { name: /Athlete assigned to/ });
  await athlete.selectOption(`account:${user.id}`);
  await pull.getByRole('button', { name: /Start 3 seconds pull/ }).click();
  await expect(pull.getByLabel(/152 beats per minute/)).toBeVisible();
  await pull.getByRole('button', { name: 'Cancel sprint', exact: true }).click();

  await page.getByRole('button', { name: 'BMX Race Intervals', exact: true }).click();
  await page.getByLabel('Connection method').getByRole('button', { name: 'Demo' }).click();
  const startRace = page.locator('.workflow-step.primary-action');
  await expect(startRace).toContainText('Start Demo Race');
  await startRace.click();
  const shell = page.locator('.platform-shell');
  await expect(shell).toHaveClass(/race-fullscreen/);
  const demoHeartRates = page.locator('.race-rider-overlay-heart-rate');
  await expect(demoHeartRates).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(demoHeartRates.nth(index)).toContainText(/Sim ·\s*\d+ BPM/);
    await expect(demoHeartRates.nth(index)).toHaveAttribute(
      'aria-label',
      /Simulated heart rate \d+ beats per minute/,
    );
  }
  await expect(page.locator('.race-rider-overlay')).not.toContainText('152 BPM');
  const fullscreenStatus = page.locator(
    '.watch-connect-indicator-slot.fullscreen [data-watch-connect-status]',
  );
  await expect(fullscreenStatus).toHaveAttribute('role', 'status');
  await expect(fullscreenStatus).toHaveAttribute('data-watch-connect-status', 'live');
  await expect(fullscreenStatus).toHaveCSS('pointer-events', 'none');
  await expect(fullscreenStatus.getByRole('button')).toHaveCount(0);
  await expect(fullscreenStatus.locator('.watch-connect-indicator-icon b')).toHaveText('152');
  await expect(fullscreenStatus.locator('.watch-connect-indicator-icon b')).toBeVisible();
  await expect(fullscreenStatus).toHaveAttribute('aria-label', /152 beats per minute/);
  await expect(fullscreenStatus).toHaveCSS('width', '44px');
  await expect(shell).toHaveClass(/race-fullscreen/);

  await page.evaluate(() => {
    const voice = document.createElement('button');
    voice.type = 'button';
    voice.className = 'race-countdown-pause-overlay race-room-voice-overlay';
    voice.dataset.testRoomVoiceOverlay = 'true';
    voice.textContent = 'Mic Off';
    document.querySelector('.platform-shell')?.append(voice);
  });
  const voiceOverlay = page.locator('[data-test-room-voice-overlay="true"]');
  await expect(voiceOverlay).toBeVisible();
  const expectVoiceClearance = async () => {
    const [watchBox, voiceBox] = await Promise.all([
      fullscreenStatus.boundingBox(),
      voiceOverlay.boundingBox(),
    ]);
    expect(watchBox).not.toBeNull();
    expect(voiceBox).not.toBeNull();
    expect(watchBox!.y).toBeGreaterThanOrEqual(voiceBox!.y + voiceBox!.height + 8);
  };
  await expectVoiceClearance();
  } finally {
    await closeBikeBridge();
  }
});

test('sign-out waits for a deferred Watch start to clean account A before logout', async ({ page }) => {
  test.setTimeout(45_000);
  const user = signedInUser('watch-signout-a', 'Watch Signout A');
  const enrollmentId = 'enrollment-signout-a';
  const connectionId = 'connection-signout-a';
  const pairingId = 'pairing-signout-a';
  const connectedAt = Date.now();
  const connectedUntil = connectedAt + 4 * 60 * 60 * 1_000;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  let createRequested = false;
  let createResolved = false;
  let logoutRequests = 0;
  const mutationSessions: string[] = [];
  let session = 'account-a';

  await page.addInitScript(() => {
    type Callback = (payload: unknown) => void;
    type TestWindow = typeof window & {
      webkit?: { messageHandlers: { bridge: { postMessage: () => void } } };
      Capacitor?: {
        PluginHeaders: Array<{ name: string; methods: Array<{ name: string; rtype: 'promise' | 'callback' }> }>;
        nativePromise: (_plugin: string, method: string) => Promise<unknown>;
        nativeCallback: (
          _plugin: string,
          method: string,
          options: { eventName?: string; callbackId?: string },
          callback?: Callback,
        ) => Promise<string>;
      };
      __watchSignout?: { startCalls: () => number };
    };
    const testWindow = window as TestWindow;
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    testWindow.webkit = { messageHandlers: { bridge: { postMessage: () => undefined } } };
    let startCalls = 0;
    let callbackSequence = 0;
    const inactive = () => ({
      version: 1,
      state: 'inactive',
      scope: null,
      connectionId: null,
      sessionId: null,
      connectedUntil: null,
      remainingMs: 0,
      requiresUserStart: true,
      workoutReady: false,
      relayConfigured: false,
    });
    const methods = [
      'getAvailability', 'getState', 'getRelayState', 'getWatchConnectIdentity',
      'getWatchConnectState', 'startWatchConnect', 'stopWatchConnect',
      'startWorkout', 'pauseWorkout', 'resumeWorkout', 'endWorkout',
      'configureRelay', 'pauseRelay', 'resumeRelay', 'finalizeRelay',
      'clearRelay', 'clearAllRelays',
    ];
    testWindow.__watchSignout = { startCalls: () => startCalls };
    testWindow.Capacitor = {
      PluginHeaders: [{
        name: 'TrackLabHeartRate',
        methods: [
          ...methods.map((name) => ({ name, rtype: 'promise' as const })),
          { name: 'addListener', rtype: 'callback' },
          { name: 'removeListener', rtype: 'callback' },
        ],
      }],
      nativePromise: async (_plugin, method) => {
        if (method === 'getAvailability') return {
          version: 1,
          supported: true,
          platform: 'iphone',
          paired: true,
          watchAppInstalled: true,
          healthDataAvailable: true,
          minimumIOS: '17.0',
          minimumWatchOS: '10.0',
        };
        if (method === 'getState') return {
          version: 1,
          state: 'idle',
          sessionId: null,
          at: Date.now(),
          watchConnect: inactive(),
        };
        if (method === 'getWatchConnectState' || method === 'stopWatchConnect') return inactive();
        if (method === 'getWatchConnectIdentity') {
          return { version: 1, installId: `wci_${'7'.repeat(64)}` };
        }
        if (method === 'getRelayState') return {
          version: 3,
          configured: false,
          syncing: false,
          clearing: false,
          queuedSessionIds: [],
          queuedCount: 0,
          pendingSampleCount: 0,
          droppedSampleCount: 0,
          sessions: [],
        };
        if (method === 'startWatchConnect') {
          startCalls += 1;
          return inactive();
        }
        if (method === 'clearAllRelays') return { configured: false };
        return {};
      },
      nativeCallback: async (_plugin, method, options) => (
        method === 'addListener' ? `listener-${callbackSequence += 1}` : options.callbackId ?? 'removed'
      ),
    };
  });
  await routeSignedInShell(page, user);
  await page.route('**/api/heart-rate/watch-connect/enrollments', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      enrollment: {
        id: enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'trusted',
        liveStudioConsent: false,
        sessionStudioConsent: false,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      },
      replayed: false,
    }),
  }));
  await page.route('**/api/heart-rate/watch-connect/connections', async (route) => {
    createRequested = true;
    await createGate;
    createResolved = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        connection: {
          id: connectionId,
          enrollmentId,
          scope: 'personal',
          clubId: null,
          studioRiderId: null,
          state: 'connected',
          connectedAt,
          connectedUntil,
          remainingMs: connectedUntil - connectedAt,
          liveStudioConsent: false,
          sessionStudioConsent: false,
        },
        credentials: {
          connectionId,
          pairingId,
          relaySessionId: `watch-connect:${connectionId}`,
          ingestToken: 'private-signout-token',
          expiresAt: connectedUntil,
        },
        replayed: false,
      }),
    });
  });
  await page.route(`**/api/heart-rate/watch-connect/connections/${connectionId}`, (route) => {
    mutationSessions.push(`${session}:connection:${connectionId}`);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ connection: {
        id: connectionId,
        enrollmentId,
        scope: 'personal',
        clubId: null,
        studioRiderId: null,
        state: 'stopped',
        connectedAt,
        connectedUntil,
        remainingMs: 0,
        liveStudioConsent: false,
        sessionStudioConsent: false,
      } }),
    });
  });
  await page.route(`**/api/heart-rate/pairings/${pairingId}`, (route) => {
    mutationSessions.push(`${session}:pairing:${pairingId}`);
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/heart-rate/watch-connect', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(createResolved ? {
      enrollments: [],
      connections: [],
    } : { enrollments: [], connections: [] }),
  }));
  await page.route('**/api/heart-rate/live/latest', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ freshnessMs: 10_000, reading: null }),
  }));
  await page.route('**/api/auth/logout', (route) => {
    logoutRequests += 1;
    mutationSessions.push(`${session}:logout`);
    session = 'signed-out';
    return route.fulfill({ contentType: 'application/json', body: '{}' });
  });

  await page.goto('/?track=air-time-bmx');
  await openApp(page);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Watch Connect', exact: true }).click();
  const card = page.getByRole('region', { name: 'Watch Signout A Watch Connect' });
  await card.getByRole('button', { name: 'Watch Connect', exact: true }).click();
  await expect.poll(() => createRequested).toBe(true);
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await expect.poll(() => logoutRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __watchSignout?: { startCalls: () => number } }
  ).__watchSignout?.startCalls())).toBe(0);

  releaseCreate();
  await expect.poll(() => logoutRequests).toBe(1);
  expect(mutationSessions).toContain(`account-a:connection:${connectionId}`);
  expect(mutationSessions).toContain(`account-a:pairing:${pairingId}`);
  expect(mutationSessions.at(-1)).toBe('account-a:logout');
  expect(mutationSessions.some((entry) => entry.startsWith('signed-out:'))).toBe(false);
});

test('fullscreen Watch status stays clear of race voice and mapping controls', async ({ page }) => {
  test.setTimeout(30_000);
  const user = signedInUser('watch-layout', 'Watch Layout Rider');
  await routeSignedInShell(page, user);
  await page.route('**/api/heart-rate/watch-connect', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ enrollments: [], connections: [] }),
  }));
  await page.route('**/api/heart-rate/live/latest', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ freshnessMs: 10_000, reading: null }),
  }));
  await page.goto('/?track=air-time-bmx');
  await openApp(page);
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'watch-fullscreen-layout-fixture';
    fixture.className = 'platform-shell race-fullscreen';
    fixture.innerHTML = `
      <div class="watch-connect-indicator-slot fullscreen">
        <div class="watch-connect-indicator live" data-watch-layout-indicator="true">
          <span class="watch-connect-indicator-icon" aria-hidden="true">W</span>
          <span class="watch-connect-indicator-label">Watch live</span>
          <span class="watch-connect-indicator-cue" aria-hidden="true">✓</span>
        </div>
      </div>
      <button class="race-countdown-pause-overlay race-room-voice-overlay"
        data-watch-layout-voice="true" type="button">Mic Off</button>
    `;
    document.body.append(fixture);
  });

  const fixture = page.locator('#watch-fullscreen-layout-fixture');
  const watch = fixture.locator('[data-watch-layout-indicator="true"]');
  const voice = fixture.locator('[data-watch-layout-voice="true"]');
  const expectNoOverlap = async (first: typeof watch, second: typeof voice) => {
    const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    const overlaps = firstBox!.x < secondBox!.x + secondBox!.width
      && firstBox!.x + firstBox!.width > secondBox!.x
      && firstBox!.y < secondBox!.y + secondBox!.height
      && firstBox!.y + firstBox!.height > secondBox!.y;
    expect(overlaps).toBe(false);
  };

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(watch).toBeVisible();
    await expect(watch).toHaveCSS('width', '44px');
    await expectNoOverlap(watch, voice);
  }

  await page.evaluate(() => {
    const layout = document.querySelector('#watch-fullscreen-layout-fixture');
    layout?.classList.remove('race-fullscreen');
    layout?.classList.add('map-fullscreen');
    layout?.querySelector('[data-watch-layout-voice]')?.remove();
    const controls = document.createElement('aside');
    controls.className = 'control-panel';
    controls.dataset.watchLayoutControls = 'true';
    controls.innerHTML = '<section class="panel-section mapping-section">Mapping tools</section>';
    layout?.append(controls);
  });
  const controls = fixture.locator('[data-watch-layout-controls="true"]');

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(controls).toBeVisible();
    await expectNoOverlap(watch, controls);
    const [watchBox, controlsBox] = await Promise.all([watch.boundingBox(), controls.boundingBox()]);
    expect(watchBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(controlsBox!.y).toBeGreaterThanOrEqual(watchBox!.y + watchBox!.height + 8);
    expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(viewport.height - 8);
    await expect.poll(async () => (await controls.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(280);
  }
});
