import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tabletToken = '';

vi.mock('../../src/lib/clubTabletStorage', () => ({
  currentClubTabletSessionToken: () => tabletToken,
  clubTabletSessionHeaders: (token = tabletToken) => token
    ? { 'X-TrackLab-Club-Tablet-Session': token }
    : {},
  readStoredClubTabletSession: () => null,
}));

import {
  ClubLiveRequestError,
  publishClubLiveScreenFrame,
  stopClubLiveSession,
  stopClubLiveScreenFrame,
  type ClubLiveScreenFrame,
} from '../../src/lib/clubLive';

const frame: ClubLiveScreenFrame = {
  clubId: 'club-1',
  studioRiderId: 'rider-1',
  sessionId: 'race-session-1',
  jpegDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  width: 1_280,
  height: 720,
  capturedAt: 1_788_179_696_789,
};

beforeEach(() => {
  tabletToken = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Club Live screen-frame client', () => {
  it('publishes and stops a personal athlete frame on the dedicated ephemeral endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await publishClubLiveScreenFrame(frame);
    await stopClubLiveScreenFrame(frame, { keepalive: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/club-live/frames', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(frame),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/club-live/frames', expect.objectContaining({
      method: 'DELETE',
      keepalive: true,
      body: JSON.stringify({
        clubId: 'club-1',
        studioRiderId: 'rider-1',
        sessionId: 'race-session-1',
      }),
    }));
  });

  it('binds tablet frames and cleanup to the short-lived athlete session', async () => {
    tabletToken = 'tablet-athlete-session-token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await publishClubLiveScreenFrame(frame);
    await stopClubLiveScreenFrame(frame);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-TrackLab-Club-Tablet-Session': tabletToken,
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'X-TrackLab-Club-Tablet-Session': tabletToken },
      body: JSON.stringify({
        clubId: 'club-1',
        studioRiderId: 'rider-1',
        sessionId: 'race-session-1',
      }),
    });
  });

  it('binds tablet telemetry cleanup to the exact activity session', async () => {
    tabletToken = 'tablet-athlete-session-token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stopped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await stopClubLiveSession(frame, { keepalive: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/club-tablet/live', expect.objectContaining({
      method: 'DELETE',
      keepalive: true,
      headers: expect.objectContaining({ 'X-TrackLab-Club-Tablet-Session': tabletToken }),
      body: JSON.stringify({ sessionId: 'race-session-1' }),
    }));
  });

  it('fails closed when the server rejects frame authorization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Owner only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(publishClubLiveScreenFrame(frame)).rejects.toEqual(
      expect.objectContaining<Partial<ClubLiveRequestError>>({
        name: 'ClubLiveRequestError',
        status: 403,
        message: 'Owner only',
      }),
    );
  });
});
