import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

let child: ChildProcess;
let baseUrl = '';
let cookie = '';
let secondaryCookie = '';
const testSockets = new Set<WebSocket>();

type TestSocket = {
  socket: WebSocket;
  messages: Array<Record<string, any>>;
};

async function openTestSocket(authCookie: string): Promise<TestSocket> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/multiplayer`, {
    headers: { Cookie: authCookie, Origin: baseUrl },
  });
  const messages: Array<Record<string, any>> = [];
  socket.on('message', (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      // Tests only inspect JSON protocol messages.
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  testSockets.add(socket);
  return { socket, messages };
}

async function waitForSocketMessage(
  connection: TestSocket,
  predicate: (message: Record<string, any>) => boolean,
  afterIndex = 0,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = connection.messages.slice(afterIndex).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for WebSocket message. Received: ${JSON.stringify(connection.messages.slice(afterIndex))}`);
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The child process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Cloud test server did not become healthy.');
}

function api(pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

function trackMapping(trackId: string) {
  const startGate = { lat: 38.244, lng: -122.283 };
  const finishLine = { lat: 38.245, lng: -122.282 };
  return {
    version: 1,
    trackId,
    trackName: 'North Bay BMX - Napa Valley',
    country: 'United States',
    state: 'California',
    savedAt: new Date().toISOString(),
    routeStatus: 'user-mapped',
    restAfterSeconds: 1,
    lengthMeters: 320,
    centerline: [startGate, finishLine],
    startGate,
    finishLine,
    zoneBoundaryMeters: [0, 45],
    zones: [{
      id: 'pedal-zone-1',
      name: 'Pedal Zone 1',
      startMeter: 0,
      endMeter: 45,
      type: 'pedal',
      restAfterSeconds: 1,
    }],
    splitSections: [],
  };
}

function customSprintTrack(id: string) {
  return {
    id,
    name: 'Drag Strip',
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'New Hampshire',
    region: 'New Hampshire',
    source: 'Custom',
    sourceUrl: 'local://custom-route',
    sourceType: 'manual',
    verificationStatus: 'unverified',
    addressStatus: 'provider-address',
    address: 'Drag Strip, Epping, NH 03042, USA',
    city: 'Epping',
    postalCode: '03042',
    latitude: 43.031,
    longitude: -71.077,
    coordinateSource: 'TrackLab developer mapping',
    coordinateAccuracy: 'developer-confirmed',
    lengthMeters: 457.2,
    elevationMeters: 0,
    surface: 'Custom sprint route',
    outline: [
      { lat: 43.031, lng: -71.077 },
      { lat: 43.032, lng: -71.076 },
    ],
    routeStatus: 'locator-only',
    zones: [],
    leaderboards: { rpm: [], speed: [], watts: [] },
  };
}

function exploreRoute(id: string) {
  return {
    id,
    name: 'My San Francisco ride',
    origin: { lat: 37.7749, lng: -122.4194 },
    destination: { lat: 37.8024, lng: -122.4058 },
    originLabel: 'Market Street, San Francisco, CA',
    destinationLabel: 'Fisherman’s Wharf, San Francisco, CA',
    travelMode: 'bicycle',
    distanceMeters: 5_200,
    durationSeconds: 1_320,
    encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    createdAt: Date.now(),
  };
}

beforeAll(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['cloud/server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TRACKLAB_ADMIN_EMAILS: 'admin-only@tracklab.test,usage-admin@tracklab.test,global-view-admin@tracklab.test,club-owner-admin@tracklab.test',
      TRACKLAB_ALLOW_RACER_MAP_PUBLISH: '0',
      TRACKLAB_METRICS_TOKEN: 'test-metrics-token',
      TRACKLAB_3D_FREE_LOAD_CAP: '5000',
      TRACKLAB_CLUB_LIVE_SESSION_TTL_MS: '600',
      APPLE_MAPKIT_JS_TOKEN: 'test-domain-restricted-mapkit-token',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
}, 35_000);

afterAll(async () => {
  testSockets.forEach((socket) => socket.terminate());
  testSockets.clear();
  if (!child || child.exitCode != null) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

describe('cloud API trust boundaries', () => {
  it('serves public App Store pages without turning missing assets into SPA routes', async () => {
    for (const pathname of ['/privacy', '/privacy-policy', '/support']) {
      const response = await fetch(`${baseUrl}${pathname}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toContain('<div id="root"></div>');
    }

    const missingAsset = await fetch(`${baseUrl}/assets/tracklab-missing.js`, {
      headers: { Accept: 'text/html' },
    });
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.headers.get('content-type')).toContain('application/json');
  });

  it('reports a no-store healthy memory fallback', async () => {
    const response = await api('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      storage: { mode: 'memory', configured: false, ready: true },
    });
  });

  it('reports commentary capability without exposing a server key', async () => {
    const response = await api('/api/commentary/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const config = await response.json();
    expect(config).toMatchObject({
      aiAvailable: false,
      speechStatus: 'not-configured',
      textModel: 'local-race-engine',
      preRaceTextModel: 'gpt-5.6-luna',
      speechModel: 'gpt-realtime-2.1-mini',
      voicePresets: ['american-man'],
      research: {
        knowledgeVersion: 'usabmx-national-2026-07-23-v6-2024-inventory-and-prosody',
        indexedVideos: 285,
        analyzedRaceCallSegments: 18_208,
        analyzedRaceAudioSections: 9,
        minimumGenerativeVocabularyTarget: 10_000,
        vocabularyStrategy: 'open-generative-lexicon',
        retainsFullTranscripts: false,
        retainsSourceAudio: false,
      },
    });
    expect(config).not.toHaveProperty('textModels');
    expect(JSON.stringify(config)).not.toContain('OPENAI_API_KEY');
  });

  it('reports Explore capability without exposing its Google Routes key', async () => {
    const response = await api('/api/explore/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      routesConfigured: false,
      smartRoutesConfigured: false,
      supportedTravelModes: ['bicycle'],
      routeNotice: 'Explore routes favor bicycle-accessible roads and paths and avoid major interstates.',
    });

    const unauthorizedRoute = await fetch(`${baseUrl}/api/explore/route`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        origin: { lat: 38.5, lng: -120.2 },
        destination: { lat: 38.6, lng: -120.1 },
        travelMode: 'bicycle',
      }),
    });
    expect(unauthorizedRoute.status).toBe(401);

    const unauthorizedElevation = await fetch(`${baseUrl}/api/explore/elevation`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceMeters: 1_000,
      }),
    });
    expect(unauthorizedElevation.status).toBe(401);
  });

  it('protects production metrics and exposes redacted process telemetry to operators', async () => {
    const unauthorized = await api('/api/metrics');
    expect(unauthorized.status).toBe(401);

    const authorized = await api('/api/metrics', {
      headers: { Authorization: 'Bearer test-metrics-token' },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('content-type')).toContain('text/plain');
    const metrics = await authorized.text();
    expect(metrics).toContain('tracklab_process_uptime_seconds{service="tracklab-cloud"}');
    expect(metrics).toContain('tracklab_http_requests_total');
    expect(metrics).not.toContain('test-metrics-token');
  });

  it('requires authentication for profile data', async () => {
    const response = await fetch(`${baseUrl}/api/user-data`);
    expect(response.status).toBe(401);

    const mappingSave = await fetch(`${baseUrl}/api/user-data/track-mapping`, {
      method: 'POST',
      headers: { Origin: baseUrl },
    });
    expect(mappingSave.status).toBe(401);

    const personalRoutes = await fetch(`${baseUrl}/api/explore/recent-routes`);
    expect(personalRoutes.status).toBe(401);

    const commentary = await fetch(`${baseUrl}/api/commentary/line`, {
      method: 'POST',
      headers: { Origin: baseUrl },
    });
    expect(commentary.status).toBe(401);
  });

  it('keeps profile reads and writes bound to the authenticated account', async () => {
    const email = 'club-owner-admin@tracklab.test';
    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Review Rider', email, password: 'correct-horse-battery-staple' }),
    });
    expect(registration.status).toBe(201);
    cookie = String(registration.headers.get('set-cookie')).split(';')[0];

    const saved = await api('/api/user-data?profileKey=user:someone-else', {
      method: 'PATCH',
      body: JSON.stringify({
        accountProfile: {
          photoUrl: 'data:image/png;base64,QUJDRA==',
          updatedAt: 210,
        },
        bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }],
        studioRiders: [{
          id: 'rider-jordan',
          name: 'Jordan',
          photoUrl: 'data:image/jpeg;base64,QUJDRA==',
          createdAt: 100,
          updatedAt: 100,
        }],
        raceViewPreferences: {
          cameraLocked: true,
          cameraLockedUpdatedAt: 200,
          earthCamerasByTrack: {
            'north-bay-bmx': { angle: 42, heading: 180, zoom: 19, updatedAt: 200 },
          },
          riderOverlaysByTrack: {
            'north-bay-bmx': {
              xPct: 0.08,
              yPct: 0.72,
              width: 1040,
              height: 190,
              locked: true,
            },
          },
          riderOverlayUpdatedAtByTrack: {
            'north-bay-bmx': 200,
          },
          demoRiderNames: {
            1: 'Maya Torres',
            2: 'Jordan Lee',
            5: 'Invalid Lane',
          },
          demoRiderNamesUpdatedAt: 200,
          demoRiderPhotos: {
            1: 'data:image/jpeg;base64,QUJDRA==',
            2: 'data:image/svg+xml;base64,PHN2Zz4=',
          },
          demoRiderPhotosUpdatedAt: 200,
          commentary: {
            enabled: true,
            ambientEnabled: false,
            ambientVolume: 0.11,
            ambientVolumeLocked: true,
            model: 'gpt-5.6-sol',
            voicePreset: 'american-man',
            volume: 0.75,
            adaptiveMemory: true,
            recentLines: ['Avery takes it to the stripe.'],
          },
          commentaryUpdatedAt: 200,
        },
      }),
    });
    expect(saved.status).toBe(200);

    const loaded = await api('/api/user-data?profileKey=user:someone-else');
    expect(loaded.status).toBe(200);
    const loadedPayload = await loaded.json();
    expect(loadedPayload).toMatchObject({
      accountProfile: {
        photoUrl: 'data:image/png;base64,QUJDRA==',
        updatedAt: 210,
      },
      bikeProfiles: [{ deviceId: 58701, name: 'Studio One' }],
      studioRiders: [{
        id: 'rider-jordan',
        name: 'Jordan',
        photoUrl: 'data:image/jpeg;base64,QUJDRA==',
        createdAt: 100,
        updatedAt: 100,
      }],
      raceViewPreferences: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 200,
        earthCamerasByTrack: {
          'north-bay-bmx': { angle: 42, heading: 180, zoom: 19, updatedAt: 200 },
        },
        riderOverlaysByTrack: {
          'north-bay-bmx': {
            xPct: 0.08,
            yPct: 0.72,
            width: 1040,
            height: 190,
            locked: true,
          },
        },
        riderOverlayUpdatedAtByTrack: {
          'north-bay-bmx': 200,
        },
        demoRiderNames: {
          1: 'Maya Torres',
          2: 'Jordan Lee',
        },
        demoRiderNamesUpdatedAt: 200,
        demoRiderPhotos: {
          1: 'data:image/jpeg;base64,QUJDRA==',
        },
        demoRiderPhotosUpdatedAt: 200,
        commentary: {
          enabled: true,
          ambientEnabled: false,
          ambientVolume: 0.11,
          ambientVolumeLocked: true,
          voicePreset: 'american-man',
          volume: 0.75,
          adaptiveMemory: true,
          recentLines: ['Avery takes it to the stripe.'],
        },
        commentaryUpdatedAt: 200,
      },
    });
    expect(loadedPayload.raceViewPreferences.commentary).not.toHaveProperty('model');

    const staleBrowserSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 100,
          earthCamerasByTrack: {
            'north-bay-bmx': { angle: 0, heading: 0, zoom: 17, updatedAt: 100 },
          },
          riderOverlaysByTrack: {
            'north-bay-bmx': {
              xPct: 0,
              yPct: 0,
              width: 320,
              height: 190,
              locked: false,
            },
          },
          riderOverlayUpdatedAtByTrack: {
            'north-bay-bmx': 100,
          },
          demoRiderNames: {},
          demoRiderNamesUpdatedAt: 100,
          demoRiderPhotos: {},
          demoRiderPhotosUpdatedAt: 100,
          commentary: {
            enabled: false,
            ambientEnabled: false,
            ambientVolume: 0.05,
            ambientVolumeLocked: true,
            voicePreset: 'american-man',
            volume: 0.6,
            adaptiveMemory: true,
            recentLines: ['A newer commentary preference.'],
          },
          commentaryUpdatedAt: 300,
        },
      }),
    });
    expect(staleBrowserSave.status).toBe(200);
    const mergedPayload = await staleBrowserSave.json();
    expect(mergedPayload.raceViewPreferences).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'north-bay-bmx': { angle: 42, heading: 180, zoom: 19, updatedAt: 200 },
      },
      riderOverlaysByTrack: {
        'north-bay-bmx': {
          xPct: 0.08,
          yPct: 0.72,
          width: 1040,
          height: 190,
          locked: true,
        },
      },
      demoRiderNames: {
        1: 'Maya Torres',
        2: 'Jordan Lee',
      },
      demoRiderPhotos: {
        1: 'data:image/jpeg;base64,QUJDRA==',
      },
      commentary: {
        enabled: false,
        volume: 0.6,
        recentLines: ['A newer commentary preference.'],
      },
    });

    const savedRoute = await api('/api/explore/recent-routes?profileKey=user:someone-else', {
      method: 'POST',
      body: JSON.stringify({ routes: [exploreRoute('EXPLORE-PERSONAL-1')] }),
    });
    expect(savedRoute.status).toBe(200);
    await expect(savedRoute.json()).resolves.toMatchObject({
      routes: [{ id: 'EXPLORE-PERSONAL-1', name: 'My San Francisco ride' }],
    });

    const trainingStartedAt = Date.now() - 20_000;
    for (const [index, activityType] of ['bmx-race', 'straight-sprint', 'explore'].entries()) {
      const trainingSave = await api('/api/training-sessions', {
        method: 'POST',
        body: JSON.stringify({
          session: {
            id: `training-${activityType}-${trainingStartedAt}`,
            activityType,
            title: `${activityType} training`,
            startedAt: trainingStartedAt + index * 1_000,
            endedAt: trainingStartedAt + index * 1_000 + 8_000,
            durationMs: 8_000,
            distanceMeters: activityType === 'explore' ? 3_218.688 : 320,
            trackId: 'north-bay-bmx',
            trackName: 'North Bay BMX',
            details: { riderName: 'Review Rider', attempt: index + 1 },
          },
        }),
      });
      expect(trainingSave.status).toBe(201);
    }

    const trainingHistory = await api(`/api/training-sessions?from=${trainingStartedAt - 1_000}&to=${Date.now()}&limit=20`);
    expect(trainingHistory.status).toBe(200);
    await expect(trainingHistory.json()).resolves.toMatchObject({
      totals: {
        sessions: 3,
        bmxRaces: 1,
        straightSprints: 1,
        exploreRides: 1,
        distanceMeters: 3_858.688,
        durationMs: 24_000,
      },
    });

    const firstAccountCookie = cookie;
    const secondRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Other Rider',
        email: `other-${Date.now()}@tracklab.test`,
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(secondRegistration.status).toBe(201);
    cookie = String(secondRegistration.headers.get('set-cookie')).split(';')[0];
    secondaryCookie = cookie;

    const otherAccountRoutes = await api('/api/explore/recent-routes?profileKey=user:someone-else');
    expect(otherAccountRoutes.status).toBe(200);
    await expect(otherAccountRoutes.json()).resolves.toEqual({ routes: [] });

    const otherAccountTraining = await api(`/api/training-sessions?from=${trainingStartedAt - 1_000}&to=${Date.now()}`);
    expect(otherAccountTraining.status).toBe(200);
    await expect(otherAccountTraining.json()).resolves.toMatchObject({ sessions: [], totals: { sessions: 0 } });

    cookie = firstAccountCookie;
    const restoredAfterBrowserReset = await api('/api/explore/recent-routes');
    expect(restoredAfterBrowserReset.status).toBe(200);
    await expect(restoredAfterBrowserReset.json()).resolves.toMatchObject({
      routes: [{ id: 'EXPLORE-PERSONAL-1' }],
    });
  });

  it('lets a student privately claim only their studio training record', async () => {
    const now = Date.now();
    const ownerCookie = cookie;

    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: 'studio-maya', name: 'Maya Torres', createdAt: now, updatedAt: now },
          { id: 'studio-jordan', name: 'Jordan Lee', createdAt: now, updatedAt: now },
        ],
      }),
    });
    expect(rosterSave.status).toBe(200);

    const trainingSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: `club-race-${now}`,
          activityType: 'bmx-race',
          title: 'North Bay BMX race',
          startedAt: now - 10_000,
          endedAt: now - 1_000,
          durationMs: 9_000,
          distanceMeters: 320,
          trackId: 'north-bay-bmx',
          trackName: 'North Bay BMX',
          details: {
            summaries: [
              { playerId: 1, riderId: 'studio-maya', riderName: 'Maya Torres', rank: 1, finishTimeMs: 8_100, distanceMeters: 320 },
              { playerId: 2, riderId: 'studio-jordan', riderName: 'Jordan Lee', rank: 2, finishTimeMs: 8_500, distanceMeters: 320 },
            ],
            zoneResults: [{ zoneId: 'zone-1', riders: [{ playerId: 1, topWatts: 900 }, { playerId: 2, topWatts: 850 }] }],
            events: [{ label: 'Maya Torres leads Jordan Lee' }],
          },
        },
      }),
    });
    expect(trainingSave.status).toBe(201);

    const inviteResponse = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-maya' }),
    });
    expect(inviteResponse.status).toBe(201);
    const invite = await inviteResponse.json();
    expect(invite.token).toHaveLength(43);

    cookie = secondaryCookie;
    const athleteCookie = cookie;

    const claim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({
        token: invite.token,
        fullName: 'Maya Alexandria Torres',
        nickname: 'Rocket',
        photoUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    });
    expect(claim.status).toBe(200);
    const claimPayload = await claim.json();
    expect(claimPayload).toMatchObject({
      canManageClub: false,
      user: { name: 'Maya Alexandria Torres (Rocket)', membership: { tier: 'spectator' } },
      accountProfile: { photoUrl: 'data:image/png;base64,aGVsbG8=' },
      memberships: [{ clubName: 'Review Rider', studioRiderId: 'studio-maya', riderName: 'Maya Torres' }],
    });
    const claimedMembership = claimPayload.memberships[0];

    const athleteClubState = await api('/api/club-connect?profileKey=user:club-owner');
    expect(athleteClubState.status).toBe(200);
    const athleteClubPayload = await athleteClubState.json();
    expect(athleteClubPayload).toMatchObject({
      canManageClub: false,
      ownedClub: null,
      memberships: [{ studioRiderId: 'studio-maya', riderName: 'Maya Torres' }],
    });
    expect(JSON.stringify(athleteClubPayload)).not.toContain('studio-jordan');
    expect(JSON.stringify(athleteClubPayload)).not.toContain('Jordan Lee');

    const copiedRosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({
        studioRiders: [
          { id: 'studio-jordan', name: 'Jordan Lee', createdAt: now, updatedAt: now },
        ],
        accountProfile: {
          photoUrl: 'data:image/png;base64,aGVsbG8=',
          updatedAt: now + 100_000,
        },
      }),
    });
    expect(copiedRosterSave.status).toBe(200);
    await expect(copiedRosterSave.json()).resolves.toMatchObject({
      studioRiders: [],
      accountProfile: {
        photoUrl: 'data:image/png;base64,aGVsbG8=',
        updatedAt: now + 100_000,
      },
    });
    const athleteUserData = await api('/api/user-data?profileKey=user:club-owner');
    expect(athleteUserData.status).toBe(200);
    const athleteUserDataPayload = await athleteUserData.json();
    expect(athleteUserDataPayload.studioRiders).toEqual([]);
    expect(JSON.stringify(athleteUserDataPayload)).not.toContain('studio-jordan');
    expect(JSON.stringify(athleteUserDataPayload)).not.toContain('Jordan Lee');
    const forbiddenAthleteInvite = await api('/api/club-connect/invites', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-jordan' }),
    });
    expect(forbiddenAthleteInvite.status).toBe(403);
    await expect(forbiddenAthleteInvite.json()).resolves.toEqual({
      error: 'Only the TrackLab club owner can invite studio athletes.',
    });
    const athleteStateAfterForbiddenInvite = await api('/api/club-connect');
    await expect(athleteStateAfterForbiddenInvite.json()).resolves.toMatchObject({
      canManageClub: false,
      ownedClub: null,
      memberships: [{ studioRiderId: 'studio-maya' }],
    });

    const athleteHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    expect(athleteHistory.status).toBe(200);
    const athleteHistoryPayload = await athleteHistory.json();
    expect(athleteHistoryPayload.sessions).toHaveLength(1);
    expect(athleteHistoryPayload.sessions[0].details.summaries).toEqual([
      expect.objectContaining({ riderId: 'studio-maya', riderName: 'Maya Torres' }),
    ]);
    expect(athleteHistoryPayload.sessions[0].details.zoneResults[0].riders).toEqual([
      expect.objectContaining({ playerId: 1, topWatts: 900 }),
    ]);
    expect(athleteHistoryPayload.sessions[0].details.events).toEqual([]);

    const athleteClubSessionId = `athlete-club-sprint-${now}`;
    const athleteClubSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: claimedMembership.clubId,
          studioRiderId: claimedMembership.studioRiderId,
        },
        session: {
          id: athleteClubSessionId,
          activityType: 'straight-sprint',
          title: '300 ft club sprint',
          startedAt: now - 800,
          endedAt: now - 200,
          durationMs: 600,
          distanceMeters: 91.44,
          trackId: 'club-drag-strip',
          trackName: 'Club Drag Strip',
          details: { sprintDistanceFeet: 300, sprintAirSetting: 4 },
        },
      }),
    });
    expect(athleteClubSave.status).toBe(201);
    await expect(athleteClubSave.json()).resolves.toMatchObject({
      session: {
        id: athleteClubSessionId,
        club: {
          id: claimedMembership.clubId,
          studioRiderId: 'studio-maya',
          riderName: 'Maya Torres',
          role: 'athlete',
        },
      },
    });

    const inactiveAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    expect(inactiveAccess.status).toBe(200);
    await expect(inactiveAccess.json()).resolves.toMatchObject({
      clubId: claimedMembership.clubId,
      active: false,
      expiresAt: null,
    });
    const spoofedAccess = await api('/api/club-live/access?clubId=club-not-mine');
    expect(spoofedAccess.status).toBe(403);
    const athleteMonitorRead = await api('/api/club-live/sessions');
    expect(athleteMonitorRead.status).toBe(403);
    const publishWithoutMonitor = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.1,
        metrics: { watts: 500 },
      }),
    });
    expect(publishWithoutMonitor.status).toBe(409);

    cookie = ownerCookie;
    const monitorOpen = await api('/api/club-live/sessions');
    expect(monitorOpen.status).toBe(200);
    expect(monitorOpen.headers.get('cache-control')).toBe('no-store');
    await expect(monitorOpen.json()).resolves.toMatchObject({
      club: { id: claimedMembership.clubId },
      sessions: [],
      heartbeatTtlMs: 600,
      pollAfterMs: 1_000,
    });

    cookie = athleteCookie;
    const activeAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    expect(activeAccess.status).toBe(200);
    expect(activeAccess.headers.get('cache-control')).toBe('no-store');
    await expect(activeAccess.json()).resolves.toMatchObject({
      clubId: claimedMembership.clubId,
      active: true,
      expiresAt: expect.any(Number),
    });

    const crossSiteGrantChange = await fetch(
      `${baseUrl}/api/club-live/access?clubId=club-not-mine`,
      {
        headers: {
          Cookie: athleteCookie,
          Origin: 'https://attacker.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      },
    );
    expect(crossSiteGrantChange.status).toBe(403);
    expect(crossSiteGrantChange.headers.get('cache-control')).toBe('no-store');
    const accessAfterCrossSiteAttempt = await api(
      `/api/club-live/access?clubId=${claimedMembership.clubId}`,
    );
    await expect(accessAfterCrossSiteAttempt.json()).resolves.toMatchObject({ active: true });

    const primarySocket = await openTestSocket(athleteCookie);
    const primaryConnected = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'connected',
    );
    primarySocket.socket.send(JSON.stringify({
      type: 'hello',
      available: true,
      bikeCount: 4,
      track: { id: 'club-live-track', name: 'Club Live Track' },
    }));
    await waitForSocketMessage(primarySocket, (message) => message.type === 'welcome');
    const primaryRoomStart = primarySocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'create-room',
      private: true,
      racerSeatCount: 4,
      track: { id: 'club-live-track', name: 'Club Live Track' },
    }));
    const primaryRoomState = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-state'
        && message.room?.members?.some((member: { id: string }) => member.id === primaryConnected.clientId),
      primaryRoomStart,
    );
    const multiplayerRoomId = primaryRoomState.room.id;
    const primaryRoomMember = primaryRoomState.room.members.find(
      (member: { id: string }) => member.id === primaryConnected.clientId,
    );
    expect(primaryRoomMember).toMatchObject({
      roomRole: 'racer',
      racerSeatCount: 1,
      membershipTier: 'racer',
    });
    expect(primaryRoomMember).not.toHaveProperty('racerAccess');
    expect(primaryRoomState.room).toMatchObject({
      hostId: primaryConnected.clientId,
      racerCount: 1,
      racerSeatCount: 1,
    });

    const duplicateSocket = await openTestSocket(athleteCookie);
    const duplicateConnected = await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'connected',
    );
    duplicateSocket.socket.send(JSON.stringify({ type: 'hello', available: true, bikeCount: 4 }));
    await waitForSocketMessage(duplicateSocket, (message) => message.type === 'welcome');
    const duplicateJoinStart = duplicateSocket.messages.length;
    duplicateSocket.socket.send(JSON.stringify({ type: 'join-room', roomId: multiplayerRoomId }));
    const duplicateRoomState = await waitForSocketMessage(
      duplicateSocket,
      (message) => message.type === 'room-state'
        && message.room?.members?.some((member: { id: string }) => member.id === duplicateConnected.clientId),
      duplicateJoinStart,
    );
    expect(duplicateRoomState.room.members.find(
      (member: { id: string }) => member.id === duplicateConnected.clientId,
    )).toMatchObject({ roomRole: 'spectator', racerSeatCount: 0 });
    expect(duplicateRoomState.room).toMatchObject({ racerCount: 1, racerSeatCount: 1 });

    const raceSyncStart = primarySocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'race-sync',
      state: {
        sessionId: 'club-live-temporary-race',
        trackId: 'club-live-track',
        raceState: 'racing',
        riders: [{ id: 'maya-live', playerId: 1, name: 'Maya Torres', distance: 20 }],
        summary: [],
      },
    }));
    await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'race-sync' && message.state?.sessionId === 'club-live-temporary-race',
      raceSyncStart,
    );

    // Renewal remains valid beyond the original TTL while the owner keeps the
    // monitor open, and updates already-connected sockets server-side.
    await new Promise((resolve) => setTimeout(resolve, 400));
    cookie = ownerCookie;
    expect((await api('/api/club-live/sessions')).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 400));
    cookie = athleteCookie;
    const renewedAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    await expect(renewedAccess.json()).resolves.toMatchObject({ active: true });

    const livePublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        riderName: 'Forged rider name',
        athleteName: 'Forged athlete name',
        sessionId: 'live-straight-sprint-1',
        activityType: 'straight-sprint',
        status: 'active',
        progress: { percent: 45, distanceMeters: 41.15, label: '145 ft sprint' },
        metrics: {
          watts: 1_100,
          cadence: 150,
          speedKph: 42.5,
          distanceMeters: 41.15,
          elapsedMs: 6_200,
          position: 1,
          participantCount: 4,
        },
        trackName: 'Club Drag Strip',
        multiplayer: true,
        roomId: 'PRIVATE-JOIN-SECRET',
      }),
    });
    expect(livePublish.status).toBe(200);
    const livePublishPayload = await livePublish.json();
    expect(livePublishPayload.session).toMatchObject({
      clubId: claimedMembership.clubId,
      studioRiderId: 'studio-maya',
      riderName: 'Maya Torres',
      athleteName: 'Maya Alexandria Torres (Rocket)',
      activityType: 'straight-sprint',
      status: 'active',
      progress: { fraction: 0.45, distanceMeters: 41.15, label: '145 ft sprint' },
      metrics: { watts: 1_100, participantCount: 4 },
      multiplayer: true,
    });
    expect(livePublishPayload.session).not.toHaveProperty('roomId');
    expect(livePublishPayload.session).not.toHaveProperty('_publisherProfileKey');
    expect(JSON.stringify(livePublishPayload)).not.toContain('PRIVATE-JOIN-SECRET');
    expect(JSON.stringify(livePublishPayload)).not.toContain('Forged rider name');

    cookie = ownerCookie;
    const ownerLiveSessions = await api('/api/club-live/sessions');
    const ownerLivePayload = await ownerLiveSessions.json();
    expect(ownerLivePayload.sessions).toHaveLength(1);
    expect(ownerLivePayload.sessions[0]).toMatchObject({
      studioRiderId: 'studio-maya',
      activityType: 'straight-sprint',
      multiplayer: true,
    });
    expect(JSON.stringify(ownerLivePayload)).not.toContain('PRIVATE-JOIN-SECRET');

    cookie = athleteCookie;
    const stoppedLiveSession = await api('/api/club-live/sessions', {
      method: 'DELETE',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
      }),
    });
    await expect(stoppedLiveSession.json()).resolves.toEqual({ stopped: true });
    const expiringPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        activityType: 'explore',
        status: 'active',
        progress: 0.2,
        metrics: { speedKph: 20, distanceMeters: 500 },
      }),
    });
    expect(expiringPublish.status).toBe(200);
    const passiveExpiryStart = primarySocket.messages.length;
    await new Promise((resolve) => setTimeout(resolve, 800));
    const passivelyDemotedState = await waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-state'
        && message.room?.id === multiplayerRoomId
        && message.room?.members?.find(
          (member: { id: string }) => member.id === primaryConnected.clientId,
        )?.roomRole === 'spectator',
      passiveExpiryStart,
    );
    expect(passivelyDemotedState.room).toMatchObject({
      hostId: null,
      racerCount: 0,
      racerSeatCount: 0,
    });
    expect(passivelyDemotedState.raceStates).toEqual([]);

    const expiredControlStart = primarySocket.messages.length;
    primarySocket.socket.send(JSON.stringify({
      type: 'room-vote-start',
      candidates: [1, 2, 3].map((index) => ({
        id: `expired-vote-track-${index}`,
        name: `Expired Track ${index}`,
        hasPedalZones: true,
      })),
    }));
    await expect(waitForSocketMessage(
      primarySocket,
      (message) => message.type === 'room-error'
        && String(message.message).includes('Only the room host'),
      expiredControlStart,
    )).resolves.toBeTruthy();

    const expiredAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    await expect(expiredAccess.json()).resolves.toMatchObject({ active: false, expiresAt: null });
    const expiredPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId: claimedMembership.clubId,
        studioRiderId: claimedMembership.studioRiderId,
        activityType: 'explore',
        status: 'active',
        progress: 0.3,
        metrics: { speedKph: 21, distanceMeters: 600 },
      }),
    });
    expect(expiredPublish.status).toBe(409);
    cookie = ownerCookie;
    const expiredMonitorSessions = await api('/api/club-live/sessions');
    await expect(expiredMonitorSessions.json()).resolves.toMatchObject({ sessions: [] });
    primarySocket.socket.close();
    duplicateSocket.socket.close();

    cookie = athleteCookie;
    const athleteClubHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const athleteClubHistoryPayload = await athleteClubHistory.json();
    expect(athleteClubHistoryPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId, club: expect.objectContaining({ role: 'athlete' }) }),
    ]));
    const athleteIdentityBeforePersonal = await api('/api/auth/me').then((response) => response.json());

    const athletePersonalSessionId = `athlete-personal-ride-${now}`;
    const athletePersonalSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        session: {
          id: athletePersonalSessionId,
          activityType: 'explore',
          title: 'Private home ride',
          startedAt: now - 700,
          endedAt: now - 100,
          durationMs: 600,
          distanceMeters: 1_000,
          details: { destinationLabel: 'Private destination' },
        },
      }),
    });
    expect(athletePersonalSave.status).toBe(201);
    const athleteIdentityAfterPersonal = await api('/api/auth/me').then((response) => response.json());
    expect(athleteIdentityAfterPersonal.user.id).toBe(athleteIdentityBeforePersonal.user.id);

    const athleteCombinedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const athleteCombinedPayload = await athleteCombinedHistory.json();
    expect(athleteCombinedPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId, club: expect.objectContaining({ role: 'athlete' }) }),
      expect.objectContaining({ id: athletePersonalSessionId }),
    ]));
    expect(athleteCombinedPayload.sessions.find((session: { id: string }) => session.id === athletePersonalSessionId)).not.toHaveProperty('club');

    const membership = await api('/api/auth/me');
    await expect(membership.json()).resolves.toMatchObject({
      user: { name: 'Maya Alexandria Torres (Rocket)', membership: { tier: 'spectator' } },
    });
    const athleteProfile = await api('/api/user-data');
    await expect(athleteProfile.json()).resolves.toMatchObject({
      accountProfile: { photoUrl: 'data:image/png;base64,aGVsbG8=' },
    });

    cookie = ownerCookie;
    const ownerUserData = await api('/api/user-data');
    expect(ownerUserData.status).toBe(200);
    await expect(ownerUserData.json()).resolves.toMatchObject({
      studioRiders: expect.arrayContaining([
        expect.objectContaining({ id: 'studio-maya', name: 'Maya Torres' }),
        expect.objectContaining({ id: 'studio-jordan', name: 'Jordan Lee' }),
      ]),
    });
    const connectedRoster = await api('/api/club-connect');
    await expect(connectedRoster.json()).resolves.toMatchObject({
      canManageClub: true,
      ownedClub: {
        members: [expect.objectContaining({
          studioRiderId: 'studio-maya',
          athleteName: 'Maya Alexandria Torres (Rocket)',
          status: 'claimed',
        })],
      },
    });

    const ownerCombinedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const ownerCombinedPayload = await ownerCombinedHistory.json();
    expect(ownerCombinedPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `club-owner:${claimedMembership.clubId}:studio-maya:${athleteClubSessionId}`,
        club: expect.objectContaining({ role: 'owner', riderName: 'Maya Torres' }),
      }),
    ]));
    expect(ownerCombinedPayload.sessions.some((session: { id: string }) => session.id.includes(athletePersonalSessionId))).toBe(false);

    const reusedClaim = await api('/api/club-connect/claim', {
      method: 'POST',
      body: JSON.stringify({ token: invite.token }),
    });
    expect(reusedClaim.status).toBe(409);

    const revoked = await api('/api/club-connect/revoke', {
      method: 'POST',
      body: JSON.stringify({ studioRiderId: 'studio-maya' }),
    });
    expect(revoked.status).toBe(200);

    cookie = athleteCookie;
    const revokedLiveAccess = await api(`/api/club-live/access?clubId=${claimedMembership.clubId}`);
    expect(revokedLiveAccess.status).toBe(403);
    const revokedHistory = await api(`/api/training-sessions?from=${now - 20_000}&to=${now}`);
    const revokedHistoryPayload = await revokedHistory.json();
    expect(revokedHistoryPayload.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: athleteClubSessionId }),
      expect.objectContaining({ id: athletePersonalSessionId }),
    ]));
    expect(revokedHistoryPayload.sessions.some((session: { id: string }) => session.id.startsWith('club:'))).toBe(false);

    const revokedClubSave = await api('/api/training-sessions', {
      method: 'POST',
      body: JSON.stringify({
        clubSession: {
          clubId: claimedMembership.clubId,
          studioRiderId: claimedMembership.studioRiderId,
        },
        session: {
          id: `revoked-club-session-${now}`,
          activityType: 'bmx-race',
          title: 'Revoked club session',
          startedAt: now - 500,
          endedAt: now - 50,
          durationMs: 450,
          distanceMeters: 100,
          details: {},
        },
      }),
    });
    expect(revokedClubSave.status).toBe(403);
  });

  it('caps a club live monitor at four independently active studio riders', async () => {
    const originalCookie = cookie;
    const ownerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'club-owner-admin@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(ownerLogin.status).toBe(200);
    const ownerCookie = String(ownerLogin.headers.get('set-cookie')).split(';')[0];
    cookie = ownerCookie;
    const now = Date.now();
    const riders = Array.from({ length: 5 }, (_value, index) => ({
      id: `live-cap-rider-${index + 1}`,
      name: `Live Cap Rider ${index + 1}`,
      createdAt: now + index,
      updatedAt: now + index,
    }));
    const rosterSave = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ studioRiders: riders }),
    });
    expect(rosterSave.status).toBe(200);

    const tokens = [];
    for (const rider of riders) {
      const inviteResponse = await api('/api/club-connect/invites', {
        method: 'POST',
        body: JSON.stringify({ studioRiderId: rider.id }),
      });
      expect(inviteResponse.status).toBe(201);
      tokens.push((await inviteResponse.json()).token);
    }

    cookie = secondaryCookie;
    for (let index = 0; index < tokens.length; index += 1) {
      const claimResponse = await api('/api/club-connect/claim', {
        method: 'POST',
        body: JSON.stringify({
          token: tokens[index],
          fullName: `Live Cap Athlete ${index + 1}`,
        }),
      });
      expect(claimResponse.status).toBe(200);
    }

    cookie = ownerCookie;
    const openedMonitor = await api('/api/club-live/sessions');
    expect(openedMonitor.status).toBe(200);
    const openedPayload = await openedMonitor.json();
    const clubId = openedPayload.club.id;

    cookie = secondaryCookie;
    for (const rider of riders.slice(0, 4)) {
      const publishResponse = await api('/api/club-live/sessions', {
        method: 'PUT',
        body: JSON.stringify({
          clubId,
          studioRiderId: rider.id,
          activityType: rider.id.endsWith('1') ? 'explore' : 'bmx-race',
          status: 'active',
          progress: 0.25,
          metrics: { watts: 600, cadence: 95, speedKph: 24 },
        }),
      });
      expect(publishResponse.status).toBe(200);
    }
    const fifthPublish = await api('/api/club-live/sessions', {
      method: 'PUT',
      body: JSON.stringify({
        clubId,
        studioRiderId: riders[4].id,
        activityType: 'straight-sprint',
        status: 'active',
        progress: 0.2,
        metrics: { watts: 700, cadence: 110, speedKph: 30 },
      }),
    });
    expect(fifthPublish.status).toBe(409);
    await expect(fifthPublish.json()).resolves.toEqual({
      error: 'This club already has four active riders on its live monitor.',
    });

    cookie = ownerCookie;
    const monitored = await api('/api/club-live/sessions');
    const monitoredPayload = await monitored.json();
    expect(monitoredPayload.sessions).toHaveLength(4);
    expect(monitoredPayload.sessions.map((session: { studioRiderId: string }) => session.studioRiderId))
      .toEqual(riders.slice(0, 4).map((rider) => rider.id));

    cookie = secondaryCookie;
    for (const rider of riders.slice(0, 4)) {
      const stopped = await api('/api/club-live/sessions', {
        method: 'DELETE',
        body: JSON.stringify({ clubId, studioRiderId: rider.id }),
      });
      expect(stopped.status).toBe(200);
    }
    cookie = originalCookie;
  });

  it('publishes one developer-locked camera view for every account and device', async () => {
    const nonAdminCookie = cookie;
    const forbidden = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: true,
          earthCamerasByTrack: {
            'north-bay-bmx': { angle: 10, heading: 20, zoom: 18, updatedAt: 100 },
          },
        },
      }),
    });
    expect(forbidden.status).toBe(403);

    const registration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Developer',
        email: 'global-view-admin@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(registration.status).toBe(201);
    cookie = String(registration.headers.get('set-cookie')).split(';')[0];

    const saved = await api('/api/global-race-view', {
      method: 'PATCH',
      body: JSON.stringify({
        raceViewPreferences: {
          cameraLocked: false,
          cameraLockedUpdatedAt: 700,
          earthCamerasByTrack: {
            'north-bay-bmx': {
              angle: 53,
              heading: 215,
              center: { lat: 38.2445, lng: -122.2825 },
              zoom: 20,
              updatedAt: 750,
            },
          },
          demoRiderNames: { 1: 'Must stay private' },
        },
      }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      raceViewPreferences: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 750,
        earthCamerasByTrack: {
          'north-bay-bmx': {
            angle: 53,
            heading: 215,
            zoom: 20,
            updatedAt: 750,
          },
        },
      },
    });

    cookie = '';
    const publicView = await api('/api/global-race-view');
    expect(publicView.status).toBe(200);
    const publicPayload = await publicView.json();
    expect(publicPayload.raceViewPreferences).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'north-bay-bmx': { angle: 53, heading: 215, zoom: 20 },
      },
    });
    expect(publicPayload.raceViewPreferences).not.toHaveProperty('demoRiderNames');
    cookie = nonAdminCookie;
  });

  it('prepares a truthful local pre-race briefing when hosted AI is unavailable', async () => {
    const response = await api('/api/commentary/pre-race', {
      method: 'POST',
      body: JSON.stringify({
        track: {
          id: 'north-bay-bmx',
          name: 'North Bay BMX',
          country: 'United States',
          countryCode: 'US',
          state: 'California',
          region: 'North America',
          city: 'Napa',
          surface: 'dirt',
          lengthMeters: 340,
          source: 'USA BMX',
          sourceUrl: 'https://www.usabmx.com/tracks/1946',
          zoneCount: 4,
          pedalZoneCount: 3,
          pedalMeters: 180,
          recoveryZoneCount: 1,
          recoveryMeters: 40,
          technicalZoneCount: 0,
          technicalMeters: 0,
          splitCount: 1,
          hasProSet: true,
          lapCount: 1,
          riders: [
            { playerId: 1, name: 'Maya Torres', colorName: 'lime' },
            { playerId: 2, name: 'Jordan Lee', colorName: 'blue' },
          ],
        },
        model: 'gpt-5.6-terra',
        voicePreset: 'american-man',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      line: expect.stringMatching(/Maya Torres and Jordan Lee.*North Bay BMX/),
      source: 'local',
      supportedVariableCount: 73,
      weather: { available: false },
      sources: [{
        title: 'USA BMX',
        url: 'https://www.usabmx.com/tracks/1946',
        kind: 'track',
      }],
    });
  });

  it('refuses to turn telemetry figures into spoken commentary', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery is holding 120 RPM and 35 KPH.',
        voicePreset: 'american-man',
        eventKind: 'final-push',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('refuses repetitive mapped-zone jargon in live race speech', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery attacks Pedal Zone 4.',
        voicePreset: 'american-man',
        eventKind: 'pedal-zone',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('refuses demeaning sarcasm about a racer', async () => {
    const response = await api('/api/commentary/speech', {
      method: 'POST',
      body: JSON.stringify({
        line: 'Avery is a pathetic rider who does not belong.',
        voicePreset: 'american-man',
        eventKind: 'pedal-zone',
        deliveryStyle: 'wry',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Commentary must use safe, natural race action without sensor figures, mapped-zone jargon, or demeaning rider remarks.',
    });
  });

  it('blocks spectator publication and forged billing completion', async () => {
    const publishing = await api('/api/public-track-mappings', {
      method: 'POST',
      body: JSON.stringify({ trackMappings: {} }),
    });
    expect(publishing.status).toBe(403);

    const billing = await api('/api/auth/billing-return', {
      method: 'POST',
      body: JSON.stringify({ billingState: 'forged-checkout-state' }),
    });
    expect(billing.status).toBe(400);
  });

  it('records idempotent 3D scene loads and restricts usage totals to administrators', async () => {
    const eventId = `3d-test-${Date.now()}`;
    const payload = JSON.stringify({
      eventId,
      trackId: 'north-bay-bmx-napa-valley',
      trackName: 'North Bay BMX - Napa Valley',
      context: 'edit',
    });
    const firstLoad = await api('/api/map-3d-loads', { method: 'POST', body: payload });
    const retriedLoad = await api('/api/map-3d-loads', { method: 'POST', body: payload });
    expect(firstLoad.status).toBe(201);
    expect(retriedLoad.status).toBe(201);

    const forbidden = await api('/api/admin/map-3d-usage');
    expect(forbidden.status).toBe(403);
    const appleForbidden = await api('/api/admin/apple-map-config');
    expect(appleForbidden.status).toBe(403);

    const regularCookie = cookie;
    const adminRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Operator',
        email: 'usage-admin@tracklab.test',
        password: 'admin-correct-horse-battery-staple',
      }),
    });
    expect(adminRegistration.status).toBe(201);
    cookie = String(adminRegistration.headers.get('set-cookie')).split(';')[0];

    try {
      const usageResponse = await api('/api/admin/map-3d-usage');
      expect(usageResponse.status).toBe(200);
      expect(usageResponse.headers.get('cache-control')).toBe('no-store');
      await expect(usageResponse.json()).resolves.toMatchObject({
        monthlyAllowance: 5000,
        thisMonth: { count: 1, remaining: 4999 },
        today: 1,
        lifetime: 1,
        byContext: [{ context: 'edit', count: 1 }],
        topTracks: [{
          trackId: 'north-bay-bmx-napa-valley',
          trackName: 'North Bay BMX - Napa Valley',
          count: 1,
        }],
      });
      const appleConfigResponse = await api('/api/admin/apple-map-config');
      expect(appleConfigResponse.status).toBe(200);
      expect(appleConfigResponse.headers.get('cache-control')).toBe('no-store');
      await expect(appleConfigResponse.json()).resolves.toEqual({
        configured: true,
        token: 'test-domain-restricted-mapkit-token',
      });
    } finally {
      cookie = regularCookie;
    }
  });

  it('restricts track mapping edits and publication to the developer account', async () => {
    const privateMapping = trackMapping('private-north-bay-map');
    const privateSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: privateMapping }),
    });
    expect(privateSave.status).toBe(403);
    await expect(privateSave.json()).resolves.toMatchObject({
      error: 'Only the TrackLab developer can edit track routes and pedal zones.',
    });

    const privateProfile = await api('/api/user-data');
    const privateProfilePayload = await privateProfile.json() as { trackMappings: Record<string, unknown> };
    expect(privateProfilePayload.trackMappings[privateMapping.trackId]).toBeUndefined();

    const genericMappingPatch = await api('/api/user-data', {
      method: 'PATCH',
      body: JSON.stringify({ trackMappings: { [privateMapping.trackId]: privateMapping } }),
    });
    expect(genericMappingPatch.status).toBe(403);

    const publicBeforeAdmin = await api('/api/public-track-mappings');
    const publicBeforePayload = await publicBeforeAdmin.json() as { trackMappings: Record<string, unknown> };
    expect(publicBeforePayload.trackMappings[privateMapping.trackId]).toBeUndefined();

    const adminRegistration = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'TrackLab Admin',
        email: 'admin-only@tracklab.test',
        password: 'correct-horse-battery-staple',
      }),
    });
    expect(adminRegistration.status).toBe(201);
    cookie = String(adminRegistration.headers.get('set-cookie')).split(';')[0];

    const sharedMapping = {
      ...trackMapping('shared-north-bay-map'),
      raceViewMode: '3d',
    };
    const sharedSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: sharedMapping }),
    });
    expect(sharedSave.status).toBe(200);
    await expect(sharedSave.json()).resolves.toMatchObject({
      mapping: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
      published: true,
      publicMapping: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
    });

    const publicAfterAdmin = await api('/api/public-track-mappings');
    await expect(publicAfterAdmin.json()).resolves.toMatchObject({
      trackMappings: {
        [sharedMapping.trackId]: { trackId: sharedMapping.trackId, raceViewMode: '3d' },
      },
    });

    const legacyGameMapping = {
      ...trackMapping('north-bay-bmx-napa-valley'),
      trackName: 'North Bay BMX - Napa Valley',
      raceViewMode: 'game',
      gameRoute: {
        id: 'amateur',
        name: 'Game Track',
        restAfterSeconds: 1,
        lengthMeters: 380,
        centerline: [{ lat: -0.0001, lng: 0.0002 }, { lat: -0.0004, lng: 0.001 }],
        startGate: { lat: -0.0001, lng: 0.0002 },
        finishLine: { lat: -0.0004, lng: 0.001 },
        zoneBoundaryMeters: [0, 45],
        zones: [{ id: 'game-pedal-1', name: 'Pedal Zone 1', startMeter: 0, endMeter: 45, type: 'pedal' }],
        splitSections: [],
      },
    };
    const gameSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: legacyGameMapping }),
    });
    expect(gameSave.status).toBe(200);
    await expect(gameSave.json()).resolves.toMatchObject({
      mapping: { trackId: legacyGameMapping.trackId, raceViewMode: 'satellite' },
      published: true,
      publicMapping: { trackId: legacyGameMapping.trackId, raceViewMode: 'satellite' },
    });

    const gameProfile = await api('/api/user-data');
    const gameProfilePayload = await gameProfile.json() as { trackMappings: Record<string, Record<string, unknown>> };
    expect(gameProfilePayload.trackMappings[legacyGameMapping.trackId]).toMatchObject({
      trackId: legacyGameMapping.trackId,
      raceViewMode: 'satellite',
    });
    expect(gameProfilePayload.trackMappings[legacyGameMapping.trackId].gameRoute).toBeUndefined();
    const publicAfterGameSave = await api('/api/public-track-mappings');
    const publicAfterGameSavePayload = await publicAfterGameSave.json() as { trackMappings: Record<string, Record<string, unknown>> };
    expect(publicAfterGameSavePayload.trackMappings[legacyGameMapping.trackId]).toMatchObject({
      trackId: legacyGameMapping.trackId,
      raceViewMode: 'satellite',
    });
    expect(publicAfterGameSavePayload.trackMappings[legacyGameMapping.trackId].gameRoute).toBeUndefined();

    const customTrack = customSprintTrack(`custom-drag-strip-${Date.now()}`);
    const customMapping = {
      ...trackMapping(customTrack.id),
      trackName: customTrack.name,
      country: customTrack.country,
      state: customTrack.state,
      lengthMeters: customTrack.lengthMeters,
    };
    const customSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: customMapping, track: customTrack }),
    });
    expect(customSave.status).toBe(200);
    await expect(customSave.json()).resolves.toMatchObject({
      mapping: { trackId: customTrack.id },
      published: true,
      publicMapping: { trackId: customTrack.id },
      publicCustomRoute: {
        id: customTrack.id,
        name: 'Drag Strip',
        state: 'New Hampshire',
        address: 'Drag Strip, Epping, NH 03042, USA',
      },
    });

    const publicCustomRoutes = await api('/api/public-custom-routes');
    await expect(publicCustomRoutes.json()).resolves.toMatchObject({
      customRoutes: [{ id: customTrack.id, name: 'Drag Strip', state: 'New Hampshire' }],
      count: 1,
    });

    const previewTrack = customSprintTrack(`custom-preview-drag-strip-${Date.now()}`);
    const permanentPreviewTrackId = previewTrack.id.replace('custom-preview-', 'custom-');
    const previewMapping = {
      ...trackMapping(previewTrack.id),
      trackName: previewTrack.name,
      country: previewTrack.country,
      state: previewTrack.state,
      lengthMeters: previewTrack.lengthMeters,
    };
    const previewSave = await api('/api/user-data/track-mapping', {
      method: 'POST',
      body: JSON.stringify({ mapping: previewMapping, track: previewTrack }),
    });
    expect(previewSave.status).toBe(200);
    await expect(previewSave.json()).resolves.toMatchObject({
      mapping: { trackId: permanentPreviewTrackId },
      published: true,
      publicMapping: { trackId: permanentPreviewTrackId },
      publicCustomRoute: { id: permanentPreviewTrackId, name: 'Drag Strip' },
    });

    const publicAfterPreviewRecovery = await api('/api/public-track-mappings');
    const publicAfterPreviewPayload = await publicAfterPreviewRecovery.json() as {
      customRoutes: Array<{ id: string }>;
      trackMappings: Record<string, unknown>;
    };
    expect(publicAfterPreviewPayload.trackMappings[permanentPreviewTrackId]).toBeDefined();
    expect(publicAfterPreviewPayload.trackMappings[previewTrack.id]).toBeUndefined();
    expect(publicAfterPreviewPayload.customRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: permanentPreviewTrackId }),
    ]));
  });

  it('rejects cross-site mutations and does not cache mutable manifests immutably', async () => {
    const crossSite = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(crossSite.status).toBe(403);

    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns actionable client errors for malformed and oversized JSON', async () => {
    const malformed = await api('/api/auth/login', {
      method: 'POST',
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: 'Request body must be valid JSON.' });

    const oversized = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'rider@tracklab.test', password: 'x'.repeat(33_000) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ error: 'Request body is too large.' });
  });
});
