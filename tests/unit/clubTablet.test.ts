import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimClubTabletPickerWattbikeCapacity,
  clearClubTabletBikePresence,
  clearStoredClubTabletSession,
  clubTabletOutboxStorageKey,
  clubTabletResultUploadHeader,
  endClubTabletSession,
  flushClubTabletOutbox,
  normalizeClubTabletDeviceCredential,
  normalizeClubTabletRoster,
  normalizeClubTabletSessionCredential,
  publishClubTabletBikePresence,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  releaseClubTabletPickerWattbikeCapacity,
  saveClubTabletRaceResult,
  startClubTabletSession,
  storeClubTabletDevice,
  storeClubTabletSession,
  validateClubTabletSessionCapacity,
  type ClubTabletDeviceCredential,
  type ClubTabletSessionCredential,
} from '../../src/lib/clubTablet';
import {
  clubTabletBikeAccessReady,
  clubTabletFreshHeartRateReading,
  clubTabletShouldAutoStartSelection,
} from '../../src/components/ClubTabletMode';
import { expireClubTabletSessionLocallyFirst } from '../../src/components/ClubTabletRuntime';
import { safelyReleaseCompletedClubTabletSession } from '../../src/lib/clubTabletExerciseCompletion';
import type { HeartRateLiveEvent } from '../../src/lib/heartRateCloud';
import { clubTabletRaceStartAllowed } from '../../src/lib/clubTabletRaceStart';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const deviceCredential: ClubTabletDeviceCredential = {
  device: {
    id: 'tablet-1',
    name: 'Front desk iPad',
    clubId: 'club-1',
    clubName: 'Preski Ranch',
  },
  deviceToken: 'device-token',
};

const sessionCredential: ClubTabletSessionCredential = {
  deviceId: 'tablet-1',
  sessionToken: 'athlete-session-token',
  session: {
    clubId: 'club-1',
    clubName: 'Preski Ranch',
    studioRiderId: 'rider-1',
    riderName: 'Rider One',
    bikeDeviceId: 733_112,
    expiresAt: Date.now() + 60_000,
  },
  heartbeatTtlMs: 60_000,
  pollAfterMs: 15_000,
};

const durableSessionCredential: ClubTabletSessionCredential = {
  ...sessionCredential,
  resultUploadToken: 'result-upload-token-rider-1',
  resultUploadExpiresAt: Date.now() + 14 * 24 * 60 * 60 * 1_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Club Tablet client state', () => {
  it('requires an explicit rider start on independent Club Tablet activities', () => {
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: false,
      source: 'manual',
    })).toBe(false);
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: false,
      source: 'room-clock',
    })).toBe(false);
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: false,
      source: 'club-tablet-control',
    })).toBe(true);
  });

  it('preserves account starts and synchronized Club Event starts', () => {
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: false,
      roomClockAuthorized: false,
      source: 'manual',
    })).toBe(true);
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: true,
      source: 'room-clock',
    })).toBe(true);
  });

  it('preserves validated ordinary multiplayer room-clock starts on Club Tablets', () => {
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: true,
      source: 'room-clock',
    })).toBe(true);
    expect(clubTabletRaceStartAllowed({
      clubTabletKioskMode: true,
      roomClockAuthorized: false,
      source: 'room-clock',
    })).toBe(false);
  });

  it('keeps the roster upsert compatible with the production club_members schema', () => {
    const persistenceSource = readFileSync(
      new URL('../../cloud/persistence.mjs', import.meta.url),
      'utf8',
    );
    const upsertStart = persistenceSource.indexOf('export async function ensureClubRosterMember');
    const upsertEnd = persistenceSource.indexOf('export async function saveClubInvite', upsertStart);
    const upsertSource = persistenceSource.slice(upsertStart, upsertEnd);

    expect(upsertStart).toBeGreaterThanOrEqual(0);
    expect(upsertEnd).toBeGreaterThan(upsertStart);
    expect(upsertSource).toContain('athlete_profile_key = CASE');
    expect(upsertSource).toContain("WHEN existing.revoked_at IS NOT NULL THEN 'unclaimed'");
    expect(upsertSource).not.toContain('athlete_name =');
    expect(persistenceSource).toContain('users.display_name AS athlete_name');
  });

  it('leaves enrollment verification to the runtime and starts kiosk sign-out only once', () => {
    const modeSource = readFileSync(
      new URL('../../src/components/ClubTabletMode.tsx', import.meta.url),
      'utf8',
    );
    const authorizeStart = modeSource.indexOf('const authorizeTablet = async () =>');
    const authorizeEnd = modeSource.indexOf('const openIndependentProgram = useCallback(', authorizeStart);
    const authorizeSource = modeSource.slice(authorizeStart, authorizeEnd);
    expect(authorizeStart).toBeGreaterThanOrEqual(0);
    expect(authorizeEnd).toBeGreaterThan(authorizeStart);
    expect(authorizeSource).toContain('onDeviceChange(credential)');
    expect(authorizeSource).toContain('clearNativePushAccountBoundary()');
    expect(authorizeSource.indexOf('clearNativePushAccountBoundary()'))
      .toBeLessThan(authorizeSource.indexOf('onDeviceChange(credential)'));
    expect(authorizeSource).not.toContain('loadClubTabletRoster(');
    expect(authorizeSource).not.toContain('onRosterChange(');

    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('const clubTabletAutoSignOutStartedRef = useRef(false);');
    const guardStart = appSource.indexOf('if (!clubTabletKioskMode) {', appSource.indexOf('const handleSignOut'));
    const guardEnd = appSource.indexOf('}, [authUser, clubTabletKioskMode, handleSignOut]);', guardStart);
    const guardSource = appSource.slice(guardStart, guardEnd);
    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(guardSource).toContain('clubTabletAutoSignOutStartedRef.current = false;');
    expect(guardSource).toContain('if (!authUser || clubTabletAutoSignOutStartedRef.current) return;');
    expect(guardSource).toContain('clubTabletAutoSignOutStartedRef.current = true;');
    expect(guardSource.indexOf('clubTabletAutoSignOutStartedRef.current = true;'))
      .toBeLessThan(guardSource.indexOf('void handleSignOut()'));
  });

  it('primes club-tablet race audio inside the rider gesture before any coach-event request', () => {
    const eventSource = readFileSync(
      new URL('../../src/components/ClubTabletEventCard.tsx', import.meta.url),
      'utf8',
    );
    const readyStart = eventSource.indexOf('const ready = async () =>');
    const readyEnd = eventSource.indexOf('const leave = async () =>', readyStart);
    const readySource = eventSource.slice(readyStart, readyEnd);
    expect(readyStart).toBeGreaterThanOrEqual(0);
    expect(readyEnd).toBeGreaterThan(readyStart);
    expect(readySource).toContain('void onPrimeAudio?.()');
    expect(readySource.indexOf('void onPrimeAudio?.()'))
      .toBeLessThan(readySource.indexOf('await onReady('));

    const modeSource = readFileSync(
      new URL('../../src/components/ClubTabletMode.tsx', import.meta.url),
      'utf8',
    );
    const programStart = modeSource.indexOf('const chooseProgram = (program: ClubTabletProgram) =>');
    const programEnd = modeSource.indexOf('useEffect(() => {', programStart);
    const programSource = modeSource.slice(programStart, programEnd);
    expect(programSource).toContain('void onPrimeAudio?.()');
    expect(programSource.indexOf('void onPrimeAudio?.()'))
      .toBeLessThan(programSource.indexOf('openIndependentProgram(program)'));

    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const kioskStart = appSource.indexOf('<ClubTabletMode');
    const kioskEnd = appSource.indexOf('/>', kioskStart);
    const kioskSource = appSource.slice(kioskStart, kioskEnd);
    expect(kioskSource).toContain('onPrimeAudio={() => Promise.allSettled([');
    expect(kioskSource).toContain('primeRaceAudio()');
    expect(kioskSource).toContain('primeBikeRaceAudio()');
  });

  it('keeps Wattbike pairing locked until server authorization is active', () => {
    expect(clubTabletBikeAccessReady('checking', false)).toBe(false);
    expect(clubTabletBikeAccessReady('error', false)).toBe(false);
    expect(clubTabletBikeAccessReady('revoked', false)).toBe(false);
    expect(clubTabletBikeAccessReady('active', false)).toBe(false);
    expect(clubTabletBikeAccessReady('active', true)).toBe(true);
  });

  it('automatically starts once a late saved-bike reconnect completes both selections', () => {
    const base = {
      hasActiveSession: false,
      demoActive: false,
      startPending: false,
      startFailed: false,
      selectedRiderId: 'rider-1',
      selectedProgram: 'straight-sprint' as const,
      selectedBikeId: null,
      coachEventLocked: false,
    };
    expect(clubTabletShouldAutoStartSelection(base)).toBe(false);
    expect(clubTabletShouldAutoStartSelection({ ...base, selectedBikeId: 733_112 })).toBe(true);
    expect(clubTabletShouldAutoStartSelection({
      ...base,
      demoActive: true,
      selectedBikeId: 733_112,
    })).toBe(false);
    expect(clubTabletShouldAutoStartSelection({
      ...base,
      selectedBikeId: 733_112,
      coachEventLocked: true,
    })).toBe(false);
  });

  it('normalizes only safe devices and approved claimed or unclaimed roster athletes', () => {
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      deviceToken: `  ${deviceCredential.deviceToken}  `,
    })).toEqual(deviceCredential);

    const presenceNow = Date.now();
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      device: {
        ...deviceCredential.device,
        connectedBike: {
          deviceId: 733_112,
          label: 'WattbikePM250733112',
          updatedAt: presenceNow,
          expiresAt: presenceNow + 15_000,
          privateBrowserId: 'must-not-survive',
        },
      },
    })).toMatchObject({
      device: {
        connectedBike: {
          deviceId: 733_112,
          label: 'WattbikePM250733112',
          updatedAt: presenceNow,
          expiresAt: presenceNow + 15_000,
        },
      },
    });
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      device: {
        ...deviceCredential.device,
        connectedBike: {
          deviceId: 733_112,
          label: 'WattbikePM250733112',
          updatedAt: presenceNow,
          expiresAt: presenceNow,
        },
      },
    })?.device).not.toHaveProperty('connectedBike');

    const normalizedRoster = normalizeClubTabletRoster({
      device: deviceCredential.device,
      athletes: [
        {
          studioRiderId: 'rider-2',
          riderName: 'Zoey',
          claimed: true,
          watchConnect: {
            recognized: true,
            state: 'connected',
            connectedUntil: Date.now() + 60_000,
            remainingMs: 60_000,
            liveSharingEnabled: true,
          },
        },
        { studioRiderId: 'rider-1', riderName: 'Alex', claimed: false },
        { studioRiderId: '', riderName: 'Invalid' },
      ],
      racePresentation: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 750,
        earthCamerasByTrack: {
          'chula-vista-elite-bmx': {
            angle: 47,
            heading: 180,
            zoom: 20.78,
            referenceViewport: { width: 1366, height: 1024 },
            updatedAt: 750,
          },
        },
        riderOverlaysByTrack: {
          'chula-vista-elite-bmx': {
            xPct: 0.02,
            yPct: 0.76,
            width: 1240,
            height: 210,
            locked: true,
            referenceViewport: { width: 1366, height: 1024 },
          },
        },
        riderOverlayUpdatedAtByTrack: { 'chula-vista-elite-bmx': 760 },
        demoRiderNames: { 1: 'Must stay private' },
        demoRiderPhotos: { 1: 'data:image/png;base64,aGVsbG8=' },
        commentary: { recentLines: ['Must stay private'] },
      },
    });
    expect(normalizedRoster?.athletes).toEqual([
      expect.objectContaining({ studioRiderId: 'rider-1', riderName: 'Alex', status: 'unclaimed' }),
      expect.objectContaining({
        studioRiderId: 'rider-2',
        riderName: 'Zoey',
        status: 'claimed',
        watchConnect: expect.objectContaining({
          recognized: true,
          state: 'connected',
          liveSharingEnabled: true,
        }),
      }),
    ]);
    expect(normalizedRoster?.racePresentation).toMatchObject({
      cameraLocked: true,
      earthCamerasByTrack: {
        'chula-vista-elite-bmx': expect.objectContaining({ angle: 47, heading: 180, zoom: 20.78 }),
      },
      riderOverlaysByTrack: {
        'chula-vista-elite-bmx': expect.objectContaining({ width: 1240, height: 210, locked: true }),
      },
    });
    expect(normalizedRoster?.racePresentation).not.toHaveProperty('demoRiderNames');
    expect(normalizedRoster?.racePresentation).not.toHaveProperty('demoRiderPhotos');
    expect(normalizedRoster?.racePresentation).not.toHaveProperty('commentary');

    const overlayOnlyRoster = normalizeClubTabletRoster({
      device: deviceCredential.device,
      athletes: [],
      racePresentation: {
        cameraLocked: true,
        cameraLockedUpdatedAt: 0,
        earthCamerasByTrack: {},
        riderOverlaysByTrack: {
          'overlay-only-track': {
            xPct: 0.08,
            yPct: 0.68,
            width: 980,
            height: 205,
            locked: true,
            referenceViewport: { width: 1366, height: 1024 },
          },
        },
        riderOverlayUpdatedAtByTrack: { 'overlay-only-track': 810 },
      },
    });
    expect(overlayOnlyRoster?.racePresentation).toMatchObject({
      earthCamerasByTrack: {},
      riderOverlaysByTrack: {
        'overlay-only-track': expect.objectContaining({
          width: 980,
          height: 205,
          locked: true,
        }),
      },
      riderOverlayUpdatedAtByTrack: { 'overlay-only-track': 810 },
    });
  });

  it('publishes and clears connected-bike presence with only the enrolled tablet credential', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await publishClubTabletBikePresence({
      deviceId: 733_112,
      label: '  WattbikePM250733112  ',
    }, deviceCredential);
    await clearClubTabletBikePresence(deviceCredential, { keepalive: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/club-tablet/bike-presence', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
      body: JSON.stringify({ bikeDeviceId: 733_112, bikeLabel: 'WattbikePM250733112' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/club-tablet/bike-presence', expect.objectContaining({
      method: 'DELETE',
      keepalive: true,
      headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('clubId');
  });

  it('claims and releases only the enrolled picker\'s one short-lived Wattbike grant', async () => {
    const now = Date.now();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        capacity: {
          type: 'wattbike-capacity',
          requestedConnections: 1,
          grantedConnections: 1,
          connectionLimit: 4,
          accountConnectionsInUse: 2,
          action: 'none',
          reason: 'club-tablet-picker-reserved',
        },
        expiresAt: now + 45_000,
        pollAfterMs: 15_000,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ released: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(claimClubTabletPickerWattbikeCapacity(deviceCredential)).resolves.toMatchObject({
      capacity: {
        requestedConnections: 1,
        grantedConnections: 1,
        reason: 'club-tablet-picker-reserved',
      },
      expiresAt: now + 45_000,
      pollAfterMs: 15_000,
    });
    await expect(releaseClubTabletPickerWattbikeCapacity(
      deviceCredential,
      { keepalive: true },
    )).resolves.toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/club-tablet/wattbike-capacity', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
    }));
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/club-tablet/wattbike-capacity', expect.objectContaining({
      method: 'DELETE',
      keepalive: true,
      headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
    }));
  });

  it('rejects a picker response that attempts to grant more than one Wattbike', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      capacity: {
        type: 'wattbike-capacity',
        requestedConnections: 2,
        grantedConnections: 2,
        connectionLimit: 4,
        accountConnectionsInUse: 2,
        action: 'none',
        reason: 'invalid-picker-grant',
      },
      expiresAt: Date.now() + 45_000,
      pollAfterMs: 15_000,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(claimClubTabletPickerWattbikeCapacity(deviceCredential))
      .rejects.toThrow('invalid Club Tablet Wattbike authorization');
  });

  it('preserves durable result credentials while accepting old stored athlete sessions', () => {
    expect(normalizeClubTabletSessionCredential(durableSessionCredential)).toMatchObject(durableSessionCredential);
    expect(normalizeClubTabletSessionCredential(sessionCredential)).toMatchObject(sessionCredential);
    expect(normalizeClubTabletSessionCredential({
      ...sessionCredential,
      resultUploadToken: 'token-without-expiry',
    })).toMatchObject(sessionCredential);
    expect(normalizeClubTabletSessionCredential({
      ...sessionCredential,
      resultUploadToken: 'token-without-expiry',
    })).not.toHaveProperty('resultUploadToken');

    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    expect(readStoredClubTabletSession()).toMatchObject(sessionCredential);
    storeClubTabletSession(durableSessionCredential);
    expect(readStoredClubTabletSession()).toMatchObject(durableSessionCredential);
  });

  it('clears athlete identity without erasing the tablet or saved bike authorization', () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });

    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    clearStoredClubTabletSession();

    expect(readStoredClubTabletSession()).toBeNull();
    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
  });

  it('does not let athlete A finishing late clear athlete B', async () => {
    const athleteA = sessionCredential;
    const athleteB: ClubTabletSessionCredential = {
      ...sessionCredential,
      sessionToken: 'athlete-session-token-b',
      session: {
        ...sessionCredential.session,
        studioRiderId: 'rider-2',
        riderName: 'Rider Two',
      },
    };
    let currentSession: ClubTabletSessionCredential | null = athleteB;
    const endCompletedSession = vi.fn(async () => undefined);

    await safelyReleaseCompletedClubTabletSession({
      completedSession: athleteA,
      currentSession: () => currentSession,
      clearCurrentSession: () => { currentSession = null; },
      endCompletedSession,
    });

    expect(currentSession).toBe(athleteB);
    expect(endCompletedSession).toHaveBeenCalledWith(athleteA);
  });

  it('does not let a delayed athlete A sign-out erase athlete B on the same tablet', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    let finishDelete: ((response: Response) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      finishDelete = resolve;
    })));

    const ending = endClubTabletSession(sessionCredential);
    clearStoredClubTabletSession();
    const athleteB: ClubTabletSessionCredential = {
      ...sessionCredential,
      sessionToken: 'athlete-session-token-b',
      session: {
        ...sessionCredential.session,
        studioRiderId: 'rider-2',
        riderName: 'Rider Two',
      },
    };
    storeClubTabletSession(athleteB);
    finishDelete?.(new Response(JSON.stringify({ stopped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await ending;
    expect(readStoredClubTabletSession()).toMatchObject(athleteB);
  });

  it('clears an idle athlete and BPM before a stalled remote stop', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    const events: string[] = [];
    let finishRemote: (() => void) | null = null;
    const remoteFinished = new Promise<void>((resolve) => { finishRemote = resolve; });

    expireClubTabletSessionLocallyFirst(
      sessionCredential,
      () => events.push('session-cleared'),
      (reading) => events.push(reading == null ? 'bpm-cleared' : 'unexpected-reading'),
      async () => {
        events.push('remote-started');
        await remoteFinished;
        events.push('remote-finished');
      },
    );

    expect(readStoredClubTabletSession()).toBeNull();
    expect(events).toEqual(['bpm-cleared', 'session-cleared', 'remote-started']);
    finishRemote?.();
    await vi.waitFor(() => expect(events).toContain('remote-finished'));
  });

  it('expires a cached tablet BPM at the exact ten-second boundary', () => {
    const reading: HeartRateLiveEvent = {
      streamId: 'club-tablet-live',
      sessionId: 'club-tablet-athlete-session',
      relayScope: 'studio-block',
      riderId: 'studio-rider-1',
      studioRiderId: 'studio-rider-1',
      playerId: null,
      bpm: 155,
      recordedAt: 1_000,
      receivedAt: 1_000,
      freshUntil: 11_000,
      activeElapsedMs: null,
    };

    expect(clubTabletFreshHeartRateReading(reading, 10_999)).toBe(reading);
    expect(clubTabletFreshHeartRateReading(reading, 11_000)).toBeNull();
    expect(clubTabletFreshHeartRateReading({ ...reading, freshUntil: 11_001 }, 2_000)).toBeNull();
  });

  it('sends the connected Wattbike identifier as an opaque server ID and keeps it numeric locally', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ studioRiderId: 'rider-1', bikeDeviceId: '733112' });
      return new Response(JSON.stringify(durableSessionCredential), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startClubTabletSession('rider-1', 733_112)).resolves.toMatchObject({
      resultUploadToken: durableSessionCredential.resultUploadToken,
      resultUploadExpiresAt: durableSessionCredential.resultUploadExpiresAt,
      session: { bikeDeviceId: 733_112 },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/club-tablet/sessions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer device-token' }),
    }));
  });

  it('rejects a short-lived athlete session copied from another enrolled tablet', () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession({ ...sessionCredential, deviceId: 'tablet-other' });

    expect(readStoredClubTabletSession()).toBeNull();
    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
  });

  it('revalidates tablet Wattbike capacity without renewing the athlete session', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      session: sessionCredential.session,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateClubTabletSessionCapacity(sessionCredential)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/club-tablet/sessions', expect.objectContaining({
      headers: expect.objectContaining({
        'X-TrackLab-Club-Tablet-Session': 'athlete-session-token',
      }),
    }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/club-tablet/sessions/current', expect.anything());
  });

  it('keeps a failed race artifact in a selected-athlete outbox and retries it safely', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const result = {
      sessionId: 'race-1',
      trackId: 'track-1',
      trackName: 'Test Track',
      summaries: [{ playerId: 1 }],
      localPlayerId: 1,
    };

    await expect(saveClubTabletRaceResult(result, sessionCredential)).resolves.toBeUndefined();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('race-1');
    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toBeNull();
    await expect(flushClubTabletOutbox(sessionCredential)).resolves.toBe(1);
    await expect(flushClubTabletOutbox(sessionCredential)).resolves.toBe(0);
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('quarantines a legacy metric spike without blocking the next valid tablet upload', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    const common = {
      kind: 'race',
      deviceId: sessionCredential.deviceId,
      clubId: sessionCredential.session.clubId,
      studioRiderId: sessionCredential.session.studioRiderId,
      createdAt: Date.now(),
      attempts: 0,
    };
    sessionStorage.setItem(clubTabletOutboxStorageKey, JSON.stringify([{
      ...common,
      id: 'legacy-spike',
      payload: { summaries: [{ playerId: 1, topCadence: 923_334, topSpeedKph: 151_080.1 }] },
    }, {
      ...common,
      id: 'valid-race',
      payload: { summaries: [{ playerId: 1, topCadence: 200, topSpeedKph: 83 }] },
    }]));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushClubTabletOutbox(sessionCredential)).resolves.toBe(1);
    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toBeNull();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"topCadence":200');
  });

  it('keeps a durably queued artifact after visible sign-out so it can retry', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(sessionCredential);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(saveClubTabletRaceResult({
      sessionId: 'race-private',
      trackId: 'track-private',
      trackName: 'Private athlete track',
      summaries: [{ playerId: 1, watts: 1234 }],
      localPlayerId: 1,
    }, sessionCredential)).resolves.toBeUndefined();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('race-private');

    clearStoredClubTabletSession();

    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('race-private');
    expect(readStoredClubTabletSession()).toBeNull();
    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
  });

  it('uses the durable result credential after a 401 and release without blocking the next athlete', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    storeClubTabletSession(durableSessionCredential);
    const athleteB: ClubTabletSessionCredential = {
      ...durableSessionCredential,
      sessionToken: 'athlete-session-token-b',
      resultUploadToken: 'result-upload-token-rider-2',
      session: {
        ...durableSessionCredential.session,
        studioRiderId: 'rider-2',
        riderName: 'Rider Two',
      },
    };
    let raceRequestCount = 0;
    let resolveDurableRetry: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/club-tablet/race-results') {
        raceRequestCount += 1;
        if (raceRequestCount === 1) return new Response(JSON.stringify({ error: 'expired session' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
        return new Promise<Response>((resolve) => {
          resolveDurableRetry = resolve;
        });
      }
      if (path === '/api/club-tablet/sessions' && init?.method === 'POST') {
        return new Response(JSON.stringify(athleteB), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ stopped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await saveClubTabletRaceResult({
      sessionId: 'race-deferred-release',
      trackId: 'track-1',
      trackName: 'Track One',
      summaries: [{ playerId: 1, watts: 800 }],
      localPlayerId: 1,
    }, durableSessionCredential);
    await endClubTabletSession(durableSessionCredential);

    expect(readStoredClubTabletSession()).toBeNull();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('"releaseAfterFlush":true');
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('"resultUploadToken":"result-upload-token-rider-1"');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const startingNextAthlete = startClubTabletSession('rider-2', 733_112);
    await vi.waitFor(() => expect(raceRequestCount).toBe(2));
    await expect(startingNextAthlete).resolves.toMatchObject({
      sessionToken: athleteB.sessionToken,
      session: { studioRiderId: 'rider-2' },
    });
    expect(readStoredClubTabletSession()).toMatchObject({
      sessionToken: athleteB.sessionToken,
      session: { studioRiderId: 'rider-2' },
    });

    const retryCall = fetchMock.mock.calls.findLast(([input]) => (
      String(input) === '/api/club-tablet/race-results'
    ));
    const retryHeaders = new Headers(retryCall?.[1]?.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer device-token');
    expect(retryHeaders.get(clubTabletResultUploadHeader)).toBe('result-upload-token-rider-1');

    resolveDurableRetry?.(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await flushClubTabletOutbox();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toBe('[]');
  });

  it('retries a room race token until the latest start handler accepts it', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const handlerAssignment = appSource.indexOf("roomRaceStartHandlerRef.current = (authority) => handleStart('room-clock', authority);");
    const effectStart = appSource.indexOf("const roomFlow = multiplayer.currentRoom?.flow;", handlerAssignment);
    const effectEnd = appSource.indexOf("const nativeBluetoothFailed", effectStart);
    const effectSource = appSource.slice(effectStart, effectEnd);

    expect(effectStart).toBeGreaterThanOrEqual(0);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(handlerAssignment).toBeGreaterThanOrEqual(0);
    expect(effectSource).toContain('started = await roomRaceStartHandlerRef.current(roomAuthority);');
    expect(effectSource).toContain('lastRoomRaceTokenRef.current = raceToken;');
    expect(effectSource.indexOf('started = await roomRaceStartHandlerRef.current(roomAuthority);'))
      .toBeLessThan(effectSource.indexOf('lastRoomRaceTokenRef.current = raceToken;'));
    expect(effectSource).toContain('}, 250);');
  });

  it('lets only the synchronized room clock start an active coach-led race', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const multiplayerSource = readFileSync(new URL('../../src/hooks/useMultiplayer.ts', import.meta.url), 'utf8');
    const startHandler = appSource.slice(
      appSource.indexOf('const handleStart = async ('),
      appSource.indexOf('// The server-clock timer must call the newest render', appSource.indexOf('const handleStart = async')),
    );
    expect(startHandler).toContain("if (clubEventConfigurationLocked && source !== 'room-clock') return false;");
    expect(startHandler).toContain('return await scheduleClubEventGate(startingTrackId, sequenceId, roomAuthority);');
    expect(appSource).toContain("roomRaceStartHandlerRef.current = (authority) => handleStart('room-clock', authority);");
    expect(appSource).toContain('(clubEventLaunch != null && multiplayer.latency.measuredAt == null)');
    expect(appSource).toContain('cadenceStartedAtRef.current = plan.cadenceLocalAt;');
    expect(appSource).toContain('// Stop any slow/stale cadence media before every coalesced red phase;');
    expect(appSource).toContain('stopStartGateAudio();');
    const synchronizedGreenHandler = appSource.slice(
      appSource.indexOf('onGreen: (gateDropLocalAt, playTone) => {'),
      appSource.indexOf('beginRaceAtGateDrop(startingTrackId, sequenceId, gateDropLocalAt);') + 80,
    );
    expect(synchronizedGreenHandler).toContain('stopStartGateAudio();');
    expect(synchronizedGreenHandler.indexOf('stopStartGateAudio();'))
      .toBeLessThan(synchronizedGreenHandler.indexOf("playStartGateTone('uci-green')"));
    expect(appSource).toContain("if (roomPhase == null || roomPhase === 'race')");
    expect(appSource).toContain('multiplayer.roomExit.sequence > activeClubEventGateRoomExitSequenceRef.current');
    expect(appSource).toContain('|| latestRoomExitSequenceRef.current !== roomExitSequence');
    expect(appSource.indexOf('const roomExitSequence = latestRoomExitSequenceRef.current;'))
      .toBeLessThan(appSource.indexOf("await import('./lib/clubEventGateTimeline')"));
    expect(appSource).toContain('synchronizedFalseStartPlayerIdsRef.current.add(detection.playerId);');
    expect(appSource).toContain('setSynchronizedFalseStartPlayerIds((current) => (');
    expect(appSource).toContain('(summary) => !synchronizedFalseStartPlayerIdSet.has(summary.playerId)');
    expect(appSource).toContain('.map((summary, index) => ({ ...summary, rank: index + 1 }))');
    expect(appSource).toContain('disqualifiedPlayerIds={synchronizedFalseStartPlayerIds}');
    expect(appSource).toContain('players: commentaryRacePlayers,');
    expect(appSource).toContain('riders: commentaryRiders,');
    expect(appSource).toContain('newPersonalRecordsByPlayer: commentaryPersonalRecordsByPlayer,');
    expect(appSource).toContain('!synchronizedFalseStartPlayerIdSet.has(rider.playerId)');
    expect(appSource).toContain('.map((rider, index) => ({ ...rider, rank: index + 1 }))');
    const personalRecordDerivation = appSource.slice(
      appSource.indexOf('const newPersonalRecordsByPlayer = useMemo'),
      appSource.indexOf('const commentaryRacePlayers = useMemo'),
    );
    expect(personalRecordDerivation).toContain(
      '.filter((rider) => !synchronizedFalseStartPlayerIdSet.has(rider.playerId))',
    );
    const falseStartReaction = appSource.slice(
      appSource.indexOf('if (synchronizedFalseStartPlayerIdsRef.current.has(player.id))'),
      appSource.indexOf('const sample = samplesByDevice.get(player.deviceId);'),
    );
    expect(falseStartReaction).not.toContain('next[player.id] = 0');
    const eventCancellation = appSource.slice(
      appSource.indexOf('const cancelActiveClubEventGateAndRace = useCallback'),
      appSource.indexOf('useEffect(() => {', appSource.indexOf('const cancelActiveClubEventGateAndRace = useCallback')),
    );
    expect(eventCancellation).toContain("status: 'cancelled'");
    expect(eventCancellation).toContain('resetRace();');
    expect(eventCancellation).toContain("bridge.sendControlCommand('race-reset')");
    expect(eventCancellation).toContain("const preserveCompletedResults = raceState === 'finished';");
    expect(eventCancellation).toContain('clearStartGateSequence(preserveCompletedResults);');
    const completedResultCleanup = appSource.slice(
      appSource.indexOf('const clearStartGateSequence = useCallback'),
      appSource.indexOf('const cancelActiveClubEventGateAndRace = useCallback'),
    );
    expect(completedResultCleanup).toContain('if (!preserveCompletedResults) {');
    expect(completedResultCleanup).toContain('setReactionTimesByPlayer({});');
    expect(appSource).toContain("'Race finished / false-start disqualification captured'");
    expect(appSource).toContain('!synchronizedFalseStartPlayerIdSet.has(tabletLocalPlayer.id)');
    expect(appSource).not.toContain('clubTabletExerciseSavedRef');
    const explicitExit = multiplayerSource.slice(
      multiplayerSource.indexOf("if (message.type === 'room-left')"),
      multiplayerSource.indexOf("if (message.type === 'room-chat')"),
    );
    const transportClose = multiplayerSource.slice(
      multiplayerSource.indexOf("socket.addEventListener('close'"),
      multiplayerSource.indexOf("socket.addEventListener('error'"),
    );
    expect(explicitExit).toContain('setRoomExit((current) => ({');
    expect(transportClose).not.toContain('setRoomExit');
    expect(appSource).toContain('disabled={clubEventConfigurationLocked}');
    expect(appSource).toContain('const lapControlsDisabled = clubEventConfigurationLocked');
    expect(appSource).toContain('const canChooseStartHereSplitLine = !clubEventConfigurationLocked');
  });

  it('keeps completed Club Tablet results and athlete identity until explicit exit', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
    const tabletModeSource = readFileSync(
      new URL('../../src/components/ClubTabletMode.tsx', import.meta.url),
      'utf8',
    );
    const utilitySource = readFileSync(
      new URL('../../src/components/ClubOwnerUtilityMode.tsx', import.meta.url),
      'utf8',
    );
    const reviewArmIndex = appSource.indexOf(
      'clubTabletCompletionReviewSessionTokenRef.current = clubTabletSession.sessionToken;',
    );
    const reviewLayout = appSource.slice(
      appSource.lastIndexOf('useLayoutEffect(() => {', reviewArmIndex),
      appSource.indexOf('  ]);', reviewArmIndex),
    );
    expect(appSource).toContain('const clubTabletCompletionReviewSessionTokenRef = useRef<string | null>(null);');
    expect(reviewLayout).toContain("raceState !== 'finished'");
    expect(reviewLayout).toContain("raceCapture.source !== 'live'");
    expect(reviewLayout).toContain('raceSummary.some');
    expect(reviewLayout).not.toContain("raceCapture.status !== 'finished'");
    expect(appSource).toContain('clubTabletCompletionReviewSessionTokenRef.current === activeSession.sessionToken');
    expect(appSource).toContain('clubTabletCompletionReviewSessionTokenRef.current = completedSession.sessionToken;');
    expect(appSource).not.toContain('clubTabletCompletionReviewActiveRef');
    expect(appSource).not.toContain('resultReviewHold');
    expect(appSource).not.toContain('clubTabletExerciseSavedRef');
    expect(utilitySource).not.toContain('releaseClubTabletAthleteAfterSaves');
    expect(utilitySource).not.toContain('onTabletExerciseSaved');
    expect(appSource).toContain('onTabletExerciseReviewStart: handleClubTabletExerciseReviewStart,');
    expect(appSource).toContain('holdResultsUntilExit: clubTabletSessionActive,');
    expect(appSource).toContain('roomClockAuthorized: Boolean(multiplayer.currentRoom && roomAuthority),');
    expect(tabletModeSource).toContain(
      'Completed results stay with this athlete until they choose End activity.',
    );

    const explicitExitStart = appSource.indexOf('const handleClubTabletEndAthlete = useCallback(async () => {');
    const explicitExitEnd = appSource.indexOf('  useEffect(() => {', explicitExitStart);
    const explicitExit = appSource.slice(explicitExitStart, explicitExitEnd);
    expect(explicitExit).toContain('handleClubTabletSessionChange(null);');
    expect(explicitExit).toContain('await endClubTabletSession(activeSession).catch(() => undefined);');
    expect(explicitExit.indexOf('handleClubTabletSessionChange(null);'))
      .toBeLessThan(explicitExit.indexOf('await endClubTabletSession(activeSession)'));
  });
});
