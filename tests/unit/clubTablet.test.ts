import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeClubTabletCredentialMocks = vi.hoisted(() => ({
  clear: vi.fn(async () => true),
  forget: vi.fn(async () => true),
  save: vi.fn(async () => true),
}));

const nativeAuthSessionMocks = vi.hoisted(() => ({
  clear: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/nativeClubTabletCredential', () => ({
  clearNativeClubTabletCredential: nativeClubTabletCredentialMocks.clear,
  forgetNativeClubTabletAuthorization: nativeClubTabletCredentialMocks.forget,
  saveNativeClubTabletCredential: nativeClubTabletCredentialMocks.save,
}));

vi.mock('../../src/lib/nativeAuthSession', () => ({
  clearNativeAuthToken: nativeAuthSessionMocks.clear,
}));

import {
  claimClubTabletPickerWattbikeCapacity,
  clearClubTabletBikePresence,
  clearStoredClubTabletSession,
  clubTabletOutboxStorageKey,
  clubTabletResultUploadHeader,
  endClubTabletSession,
  enrollClubTablet,
  flushClubTabletOutbox,
  normalizeClubTabletDeviceCredential,
  normalizeClubTabletRoster,
  normalizeClubTabletSessionCredential,
  publishClubTabletBikePresence,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  recoverClubTabletDevice,
  releaseClubTabletPickerWattbikeCapacity,
  revokeClubTabletDevice,
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
  clubTabletRestoreCandidates,
  clubTabletShouldAutoStartSelection,
} from '../../src/components/ClubTabletMode';
import {
  clubTabletAuthorizationTimeoutMs,
  clubTabletRosterRefreshMs,
  expireClubTabletSessionLocallyFirst,
} from '../../src/components/ClubTabletRuntime';
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

class UnavailableStorage implements Storage {
  get length() {
    return 0;
  }

  clear() {
    throw new Error('Storage unavailable');
  }

  getItem() {
    throw new Error('Storage unavailable');
  }

  key() {
    return null;
  }

  removeItem() {
    throw new Error('Storage unavailable');
  }

  setItem() {
    throw new Error('Storage unavailable');
  }
}

const deviceCredential: ClubTabletDeviceCredential = {
  device: {
    id: 'tablet-1',
    name: 'Front desk iPad',
    clubId: 'club-1',
    clubName: 'Preski Ranch',
    recoveryState: 'pending',
    recoveryCompleted: false,
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
  nativeClubTabletCredentialMocks.clear.mockClear();
  nativeClubTabletCredentialMocks.forget.mockClear();
  nativeClubTabletCredentialMocks.save.mockClear();
  nativeAuthSessionMocks.clear.mockClear();
});

describe('Club Tablet client state', () => {
  it('refreshes an authorized roster often enough to receive published layouts', () => {
    expect(clubTabletRosterRefreshMs).toBeGreaterThanOrEqual(5_000);
    expect(clubTabletRosterRefreshMs).toBeLessThanOrEqual(15_000);
    const runtimeSource = readFileSync(
      new URL('../../src/components/ClubTabletRuntime.tsx', import.meta.url),
      'utf8',
    );
    expect(runtimeSource).toContain('onRosterRefresh(nextRoster)');
    expect(runtimeSource).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
  });

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

  it('offers every server record to an unclaimed iPad and removes only the consumed row', () => {
    const devices = [
      deviceCredential.device,
      { ...deviceCredential.device, id: 'tablet-2', name: 'Bike 2 iPad' },
    ];
    expect(clubTabletRestoreCandidates(
      devices,
      new Set([deviceCredential.device.id]),
    )).toEqual([devices[1]]);
    const migratedRows = [
      { ...devices[1], recoveryState: 'complete' as const, recoveryCompleted: true },
      { ...devices[1], id: 'tablet-3', recoveryState: 'restored' as const, recoveryCompleted: true },
    ];
    expect(clubTabletRestoreCandidates(migratedRows, new Set())).toEqual(migratedRows);
    expect(clubTabletAuthorizationTimeoutMs).toBe(15_000);
  });

  it('commits a recovered credential before best-effort notification cleanup', () => {
    const modeSource = readFileSync(
      new URL('../../src/components/ClubTabletMode.tsx', import.meta.url),
      'utf8',
    );
    const restoreStart = modeSource.indexOf('const restoreDevice = async (device: ClubTabletDevice) =>');
    const restoreEnd = modeSource.indexOf('const refreshRoster = async', restoreStart);
    const restoreSource = modeSource.slice(restoreStart, restoreEnd);
    expect(restoreStart).toBeGreaterThanOrEqual(0);
    expect(restoreEnd).toBeGreaterThan(restoreStart);
    expect(restoreSource.indexOf('onDeviceChange(credential)'))
      .toBeLessThan(restoreSource.indexOf("import('./NativeNotificationsCoordinator')"));
    expect(restoreSource).toContain('consumedRestoreDeviceIdsRef.current.add(device.id)');
    expect(restoreSource).not.toContain('Verifying authorization');
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
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      device: {
        ...deviceCredential.device,
        recoveryState: 'restored',
        recoveryCompleted: true,
        pairedBike: {
          deviceId: 733_112,
          label: 'WattbikePM250733112',
          updatedAt: presenceNow,
        },
      },
    })).toMatchObject({
      device: {
        recoveryState: 'restored',
        recoveryCompleted: true,
        pairedBike: {
          deviceId: 733_112,
          label: 'WattbikePM250733112',
          updatedAt: presenceNow,
        },
      },
    });
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      device: {
        ...deviceCredential.device,
        pairedBike: {
          deviceId: 733_112,
          label: '',
          updatedAt: presenceNow,
        },
      },
    })?.device).not.toHaveProperty('pairedBike');

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

  it('stores enrollment in both browser and durable native device storage', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/api/club-tablet/roster')
        ? { device: deviceCredential.device, athletes: [] }
        : deviceCredential,
    ), {
      status: String(input).endsWith('/api/club-tablet/roster') ? 200 : 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(enrollClubTablet('Front desk iPad', 'club-1')).resolves.toEqual(deviceCredential);

    expect(fetchMock).toHaveBeenCalledWith('/api/club-tablet/devices', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Front desk iPad' }),
    }));
    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledWith(deviceCredential);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('keeps the administrator native session when enrollment cannot reach Keychain', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/api/club-tablet/roster')
        ? { device: deviceCredential.device, athletes: [] }
        : deviceCredential,
    ), {
      status: String(input).endsWith('/api/club-tablet/roster') ? 200 : 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save
      .mockRejectedValueOnce(new Error('Keychain write failed'))
      .mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(enrollClubTablet('Front desk iPad', 'club-1')).rejects.toThrow('Keychain write failed');

    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
    expect(nativeAuthSessionMocks.clear).not.toHaveBeenCalled();

    nativeClubTabletCredentialMocks.save.mockResolvedValueOnce(true);
    await expect(enrollClubTablet('Front desk iPad', 'club-1')).resolves.toEqual(deviceCredential);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledTimes(3);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('retries one transient Keychain failure without leaving automatic enrollment', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(deviceCredential), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save.mockRejectedValueOnce(new Error('Keychain busy'));

    await expect(enrollClubTablet('Front desk iPad', 'club-1')).resolves.toEqual(deviceCredential);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledTimes(2);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('never reuses a failed enrollment credential for a different owner club', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const otherClubCredential = {
      device: {
        ...deviceCredential.device,
        id: 'tablet-2',
        clubId: 'club-2',
        clubName: 'Other Club',
      },
      deviceToken: 'other-device-token',
    };
    let requestIndex = 0;
    const fetchMock = vi.fn(async () => {
      const credential = requestIndex === 0 ? deviceCredential : otherClubCredential;
      requestIndex += 1;
      return new Response(JSON.stringify(credential), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save
      .mockRejectedValueOnce(new Error('Keychain write failed'))
      .mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(enrollClubTablet('Front desk iPad', 'club-1')).rejects.toThrow(
      'Keychain write failed',
    );
    await expect(enrollClubTablet('Front desk iPad', 'club-2')).resolves.toEqual(
      otherClubCredential,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readStoredClubTabletDevice()).toEqual(otherClubCredential);
  });

  it('restores an existing authorized tablet without creating a duplicate enrollment', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const recoveredCredential = {
      ...deviceCredential,
      deviceToken: 'rotated-device-token',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/api/club-tablet/roster')
        ? { device: recoveredCredential.device, athletes: [] }
        : recoveredCredential,
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverClubTabletDevice('tablet-1')).resolves.toEqual(recoveredCredential);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/club-tablet/devices/tablet-1/recover',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(readStoredClubTabletDevice()).toEqual(recoveredCredential);
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledWith(recoveredCredential);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('retries a failed native recovery save without rotating the server credential again', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const recoveredCredential = {
      ...deviceCredential,
      deviceToken: 'rotated-device-token',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/api/club-tablet/roster')
        ? { device: recoveredCredential.device, athletes: [] }
        : recoveredCredential,
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save
      .mockRejectedValueOnce(new Error('Keychain write failed'))
      .mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(recoverClubTabletDevice('tablet-1')).rejects.toThrow('Keychain write failed');
    expect(readStoredClubTabletDevice()).toEqual(recoveredCredential);
    expect(nativeAuthSessionMocks.clear).not.toHaveBeenCalled();

    nativeClubTabletCredentialMocks.save.mockResolvedValueOnce(true);
    await expect(recoverClubTabletDevice('tablet-1')).resolves.toEqual(recoveredCredential);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledTimes(3);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('retries the issued recovery credential in memory when browser storage is unavailable', async () => {
    const localStorage = new UnavailableStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const recoveredCredential = {
      ...deviceCredential,
      deviceToken: 'rotated-device-token',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/api/club-tablet/roster')
        ? { device: recoveredCredential.device, athletes: [] }
        : recoveredCredential,
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save
      .mockRejectedValueOnce(new Error('Keychain write failed'))
      .mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(recoverClubTabletDevice('tablet-1')).rejects.toThrow('Keychain write failed');
    expect(readStoredClubTabletDevice()).toBeNull();

    nativeClubTabletCredentialMocks.save.mockResolvedValueOnce(true);
    await expect(recoverClubTabletDevice('tablet-1')).resolves.toEqual(recoveredCredential);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('refuses to persist a pending recovery credential after the server revokes it', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    const recoveredCredential = {
      ...deviceCredential,
      deviceToken: 'rotated-device-token',
    };
    const freshCredential = {
      ...deviceCredential,
      deviceToken: 'fresh-device-token',
    };
    let recoveryRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/club-tablet/roster')) {
        return new Response(JSON.stringify({ error: 'This tablet authorization was revoked.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const credential = recoveryRequests === 0 ? recoveredCredential : freshCredential;
      recoveryRequests += 1;
      return new Response(JSON.stringify(credential), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    nativeClubTabletCredentialMocks.save
      .mockRejectedValueOnce(new Error('Keychain write failed'))
      .mockRejectedValueOnce(new Error('Keychain write failed'));

    await expect(recoverClubTabletDevice('tablet-1')).rejects.toThrow('Keychain write failed');
    await expect(recoverClubTabletDevice('tablet-1')).rejects.toThrow(
      'This tablet authorization was revoked.',
    );

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(nativeClubTabletCredentialMocks.save).toHaveBeenCalledTimes(2);
    expect(nativeAuthSessionMocks.clear).not.toHaveBeenCalled();
    expect(readStoredClubTabletDevice()).toBeNull();

    await expect(recoverClubTabletDevice('tablet-1')).resolves.toEqual(freshCredential);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
    expect(nativeAuthSessionMocks.clear).toHaveBeenCalledOnce();
  });

  it('clears the durable native credential when the current tablet is revoked', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice(deviceCredential);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revoked: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await revokeClubTabletDevice(deviceCredential.device.id);

    expect(readStoredClubTabletDevice()).toBeNull();
    expect(nativeClubTabletCredentialMocks.forget).toHaveBeenCalledOnce();
    expect(nativeClubTabletCredentialMocks.clear).not.toHaveBeenCalled();
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
