import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectStudioWatchConnectEnrollment,
  enrollWatchConnect,
  loadClubTabletWatchConnectStatus,
} from '../../src/lib/watchConnectCloud';
import { watchConnectSessionDurationMs } from '../../src/lib/watchConnect';
import { clubTabletWatchStatusRequestIsCurrent } from '../../src/components/ClubTabletMode';

afterEach(() => vi.unstubAllGlobals());

describe('Watch Connect tablet client', () => {
  it('refreshes studio Live BPM consent through the existing enrollment POST', async () => {
    const installId = `wci_${'a'.repeat(64)}`;
    const updatedAt = Date.now();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      enrollment: {
        id: 'enrollment-one',
        scope: 'studio',
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        state: 'trusted',
        liveStudioConsent: true,
        sessionStudioConsent: true,
        createdAt: updatedAt - 1,
        updatedAt,
      },
      replayed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(enrollWatchConnect({
      requestId: 'watch-connect-consent-123456789',
      installId,
      scope: 'studio',
      clubId: 'club-one',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    })).resolves.toMatchObject({
      enrollment: {
        id: 'enrollment-one',
        studioRiderId: 'rider-one',
        liveStudioConsent: true,
        sessionStudioConsent: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/watch-connect/enrollments',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'watch-connect-consent-123456789',
          installId,
          scope: 'studio',
          clubId: 'club-one',
          liveStudioConsent: true,
          sessionStudioConsent: true,
        }),
      },
    );
  });

  it('rejects an enrollment refresh response that does not confirm Live BPM consent', async () => {
    const updatedAt = Date.now();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      enrollment: {
        id: 'enrollment-one',
        scope: 'studio',
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        state: 'trusted',
        liveStudioConsent: false,
        sessionStudioConsent: true,
        createdAt: updatedAt - 1,
        updatedAt,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(enrollWatchConnect({
      requestId: 'watch-connect-consent-123456789',
      installId: `wci_${'a'.repeat(64)}`,
      scope: 'studio',
      clubId: 'club-one',
      liveStudioConsent: true,
      sessionStudioConsent: true,
    })).rejects.toThrow('invalid response');
  });

  it('ignores a delayed response after the selected athlete changes', () => {
    expect(clubTabletWatchStatusRequestIsCurrent('token-a:rider-a', 'token-b:rider-b')).toBe(false);
    expect(clubTabletWatchStatusRequestIsCurrent('token-b:rider-b', 'token-b:rider-b')).toBe(true);
  });

  it('uses the selected athlete session token and returns only safe status', async () => {
    const connectedUntil = Date.now() + watchConnectSessionDurationMs;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      watchConnect: {
        recognized: true,
        state: 'connected',
        connectedUntil,
        remainingMs: watchConnectSessionDurationMs,
        liveSharingEnabled: true,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadClubTabletWatchConnectStatus('tablet-athlete-token')).resolves.toEqual({
      recognized: true,
      state: 'connected',
      connectedUntil,
      remainingMs: watchConnectSessionDurationMs,
      liveSharingEnabled: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/watch-connect/tablet-status',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-TrackLab-Club-Tablet-Session': 'tablet-athlete-token',
        }),
      }),
    );
  });

  it('lets the exact studio owner disconnect only the Watch enrollment', async () => {
    const connectedAt = Date.now();
    const athlete = {
      clubId: 'club-one',
      studioRiderId: 'rider-one',
      riderName: 'Athlete One',
      state: 'not-set-up',
      enrollment: {
        id: 'enrollment-one',
        scope: 'studio',
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        state: 'revoked',
        liveStudioConsent: false,
        sessionStudioConsent: false,
        createdAt: connectedAt,
        updatedAt: connectedAt,
      },
      connection: {
        id: 'connection-one',
        enrollmentId: 'enrollment-one',
        scope: 'studio',
        clubId: 'club-one',
        studioRiderId: 'rider-one',
        state: 'revoked',
        connectedAt,
        connectedUntil: connectedAt + watchConnectSessionDurationMs,
        remainingMs: 0,
        liveStudioConsent: false,
        sessionStudioConsent: false,
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ athlete }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(disconnectStudioWatchConnectEnrollment('club-one', 'enrollment-one'))
      .resolves.toMatchObject({ studioRiderId: 'rider-one', state: 'not-set-up' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/heart-rate/watch-connect/studio/enrollments/enrollment-one?clubId=club-one',
      { method: 'DELETE', headers: { Accept: 'application/json' } },
    );
  });
});
