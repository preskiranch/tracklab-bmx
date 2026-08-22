import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectStudioWatchConnectEnrollment,
  loadClubTabletWatchConnectStatus,
} from '../../src/lib/watchConnectCloud';
import { watchConnectSessionDurationMs } from '../../src/lib/watchConnect';
import { clubTabletWatchStatusRequestIsCurrent } from '../../src/components/ClubTabletMode';

afterEach(() => vi.unstubAllGlobals());

describe('Watch Connect tablet client', () => {
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
