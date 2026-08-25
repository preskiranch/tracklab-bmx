import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredClubTabletSession,
  clubTabletOutboxStorageKey,
  endClubTabletSession,
  flushClubTabletOutbox,
  normalizeClubTabletDeviceCredential,
  normalizeClubTabletRoster,
  readStoredClubTabletDevice,
  readStoredClubTabletSession,
  saveClubTabletRaceResult,
  startClubTabletSession,
  storeClubTabletDevice,
  storeClubTabletSession,
  type ClubTabletDeviceCredential,
  type ClubTabletSessionCredential,
} from '../../src/lib/clubTablet';
import {
  clubTabletBikeAccessReady,
  clubTabletFreshHeartRateReading,
  clubTabletShouldAutoStartSelection,
} from '../../src/components/ClubTabletMode';
import { expireClubTabletSessionLocallyFirst } from '../../src/components/ClubTabletRuntime';
import {
  releaseClubTabletAthleteAfterSaves,
  safelyReleaseCompletedClubTabletSession,
} from '../../src/lib/clubTabletExerciseCompletion';
import type { HeartRateLiveEvent } from '../../src/lib/heartRateCloud';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Club Tablet client state', () => {
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
    const authorizeEnd = modeSource.indexOf('const startAthlete = async (', authorizeStart);
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
      selectedBikeId: 733_112,
      coachEventLocked: true,
    })).toBe(false);
  });

  it('normalizes only safe devices and approved claimed or unclaimed roster athletes', () => {
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      deviceToken: `  ${deviceCredential.deviceToken}  `,
    })).toEqual(deviceCredential);

    expect(normalizeClubTabletRoster({
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
    })?.athletes).toEqual([
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

  it('releases the athlete only after every completed-exercise artifact is durable', async () => {
    let finishHistory: (() => void) | null = null;
    let finishHeartRate: (() => void) | null = null;
    const history = new Promise<void>((resolve) => { finishHistory = resolve; });
    const heartRate = new Promise<void>((resolve) => { finishHeartRate = resolve; });
    const release = vi.fn(async () => undefined);

    const completion = releaseClubTabletAthleteAfterSaves([history, heartRate], release);
    finishHistory?.();
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    finishHeartRate?.();
    await completion;
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps the athlete selected when any completed-exercise save fails', async () => {
    const release = vi.fn(async () => undefined);

    await expect(releaseClubTabletAthleteAfterSaves(
      [Promise.resolve(), Promise.reject(new Error('save failed'))],
      release,
    )).rejects.toThrow('save failed');
    expect(release).not.toHaveBeenCalled();
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
      return new Response(JSON.stringify(sessionCredential), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startClubTabletSession('rider-1', 733_112)).resolves.toMatchObject({
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

  it('releases the visible athlete after queueing, uploads in the background, then retires the token', async () => {
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
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ stopped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await saveClubTabletRaceResult({
      sessionId: 'race-deferred-release',
      trackId: 'track-1',
      trackName: 'Track One',
      summaries: [{ playerId: 1, watts: 800 }],
      localPlayerId: 1,
    }, sessionCredential);
    await endClubTabletSession(sessionCredential);

    expect(readStoredClubTabletSession()).toBeNull();
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toContain('"releaseAfterFlush":true');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(flushClubTabletOutbox()).resolves.toBe(1);
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE' });
  });
});
