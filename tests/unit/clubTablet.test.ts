import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredClubTabletSession,
  clubTabletOutboxStorageKey,
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
import { clubTabletBikeAccessReady } from '../../src/components/ClubTabletMode';

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
  it('keeps Wattbike pairing locked until server authorization is active', () => {
    expect(clubTabletBikeAccessReady('checking', false)).toBe(false);
    expect(clubTabletBikeAccessReady('error', false)).toBe(false);
    expect(clubTabletBikeAccessReady('revoked', false)).toBe(false);
    expect(clubTabletBikeAccessReady('active', false)).toBe(false);
    expect(clubTabletBikeAccessReady('active', true)).toBe(true);
  });

  it('normalizes only safe devices and approved claimed or unclaimed roster athletes', () => {
    expect(normalizeClubTabletDeviceCredential({
      ...deviceCredential,
      deviceToken: `  ${deviceCredential.deviceToken}  `,
    })).toEqual(deviceCredential);

    expect(normalizeClubTabletRoster({
      device: deviceCredential.device,
      athletes: [
        { studioRiderId: 'rider-2', riderName: 'Zoey', claimed: true },
        { studioRiderId: 'rider-1', riderName: 'Alex', claimed: false },
        { studioRiderId: '', riderName: 'Invalid' },
      ],
    })?.athletes).toEqual([
      expect.objectContaining({ studioRiderId: 'rider-1', riderName: 'Alex', status: 'unclaimed' }),
      expect.objectContaining({ studioRiderId: 'rider-2', riderName: 'Zoey', status: 'claimed' }),
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

    await expect(saveClubTabletRaceResult(result, sessionCredential)).rejects.toMatchObject({ status: 503 });
    expect(localStorage.getItem(clubTabletOutboxStorageKey)).toBeNull();
    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toContain('race-1');
    await expect(flushClubTabletOutbox(sessionCredential)).resolves.toBe(1);
    await expect(flushClubTabletOutbox(sessionCredential)).resolves.toBe(0);
    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toBe('[]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('purges pending athlete artifacts on sign-out without erasing tablet enrollment', async () => {
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
    }, sessionCredential)).rejects.toMatchObject({ status: 503 });
    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toContain('race-private');

    clearStoredClubTabletSession();

    expect(sessionStorage.getItem(clubTabletOutboxStorageKey)).toBeNull();
    expect(readStoredClubTabletSession()).toBeNull();
    expect(readStoredClubTabletDevice()).toEqual(deviceCredential);
  });
});
