import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateAuthorizedClubMonitorSprint,
  authorizeClubMonitorSprint,
  cancelClubMonitorSprintAuthorization,
  saveAuthorizedClubMonitorSprint,
} from '../../src/lib/clubMonitorHistory';

const reservation = {
  clubId: 'club-test',
  studioRiderId: 'rider-test',
  bikeDeviceId: 101,
  sessionId: 'monitor-sprint:rider-test:1000',
  playerId: 2,
  armedAt: 1_000,
};

const binding = {
  clubId: reservation.clubId,
  studioRiderId: reservation.studioRiderId,
  bikeDeviceId: reservation.bikeDeviceId,
  sessionId: reservation.sessionId,
  playerId: reservation.playerId,
  startedAt: 1_000,
};

const reservedAuthorization = {
  id: 'club-monitor-test',
  clubId: reservation.clubId,
  studioRiderId: reservation.studioRiderId,
  bikeDeviceId: '101',
  sessionId: reservation.sessionId,
  playerId: reservation.playerId,
  armedAt: reservation.armedAt,
  startedAt: null,
  activatedAt: null,
  expiresAt: 901_000,
  consumedAt: null,
  revokedAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const activatedAuthorization = {
  ...reservedAuthorization,
  startedAt: binding.startedAt,
  activatedAt: 1_010,
  updatedAt: 1_010,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('club Monitor View history client', () => {
  it('reserves before pedaling, activates on the first watt, and reuses the memory-only token for save', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith('/monitor-authorizations')) {
        return new Response(JSON.stringify({ authorization: reservedAuthorization, saveToken: 's'.repeat(43) }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/activate')) {
        return new Response(JSON.stringify({ authorization: activatedAuthorization }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        session: {
          id: binding.sessionId,
          activityType: 'monitor-sprint',
          title: 'Monitor View sprint',
          startedAt: 1_000,
          endedAt: 6_000,
          durationMs: 5_000,
          distanceMeters: 72,
          source: 'live',
          details: {},
          createdAt: 1_000,
          updatedAt: 6_000,
        },
        replayed: false,
        heartRate: { status: 'pending' },
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const credential = await authorizeClubMonitorSprint(reservation);
    expect(credential).toMatchObject({
      authorization: {
        id: reservedAuthorization.id,
        clubId: reservation.clubId,
        studioRiderId: reservation.studioRiderId,
        bikeDeviceId: '101',
        sessionId: reservation.sessionId,
        playerId: reservation.playerId,
        armedAt: reservation.armedAt,
        startedAt: null,
        activatedAt: null,
        expiresAt: reservedAuthorization.expiresAt,
      },
      saveToken: 's'.repeat(43),
    });
    const activated = await activateAuthorizedClubMonitorSprint(credential, binding.startedAt);
    expect(activated).toMatchObject({
      authorization: {
        id: reservedAuthorization.id,
        armedAt: reservation.armedAt,
        startedAt: binding.startedAt,
        activatedAt: 1_010,
      },
      saveToken: 's'.repeat(43),
    });
    const result = {
      startedAt: 1_000,
      endedAt: 6_000,
      distanceMeters: 72,
      averageWatts: 600,
      peakWatts: 1_200,
      averageCadence: 150,
      peakCadence: 210,
      averageSpeedKph: 40,
      peakSpeedKph: 54,
    };
    const saved = await saveAuthorizedClubMonitorSprint(binding, result, activated.saveToken);

    expect(saved).toEqual({ replayed: false, heartRate: { status: 'pending' } });
    expect(requests[0]).toMatchObject({
      url: '/api/club-live/monitor-authorizations',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual(reservation);
    expect(requests[1].url).toBe(`/api/club-live/monitor-authorizations/${reservedAuthorization.id}/activate`);
    expect(new Headers(requests[1].init.headers).get('X-TrackLab-Monitor-Save-Token')).toBe('s'.repeat(43));
    expect(JSON.parse(String(requests[1].init.body))).toEqual({ startedAt: binding.startedAt });
    expect(requests[2].url).toBe('/api/club-live/monitor-training-sessions');
    expect(new Headers(requests[2].init.headers).get('X-TrackLab-Monitor-Save-Token')).toBe('s'.repeat(43));
    expect(JSON.parse(String(requests[2].init.body))).toEqual({
      clubId: binding.clubId,
      studioRiderId: binding.studioRiderId,
      bikeDeviceId: binding.bikeDeviceId,
      sessionId: binding.sessionId,
      playerId: binding.playerId,
      startedAt: binding.startedAt,
      result,
    });
  });

  it('rejects an activation response that changes the exact reserved assignment', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization: reservedAuthorization,
        saveToken: 's'.repeat(43),
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization: { ...activatedAuthorization, bikeDeviceId: '102' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const credential = await authorizeClubMonitorSprint(reservation);
    await expect(activateAuthorizedClubMonitorSprint(credential, binding.startedAt)).rejects.toMatchObject({
      message: 'Monitor View first-watt activation did not match its reserved rider and Wattbike.',
    });
  });

  it('cancels by opaque authorization ID and preserves server error status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization: { ...reservedAuthorization, revokedAt: 2_000, updatedAt: 2_000 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'That authorization was already used.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(cancelClubMonitorSprintAuthorization(reservedAuthorization.id)).resolves.toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      authorizationId: reservedAuthorization.id,
    });
    await expect(cancelClubMonitorSprintAuthorization(reservedAuthorization.id)).rejects.toMatchObject({
      message: 'That authorization was already used.',
    });
  });
});
