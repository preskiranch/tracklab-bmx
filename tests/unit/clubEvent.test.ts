import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClubEventRequestError,
  cancelCurrentClubEvent,
  clubEventLaunchAcknowledged,
  clubEventMultiplayerRoomReady,
  clubEventLaunchForDevice,
  clubEventLaunchWasHandled,
  clubEventSelectionConflict,
  clubEventTabletState,
  createClubEvent,
  joinCurrentClubEvent,
  leaveCurrentClubEvent,
  loadCurrentClubEvent,
  loadCurrentClubEventForOwner,
  markClubEventLaunchHandled,
  normalizeClubEventEnvelope,
  normalizeClubEventSnapshot,
  startCurrentClubEvent,
  type ClubEventSnapshot,
} from '../../src/lib/clubEvent';
import type {
  ClubTabletDeviceCredential,
  ClubTabletSessionCredential,
} from '../../src/lib/clubTabletStorage';
import { clubTabletCoachEventLocksIndependentTraining } from '../../src/components/ClubTabletMode';
import { clubTabletEventPollingMessage } from '../../src/components/ClubTabletEventCard';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const deviceCredential: ClubTabletDeviceCredential = {
  device: {
    id: 'tablet-1',
    name: 'Studio iPad 1',
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

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    clubId: 'club-1',
    clubName: 'Preski Ranch',
    activityType: 'bmx-race',
    configuration: { trackName: 'Preski Ranch', lapCount: 3 },
    status: 'lobby',
    startAt: null,
    createdAt: 1_787_000_000_000,
    updatedAt: 1_787_000_001_000,
    slots: [
      {
        seatNumber: 2,
        deviceId: 'tablet-2',
        deviceName: 'Studio iPad 2',
        deviceLastSeenAt: 1_787_000_001_000,
        status: 'ready',
        ready: true,
        athlete: { studioRiderId: 'rider-2', riderName: 'Rider Two', athleteName: 'Mason' },
        bikeDeviceId: '733113',
        joinedAt: 1_787_000_000_500,
      },
      {
        seatNumber: 1,
        deviceId: 'tablet-1',
        deviceName: 'Studio iPad 1',
        deviceLastSeenAt: 1_787_000_001_000,
        status: 'ready',
        ready: true,
        athlete: { studioRiderId: 'rider-1', riderName: 'Rider One', athleteName: 'Rasheen' },
        bikeDeviceId: '733112',
        joinedAt: 1_787_000_000_400,
      },
      { seatNumber: 1, status: 'available', ready: false, athlete: null },
      { seatNumber: 5, status: 'available', ready: false, athlete: null },
    ],
    ...overrides,
  };
}

function normalizedEvent(overrides: Record<string, unknown> = {}) {
  const event = normalizeClubEventSnapshot(eventPayload(overrides));
  if (!event) throw new Error('Test fixture did not normalize.');
  return event;
}

function okEnvelope() {
  return new Response(JSON.stringify({ event: null, pollAfterMs: 2_000 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('club event normalization', () => {
  it('normalizes the server contract, keeps string bike IDs, and rejects duplicate or excess seats', () => {
    const unsafeConfiguration = JSON.parse('{"trackName":"Preski Ranch","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const event = normalizedEvent({ configuration: unsafeConfiguration });

    expect(event.slots.map((slot) => slot.seatNumber)).toEqual([1, 2]);
    expect(event.slots[0]).toMatchObject({
      deviceId: 'tablet-1',
      status: 'ready',
      ready: true,
      bikeDeviceId: '733112',
      athlete: { studioRiderId: 'rider-1', athleteName: 'Rasheen' },
    });
    expect(Object.prototype.hasOwnProperty.call(event.configuration, '__proto__')).toBe(false);
  });

  it('requires a valid shared start time for active events and tolerates direct snapshots', () => {
    expect(normalizeClubEventSnapshot(eventPayload({ status: 'active', startAt: null }))).toBeNull();
    expect(normalizeClubEventSnapshot(eventPayload({ activityType: 'get-pulled' }))).toBeNull();
    expect(normalizeClubEventEnvelope(eventPayload())?.pollAfterMs).toBe(2_000);
    expect(normalizeClubEventEnvelope({ event: null, pollAfterMs: 50 })?.pollAfterMs).toBe(1_000);
    expect(normalizeClubEventEnvelope({ event: null, pollAfterMs: 99_999 })?.pollAfterMs).toBe(15_000);
  });

  it('preserves the complete private course snapshot needed by another club tablet', () => {
    const centerline = Array.from({ length: 2_500 }, (_, index) => ({
      lat: 38 + (index * 0.00001),
      lng: -122,
    }));
    const event = normalizedEvent({
      configuration: {
        trackId: 'private-drag-strip',
        trackRecord: { id: 'private-drag-strip', centerline },
      },
    });
    expect((event.configuration.trackRecord as { centerline: unknown[] }).centerline).toHaveLength(2_500);
  });
});

describe('club event tablet selection and launch state', () => {
  it('explains duplicate athlete and Wattbike conflicts while ignoring this tablet', () => {
    const event = normalizedEvent();
    expect(clubEventSelectionConflict(event, {
      deviceId: 'tablet-3',
      studioRiderId: 'rider-1',
      bikeDeviceId: 999_111,
    })).toContain('already ready on Studio iPad 1');
    expect(clubEventSelectionConflict(event, {
      deviceId: 'tablet-3',
      studioRiderId: 'rider-3',
      bikeDeviceId: 733_113,
    })).toContain('already assigned to Studio iPad 2');
    expect(clubEventSelectionConflict(event, {
      deviceId: 'tablet-1',
      studioRiderId: 'rider-1',
      bikeDeviceId: 733_112,
    })).toBeNull();
  });

  it('derives selecting, conflict, ready, stale, and active states', () => {
    const readyEvent = normalizedEvent();
    expect(clubEventTabletState(readyEvent, 'tablet-1').phase).toBe('ready');
    expect(clubTabletCoachEventLocksIndependentTraining(readyEvent, 'tablet-1')).toBe(true);
    expect(clubTabletCoachEventLocksIndependentTraining(readyEvent, 'tablet-4')).toBe(false);
    expect(clubEventTabletState(readyEvent, 'tablet-3', {
      deviceId: 'tablet-3',
      studioRiderId: 'rider-1',
      bikeDeviceId: 999_111,
    }).phase).toBe('conflict');
    expect(clubEventTabletState(readyEvent, 'tablet-4', {
      deviceId: 'tablet-4',
      studioRiderId: 'rider-4',
      bikeDeviceId: 733_114,
    }).phase).toBe('selecting');

    const stale = normalizedEvent({
      slots: [{ ...eventPayload().slots[0], deviceId: 'tablet-1', status: 'stale', ready: false }],
    });
    expect(clubEventTabletState(stale, 'tablet-1').phase).toBe('stale');
    expect(clubTabletCoachEventLocksIndependentTraining(stale, 'tablet-1')).toBe(false);

    const active = normalizedEvent({ status: 'active', startAt: Date.now() + 8_000 });
    expect(clubEventTabletState(active, 'tablet-1').phase).toBe('active');
    expect(clubTabletCoachEventLocksIndependentTraining(active, 'tablet-1')).toBe(true);
  });

  it('builds a typed launch payload once for the local ready lane', () => {
    vi.stubGlobal('window', { sessionStorage: new MemoryStorage() });
    const event = normalizedEvent({ status: 'active', startAt: Date.now() + 8_000 });
    const launch = clubEventLaunchForDevice(event, 'tablet-1');

    expect(launch).toMatchObject({
      eventId: 'event-1',
      program: 'race',
      studioRiderId: 'rider-1',
      bikeDeviceId: 733_112,
      seatNumber: 1,
    });
    expect(clubEventLaunchWasHandled(launch!)).toBe(false);
    markClubEventLaunchHandled(launch!);
    expect(clubEventLaunchWasHandled(launch!)).toBe(true);
    expect(clubEventLaunchForDevice(event, 'tablet-missing')).toBeNull();
  });

  it('requires the server-authenticated event slot to become active before declaring launch', () => {
    const now = Date.now();
    const event = normalizedEvent({ status: 'active', startAt: now + 8_000 });
    const slot = event.slots[0];
    expect(clubEventLaunchAcknowledged(event, slot)).toBe(false);
    expect(clubEventLaunchAcknowledged(event, { ...slot, status: 'active' })).toBe(true);
    expect(clubEventLaunchAcknowledged(event, { ...slot, status: 'active', ready: false })).toBe(false);
    expect(clubEventMultiplayerRoomReady('event-1', undefined)).toBe(false);
    expect(clubEventMultiplayerRoomReady('event-1', 'event-other')).toBe(false);
    expect(clubEventMultiplayerRoomReady('event-1', 'event-1')).toBe(true);
    expect(clubEventMultiplayerRoomReady(null, undefined)).toBe(true);
  });

  it('provides actionable first-load and later-refresh polling errors', () => {
    expect(clubTabletEventPollingMessage(false)).toContain('Could not load');
    expect(clubTabletEventPollingMessage(false)).toContain('connection');
    expect(clubTabletEventPollingMessage(true)).toContain('Could not refresh');
  });
});

describe('club event API clients', () => {
  it('polls with the device credential, then switches to the authoritative athlete session', async () => {
    const fetchMock = vi.fn(async () => okEnvelope());
    vi.stubGlobal('fetch', fetchMock);

    await loadCurrentClubEvent({ device: deviceCredential });
    let headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer device-token');
    expect(headers.get('X-TrackLab-Club-Tablet-Session')).toBeNull();

    await loadCurrentClubEvent({ device: deviceCredential, session: sessionCredential });
    headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-TrackLab-Club-Tablet-Session')).toBe('athlete-session-token');
  });

  it('joins and leaves with only the session identity and event ID', async () => {
    const fetchMock = vi.fn(async () => okEnvelope());
    vi.stubGlobal('fetch', fetchMock);

    await joinCurrentClubEvent(' event-1 ', sessionCredential);
    await leaveCurrentClubEvent('event-1', sessionCredential);

    expect(fetchMock.mock.calls.map(([path, init]) => ({
      path,
      method: init?.method,
      body: init?.body,
      session: new Headers(init?.headers).get('X-TrackLab-Club-Tablet-Session'),
      authorization: new Headers(init?.headers).get('Authorization'),
    }))).toEqual([
      {
        path: '/api/club-events/current/join',
        method: 'POST',
        body: JSON.stringify({ eventId: 'event-1' }),
        session: 'athlete-session-token',
        authorization: null,
      },
      {
        path: '/api/club-events/current/join',
        method: 'DELETE',
        body: JSON.stringify({ eventId: 'event-1' }),
        session: 'athlete-session-token',
        authorization: null,
      },
    ]);
  });

  it('preserves the server message on an atomic duplicate-lock conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Rasheen is already active on Studio iPad 2.',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));

    await expect(joinCurrentClubEvent('event-1', sessionCredential)).rejects.toEqual(
      expect.objectContaining<Partial<ClubEventRequestError>>({
        name: 'ClubEventRequestError',
        status: 409,
        message: 'Rasheen is already active on Studio iPad 2.',
      }),
    );
  });

  it('uses cookie auth, never tablet headers, for owner create/start/cancel/poll calls', async () => {
    const fetchMock = vi.fn(async () => okEnvelope());
    vi.stubGlobal('fetch', fetchMock);

    await loadCurrentClubEventForOwner();
    await createClubEvent('straight-sprint', { distanceFeet: 300, airSetting: 1 });
    await startCurrentClubEvent('event-1');
    await cancelCurrentClubEvent('event-1');

    expect(fetchMock.mock.calls.map(([path, init]) => {
      const headers = new Headers(init?.headers);
      return {
        path,
        method: init?.method,
        body: init?.body,
        authorization: headers.get('Authorization'),
        session: headers.get('X-TrackLab-Club-Tablet-Session'),
      };
    })).toEqual([
      {
        path: '/api/club-events/current',
        method: 'GET',
        body: undefined,
        authorization: null,
        session: null,
      },
      {
        path: '/api/club-events',
        method: 'POST',
        body: JSON.stringify({
          activityType: 'straight-sprint',
          configuration: { distanceFeet: 300, airSetting: 1 },
        }),
        authorization: null,
        session: null,
      },
      {
        path: '/api/club-events/current/start',
        method: 'POST',
        body: JSON.stringify({ eventId: 'event-1' }),
        authorization: null,
        session: null,
      },
      {
        path: '/api/club-events/current/cancel',
        method: 'POST',
        body: JSON.stringify({ eventId: 'event-1' }),
        authorization: null,
        session: null,
      },
    ]);
  });
});
