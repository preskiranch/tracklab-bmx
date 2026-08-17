import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeClubLiveSessions,
  ClubLiveRequestError,
  loadClubLiveAccess,
  loadClubLiveSessions,
  normalizeClubLiveAccess,
  normalizeClubLiveSessions,
  publishClubLiveSession,
  stopClubLiveSession,
  type ClubLiveSession,
  type ClubLiveSnapshot,
} from '../../src/lib/clubLive';
import {
  shouldAutoStartAdvancedConnector,
  shouldStopAdvancedConnector,
} from '../../src/lib/advancedConnectorPolicy';

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseSession: ClubLiveSession = {
  id: 'club-1:rider-1',
  clubId: 'club-1',
  studioRiderId: 'rider-1',
  riderName: 'Jordan Rider',
  athleteName: 'Jordan',
  activityType: 'bmx-race',
  status: 'active',
  progress: { fraction: 0.5, distanceMeters: 100 },
  metrics: {
    watts: 500,
    cadence: 120,
    speedKph: 35,
    distanceMeters: 100,
    elapsedMs: 10_000,
    position: 1,
    participantCount: 4,
  },
  updatedAt: 10_000,
  expiresAt: 20_000,
  multiplayer: false,
};

describe('Club Live Monitor client state', () => {
  it('normalizes untrusted sessions and keeps every unique club seat while preserving the newest rider snapshot', () => {
    const sessions = normalizeClubLiveSessions({
      sessions: [
        { ...baseSession, id: 'old', updatedAt: 1_000 },
        { ...baseSession, id: 'new', updatedAt: 9_000, progress: 2, roomId: 'must-not-surface' },
        ...Array.from({ length: 5 }, (_, index) => ({
          ...baseSession,
          id: `other-${index}`,
          studioRiderId: `rider-${index + 2}`,
          updatedAt: 8_000 - index,
        })),
        { id: '', clubId: 'club-1', studioRiderId: 'invalid' },
      ],
    });

    expect(sessions).toHaveLength(6);
    expect(sessions[0]).toMatchObject({ id: 'new', progress: { fraction: 1 }, metrics: { watts: 500 } });
    expect(sessions.filter((session) => session.studioRiderId === 'rider-1')).toHaveLength(1);
    expect(sessions[0]).not.toHaveProperty('roomId');
  });

  it('expires monitor tiles from the independent client clock', () => {
    const expired = { ...baseSession, id: 'expired', expiresAt: 9_999 };
    const live = { ...baseSession, id: 'live', studioRiderId: 'rider-2', expiresAt: 10_001 };

    expect(activeClubLiveSessions([expired, live], 10_000)).toEqual([live]);
  });

  it('fails closed when an access response belongs to another club', () => {
    expect(normalizeClubLiveAccess({
      clubId: 'club-other',
      active: true,
      expiresAt: Date.now() + 60_000,
      bikeSeats: 4,
    }, 'club-1')).toEqual({
      clubId: 'club-1',
      active: false,
      expiresAt: expect.any(Number),
      bikeSeats: 4,
    });
  });

  it('preserves a 20-seat club entitlement without changing race capacity', () => {
    expect(normalizeClubLiveAccess({
      clubId: 'club-1',
      active: true,
      expiresAt: Date.now() + 60_000,
      bikeSeats: 20,
    }, 'club-1')).toEqual({
      clubId: 'club-1',
      active: true,
      expiresAt: expect.any(Number),
      bikeSeats: 20,
    });
  });

  it('uses the owner and athlete endpoints without sending private room identifiers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/club-live/access')) {
        return new Response(JSON.stringify({ clubId: 'club-1', active: true, expiresAt: 50_000, bikeSeats: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!init?.method) {
        return new Response(JSON.stringify({ sessions: [baseSession] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const snapshot: ClubLiveSnapshot = {
      clubId: 'club-1',
      studioRiderId: 'rider-1',
      activityType: 'explore',
      status: 'active',
      progress: { fraction: 0.25 },
      metrics: baseSession.metrics,
      multiplayer: true,
    };
    await publishClubLiveSession(snapshot);
    await stopClubLiveSession(snapshot, { keepalive: true });
    await expect(loadClubLiveSessions()).resolves.toHaveLength(1);
    await expect(loadClubLiveAccess('club-1')).resolves.toEqual({
      clubId: 'club-1',
      active: true,
      expiresAt: 50_000,
      bikeSeats: 2,
    });

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const remove = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(put?.[0]).toBe('/api/club-live/sessions');
    expect(JSON.parse(String(put?.[1]?.body))).not.toHaveProperty('roomId');
    expect(remove?.[1]).toMatchObject({ method: 'DELETE', keepalive: true });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('/api/club-live/access?clubId=club-1');
  });

  it('preserves authorization status on API failures so the owner view can clear securely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(loadClubLiveSessions()).rejects.toMatchObject<Partial<ClubLiveRequestError>>({
      name: 'ClubLiveRequestError',
      status: 403,
    });
  });

  it('does not restart the owner connector after Club Live Monitor releases its bikes', () => {
    const base = {
      bikeConnectionSource: 'advanced' as const,
      bridgeConnection: 'open',
      clubMonitorOpen: true,
      demoMode: false,
      membershipTier: 'racer',
    };

    expect(shouldAutoStartAdvancedConnector({ ...base, bridgeSourceState: 'running' })).toBe(false);
    expect(shouldAutoStartAdvancedConnector({ ...base, bridgeSourceState: 'idle' })).toBe(false);
    expect(shouldAutoStartAdvancedConnector({
      ...base,
      bridgeSourceState: 'idle',
      clubMonitorOpen: false,
    })).toBe(true);
  });

  it('stops error-state connector hardware for the owner monitor without looping after idle', () => {
    expect(shouldStopAdvancedConnector({
      authenticatedRacerAccess: true,
      clubMonitorOpen: true,
      sourceState: 'error',
    })).toBe(true);
    expect(shouldStopAdvancedConnector({
      authenticatedRacerAccess: true,
      clubMonitorOpen: true,
      sourceState: 'stopping',
    })).toBe(false);
    expect(shouldStopAdvancedConnector({
      authenticatedRacerAccess: true,
      clubMonitorOpen: true,
      sourceState: 'idle',
    })).toBe(false);
  });
});
