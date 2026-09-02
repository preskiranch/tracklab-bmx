import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clubTabletRecoveryFinishDeliveryWindowMs,
  createClubTabletRecoveryEpisode,
  flushClubTabletRecoveryOutbox,
  flushClubTabletRecoveryFinishSignals,
  submitClubTabletRecoveryEpisode,
} from '../../src/lib/clubTabletRecoveryAlert';
import {
  clubTabletRecoveryOutboxStorageKey,
  clubTabletResultUploadHeader,
  clubTabletSessionHeader,
  storeClubTabletDevice,
} from '../../src/lib/clubTabletStorage';

const accountId = `recacct_${'c'.repeat(32)}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

const durableCredential = {
  deviceId: 'tablet-recovery-device',
  sessionToken: 'tablet-session-token-original',
  resultUploadToken: 'result-upload-token-original',
  resultUploadExpiresAt: Date.now() + 60_000,
  heartbeatTtlMs: 60_000,
  pollAfterMs: 30_000,
  session: {
    clubId: 'club-recovery',
    clubName: 'Recovery Club',
    studioRiderId: 'studio-athlete-a',
    riderName: 'Athlete A',
    bikeDeviceId: 701,
    expiresAt: Date.now() + 60_000,
  },
} as const;

function finishedEffort(label = 'durable', finishedAt = Date.now()) {
  return {
    requestId: `club-recovery-${label}-${'q'.repeat(32)}`,
    activityType: 'bmx-race' as const,
    sessionId: `club-race-${label}`,
    repetitionId: `club-race-${label}-player-1`,
    finishedAt,
    effortSummary: { finishTimeMs: 12_000, peakPowerWatts: 900 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Club Tablet Recovery Alert client', () => {
  it('submits only an opaque finished effort with the tablet bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accountId, replayed: false }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createClubTabletRecoveryEpisode({
      requestId: `club-recovery-${'x'.repeat(32)}`,
      activityType: 'bmx-race',
      sessionId: 'club-race-session',
      repetitionId: 'club-race-rep-player-1',
      finishedAt: 123_456,
      effortSummary: { finishTimeMs: 12_000, peakPowerWatts: 900 },
    }, 'tablet-session-token')).resolves.toEqual({ accountId, replayed: false });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/club-tablet/recovery-alert/episodes',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: expect.objectContaining({
          'X-TrackLab-Club-Tablet-Session': 'tablet-session-token',
        }),
      }),
    );
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent).toEqual({
      requestId: `club-recovery-${'x'.repeat(32)}`,
      activityType: 'bmx-race',
      sessionId: 'club-race-session',
      repetitionId: 'club-race-rep-player-1',
      finishedAt: 123_456,
      effortSummary: { finishTimeMs: 12_000, peakPowerWatts: 900 },
    });
    expect(JSON.stringify(sent)).not.toMatch(/account|athlete|owner|studioRider|user/iu);
  });

  it('fails closed when the server does not return an opaque account binding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ accountId: 'user:private-id', replayed: false }, 201)));
    await expect(createClubTabletRecoveryEpisode({
      requestId: `club-recovery-${'y'.repeat(32)}`,
      activityType: 'get-pulled',
      sessionId: 'club-pull-session',
      repetitionId: 'club-pull-rep',
      finishedAt: 123_456,
      effortSummary: { workDurationMs: 6_000 },
    }, 'tablet-session-token')).rejects.toThrow('invalid account binding');
  });

  it('retains a studio finish through handoff and flushes it with the original result credential', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice({
      device: {
        id: durableCredential.deviceId,
        name: 'Recovery Tablet',
        clubId: durableCredential.session.clubId,
        clubName: durableCredential.session.clubName,
      },
      deviceToken: 'device-bearer-token',
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(jsonResponse({ accountId, replayed: false }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitClubTabletRecoveryEpisode(finishedEffort(), durableCredential))
      .rejects.toThrow('offline');
    const retained = localStorage.getItem(clubTabletRecoveryOutboxStorageKey) ?? '';
    expect(retained).toContain('result-upload-token-original');
    expect(retained).not.toMatch(/accountId|athleteProfile|ownerProfile|userId/iu);

    await expect(flushClubTabletRecoveryOutbox({ keepalive: true })).resolves.toBe(1);
    expect(localStorage.getItem(clubTabletRecoveryOutboxStorageKey)).toBe('[]');
    const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer device-bearer-token');
    expect(headers.get(clubTabletSessionHeader)).toBe(durableCredential.sessionToken);
    expect(headers.get(clubTabletResultUploadHeader)).toBe(durableCredential.resultUploadToken);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ keepalive: true });
  });

  it('purges expired result credentials and stale finishes without falling back to a later athlete session', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    storeClubTabletDevice({
      device: {
        id: durableCredential.deviceId,
        name: 'Recovery Tablet',
        clubId: durableCredential.session.clubId,
        clubName: durableCredential.session.clubName,
      },
      deviceToken: 'device-bearer-token',
    });
    localStorage.setItem(clubTabletRecoveryOutboxStorageKey, JSON.stringify([
      {
        version: 1,
        id: 'ignored-expired-result-token',
        deviceId: durableCredential.deviceId,
        sessionToken: 'athlete-a-ended-session',
        resultUploadToken: 'athlete-a-expired-result-token',
        resultUploadExpiresAt: now - 1,
        input: finishedEffort('expired-result-token', now - 2_000),
        createdAt: now - 2_000,
        attempts: 0,
      },
      {
        version: 1,
        id: 'ignored-stale-finish',
        deviceId: durableCredential.deviceId,
        sessionToken: 'athlete-a-original-session',
        resultUploadToken: 'athlete-a-result-token',
        resultUploadExpiresAt: now + 60_000,
        input: finishedEffort('stale-finish', now - clubTabletRecoveryFinishDeliveryWindowMs - 1),
        createdAt: now - clubTabletRecoveryFinishDeliveryWindowMs - 1,
        attempts: 0,
      },
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(flushClubTabletRecoveryOutbox({ keepalive: true })).resolves.toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(clubTabletRecoveryOutboxStorageKey)).toBe('[]');
  });

  it('starts the selected athlete finish write before a Club Tablet handoff', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accountId, replayed: false }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const submissions = await flushClubTabletRecoveryFinishSignals({
      credential: {
        sessionToken: 'tablet-session-token',
        session: { studioRiderId: 'studio-athlete-a' },
      },
      mode: 'race',
      raceCapture: {
        sessionId: 'club-race-session',
        startedAt: 20_000,
        source: 'live',
        players: [
          { id: 1, riderId: 'studio-athlete-a' },
          { id: 2, riderId: 'studio-athlete-b' },
        ],
      },
      raceRiders: [
        { playerId: 1, finishedAt: 8_000 },
        { playerId: 2, finishedAt: 9_000 },
      ],
      getPulledResult: null,
    } as any, { keepalive: true });

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ status: 'fulfilled' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: true });
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.finishedAt).toBe(28_000);
    expect(JSON.stringify(sent)).not.toContain('studio-athlete-a');
  });
});
