import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import {
  FriendsView,
  friendCanTalkLive,
  friendGhostDetail,
  friendInviteTokenFromHref,
  preloadFriendsView,
} from '../../src/components/FriendsView';
import {
  clearQueuedFriendRequests,
  createFriendsApi,
  flushQueuedFriendRequests,
  friendSearchMatches,
  normalizeFriendInviteMetadataList,
  normalizeFriendPrivacy,
  normalizeFriendGhostPreview,
  normalizeFriendPage,
  normalizeFriendProfile,
  officialFriendLabel,
  queueFriendRequest,
  readQueuedFriendRequests,
  subscribeToFriendNetworkEvents,
  type FriendProfile,
  type FriendsApi,
} from '../../src/lib/friends';
import {
  createLiveFriendAudioApi,
  normalizeLiveFriendAudioInviteList,
  normalizeLiveFriendAudioInviteResponse,
} from '../../src/lib/liveFriendAudio';
import {
  createTrackSharesApi,
  normalizeTrackShare,
  type TrackSharesApi,
} from '../../src/lib/trackShares';

function profile(overrides: Partial<FriendProfile> = {}): FriendProfile {
  return {
    id: 'rider-1',
    handle: 'fast.rider',
    displayName: 'Fast Rider',
    online: false,
    available: false,
    hasGhost: true,
    mutualFriendCount: 2,
    relationship: 'none',
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function storageWindow() {
  const entries = new Map<string, string>();
  return {
    entries,
    window: {
      location: { origin: 'https://tracklab.test' },
      localStorage: {
        getItem: vi.fn((key: string) => entries.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
        removeItem: vi.fn((key: string) => entries.delete(key)),
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TrackLab friends client', () => {
  it('normalizes public rider fields without carrying emails or unsafe image data', () => {
    const normalized = normalizeFriendProfile({
      id: ' rider-1 ',
      handle: '@fast rider!',
      displayName: ' Fast Rider ',
      email: 'must-not-render@example.com',
      photoUrl: 'data:text/html;base64,PHNjcmlwdD4=',
      online: 1,
      mutualFriendCount: -12,
      relationship: 'outgoing-request',
      officialKind: 'founder',
    });

    expect(normalized).toEqual({
      id: 'rider-1',
      handle: 'fastrider',
      displayName: 'Fast Rider',
      online: true,
      available: false,
      hasGhost: false,
      mutualFriendCount: 0,
      relationship: 'outgoing-request',
      officialKind: 'founder',
    });
    expect(normalized).not.toHaveProperty('email');
    expect(normalizeFriendProfile({
      profileId: 'backend-rider',
      username: 'backend.handle',
      displayName: 'Backend Rider',
      officialType: 'club',
      canShareTrack: true,
    })).toMatchObject({
      id: 'backend-rider',
      handle: 'backend.handle',
      officialKind: 'club',
      canShareTrack: true,
    });
  });

  it('normalizes a truthful online total without exceeding the visible friend total', () => {
    expect(normalizeFriendPage({
      items: [
        profile({ id: 'online-rider', online: true }),
        profile({ id: 'offline-rider', online: false }),
      ],
      total: 2,
      onlineTotal: 99,
    })).toMatchObject({ total: 2, onlineTotal: 2 });

    expect(normalizeFriendPage({
      items: [profile({ online: true })],
      total: 4,
    }).onlineTotal).toBe(0);
  });

  it('normalizes received track shares without retaining private or executable sender fields', () => {
    const normalized = normalizeTrackShare({
      id: ' share-1 ',
      trackId: 'usabmx:oak-mountain',
      trackName: ' Oak Mountain BMX ',
      trackLocation: '<b>Pelham, Alabama</b>',
      sender: {
        id: ' friend-1 ',
        handle: '@friend rider!',
        displayName: ' Friend Rider ',
        photoUrl: 'javascript:alert(1)',
        email: 'private@example.com',
        liveLocation: { latitude: 1, longitude: 2 },
      },
      createdAt: '2026-08-23T20:00:00.000Z',
      openedAt: null,
      heartRate: 190,
    });

    expect(normalized).toEqual({
      id: 'share-1',
      trackId: 'usabmx:oak-mountain',
      trackName: 'Oak Mountain BMX',
      trackLocation: '<b>Pelham, Alabama</b>',
      sender: {
        id: 'friend-1',
        handle: 'friendrider',
        displayName: 'Friend Rider',
      },
      createdAt: '2026-08-23T20:00:00.000Z',
      openedAt: null,
    });
    expect(normalized?.sender).not.toHaveProperty('email');
    expect(normalized).not.toHaveProperty('heartRate');
    expect(normalizeTrackShare({
      id: 'bad-share',
      trackId: 'javascript:alert(1)',
      trackName: 'Unsafe',
      sender: { id: 'friend-1', handle: 'friend', displayName: 'Friend' },
      createdAt: '2026-08-23T20:00:00.000Z',
    })).toBeNull();
  });

  it('uses the received track-share contract for list, send, open, and dismiss', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; keepalive: boolean }> = [];
    const item = {
      id: 'share-1',
      trackId: 'usabmx:oak-mountain',
      trackName: 'Oak Mountain BMX',
      trackLocation: 'Pelham, Alabama',
      sender: { id: 'friend-1', handle: 'friend.one', displayName: 'Friend One' },
      createdAt: '2026-08-23T20:00:00.000Z',
      openedAt: null,
    };
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        keepalive: init?.keepalive === true,
      });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'POST' && url.endsWith('/open')) {
        return jsonResponse({ share: { ...item, openedAt: '2026-08-23T20:01:00.000Z' } });
      }
      if (method === 'POST') return jsonResponse({ share: item });
      return jsonResponse({ items: [item], nextCursor: 'next', total: 4, unreadTotal: 3 });
    }) as unknown as typeof fetch;
    const api = createTrackSharesApi(fetcher);

    expect(await api.listReceived({ cursor: 'cursor-1', limit: 9, unread: true })).toMatchObject({
      items: [expect.objectContaining({ id: 'share-1', trackId: 'usabmx:oak-mountain' })],
      nextCursor: 'next',
      total: 4,
      unreadTotal: 3,
    });
    await api.send('friend-1', 'usabmx:oak-mountain', 'request-1');
    await api.markOpened('share-1');
    await api.dismiss('share-1');

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: '/api/friends/track-shares?cursor=cursor-1&unread=1&limit=9',
        method: 'GET',
      }),
      expect.objectContaining({
        url: '/api/friends/track-shares',
        method: 'POST',
        body: {
          recipientProfileId: 'friend-1',
          trackId: 'usabmx:oak-mountain',
          clientRequestId: 'request-1',
        },
      }),
      expect.objectContaining({
        url: '/api/friends/track-shares/share-1/open',
        method: 'POST',
        keepalive: true,
      }),
      expect.objectContaining({ url: '/api/friends/track-shares/share-1', method: 'DELETE' }),
    ]));
  });

  it('keeps only the race setup fields from an authorized friend ghost preview', () => {
    const ghostPreview = normalizeFriendGhostPreview({
      id: ' friend-ghost-1 ',
      trackId: 'track-1',
      trackName: 'Track One',
      routeVariantId: 'pro',
      lapCount: 3,
      sprintDistanceFeet: 500,
      sprintAirSetting: 5,
      finishTimeMs: 12_345,
      summary: { averageWatts: 900 },
      points: [{ elapsedMs: 0 }],
      email: 'private@example.com',
    });

    expect(ghostPreview).toEqual({
      id: 'friend-ghost-1',
      trackId: 'track-1',
      trackName: 'Track One',
      routeVariantId: 'pro',
      lapCount: 3,
      sprintDistanceFeet: 500,
      sprintAirSetting: 5,
      finishTimeMs: 12_345,
    });
    expect(ghostPreview).not.toHaveProperty('summary');
    expect(ghostPreview).not.toHaveProperty('points');
    expect(normalizeFriendProfile({
      id: 'friend-1',
      handle: 'friend.one',
      displayName: 'Friend One',
      hasGhost: true,
      ghostPreview,
      relationship: 'friend',
    })).toMatchObject({ hasGhost: true, ghostPreview });
    expect(normalizeFriendProfile({
      id: 'friend-2',
      handle: 'friend.two',
      displayName: 'Friend Two',
      hasGhost: true,
      ghostPreview: { id: 'broken' },
    })).toMatchObject({ hasGhost: false });
    expect(friendGhostDetail(ghostPreview!, 'm')).toBe('Recent ghost · Track One · 12.35s · 152 m · Air 5');
  });

  it('matches names and handles and labels official default friends', () => {
    const rider = profile();
    expect(friendSearchMatches(rider, '@FAST')).toBe(true);
    expect(friendSearchMatches(rider, 'rider')).toBe(true);
    expect(friendSearchMatches(rider, 'other')).toBe(false);
    expect(officialFriendLabel('club')).toBe('Official TrackLab club');
    expect(officialFriendLabel('founder')).toBe('TrackLab founder');
  });

  it('offers live audio only to online, explicitly accepted, non-official friends', () => {
    const eligible = profile({
      online: true,
      relationship: 'friend',
      canTalkLive: true,
    });

    expect(friendCanTalkLive(eligible)).toBe(true);
    expect(friendCanTalkLive({ ...eligible, online: false })).toBe(false);
    expect(friendCanTalkLive({ ...eligible, relationship: 'none' })).toBe(false);
    expect(friendCanTalkLive({ ...eligible, officialKind: 'club' })).toBe(false);
    expect(friendCanTalkLive({ ...eligible, canTalkLive: false, canShareTrack: false })).toBe(false);
    expect(friendCanTalkLive({ ...eligible, canTalkLive: undefined, canShareTrack: true })).toBe(false);
  });

  it('normalizes short-lived live audio invitations without private sender fields', () => {
    expect(normalizeLiveFriendAudioInviteList({
      invites: [{
        id: ' invite-new ',
        from: {
          id: ' friend-1 ',
          displayName: ' Friend One ',
          handle: '@friend one!',
          photoUrl: 'javascript:alert(1)',
          email: 'private@example.com',
        },
        createdAt: '2026-08-24T20:00:01.000Z',
        expiresAt: '2026-08-24T20:01:31.000Z',
        roomId: 'must-not-survive',
      }, {
        id: 'invite-old',
        from: { id: 'friend-2', displayName: 'Friend Two', handle: 'friend.two' },
        createdAt: '2026-08-24T20:00:00.000Z',
        expiresAt: '2026-08-24T20:01:30.000Z',
      }, {
        id: 'invite-invalid',
        from: { id: 'friend-3', displayName: 'Friend Three', handle: 'friend.three' },
        createdAt: 'not-a-date',
        expiresAt: 9e20,
      }],
    })).toEqual([{
      id: 'invite-new',
      from: { id: 'friend-1', displayName: 'Friend One', handle: 'friendone' },
      createdAt: '2026-08-24T20:00:01.000Z',
      expiresAt: '2026-08-24T20:01:31.000Z',
    }, {
      id: 'invite-old',
      from: { id: 'friend-2', displayName: 'Friend Two', handle: 'friend.two' },
      createdAt: '2026-08-24T20:00:00.000Z',
      expiresAt: '2026-08-24T20:01:30.000Z',
    }]);
    expect(normalizeLiveFriendAudioInviteResponse({ accepted: false, roomId: 'hidden-room' }))
      .toEqual({ accepted: false });
    expect(normalizeLiveFriendAudioInviteResponse({ accepted: true, roomId: ' room-1 ' }))
      .toEqual({ accepted: true, roomId: 'room-1' });
    expect(() => normalizeLiveFriendAudioInviteResponse({ accepted: true }))
      .toThrow(/without opening its private room/i);
  });

  it('accepts the canonical and legacy friend invitation URL formats', () => {
    expect(friendInviteTokenFromHref('https://tracklab.test/?friendInvite=canonical-token')).toBe('canonical-token');
    expect(friendInviteTokenFromHref('https://tracklab.test/friends/invite?token=legacy-token')).toBe('legacy-token');
    expect(friendInviteTokenFromHref('https://tracklab.test/explore?token=not-a-friend-token')).toBe('');
  });

  it('uses the durable account endpoints, direction-specific requests, and search q parameter', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('/api/friends/requests?')) {
        const direction = new URL(url, 'https://tracklab.test').searchParams.get('direction');
        return jsonResponse({
          items: [{ id: `${direction}-1`, profile: profile({ id: `${direction}-rider` }), createdAt: '2026-01-01T00:00:00Z' }],
          total: direction === 'incoming' ? 3 : 2,
          nextCursor: `${direction}-cursor`,
        });
      }
      if (url.includes('/api/friends/search?')) {
        return jsonResponse({ items: [profile({ relationship: 'friend' })], total: 1, nextCursor: null });
      }
      if (url.includes('/api/friends/blocks?')) {
        return jsonResponse({ items: [{ profileId: 'blocked-1', username: 'blocked.rider', displayName: 'Blocked Rider' }], total: 1, nextCursor: null });
      }
      if (url === '/api/friends/invites' && method === 'GET') {
        return jsonResponse({ invites: [{ id: 'active-invite', createdAt: '2026-08-20T12:00:00.000Z', expiresAt: '2026-08-27T12:00:00.000Z' }] });
      }
      if (url === '/api/friends/invites' && method === 'POST') {
        return jsonResponse({ invite: { inviteId: 'invite-abc', inviteUrl: 'https://tracklab.test/join?friendInvite=abc', qrCodeUrl: 'https://tracklab.test/api/qr/abc', expiresAt: null } });
      }
      if (url === '/api/friends/privacy') {
        return jsonResponse({ privacy: { discoverable: method === 'PATCH', profile: { id: 'me', handle: 'my.handle', displayName: 'Me' } } });
      }
      if (url === '/api/friends/live-audio-invites' && method === 'GET') {
        return jsonResponse({
          invites: [{
            id: 'live-invite-1',
            from: { id: 'friend-1', displayName: 'Friend One', handle: 'friend.one' },
            createdAt: '2026-08-24T20:00:00.000Z',
            expiresAt: '2026-08-24T20:01:30.000Z',
          }],
        });
      }
      if (url.endsWith('/respond') && method === 'POST') {
        const accepted = JSON.parse(String(init?.body)).accepted === true;
        return jsonResponse(accepted ? { accepted: true, roomId: 'live-room-1' } : { accepted: false });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const api = createFriendsApi(fetcher);
    const liveAudioApi = createLiveFriendAudioApi(fetcher);

    const requests = await api.listRequests({ limit: 1 });
    expect(requests.incomingTotal).toBe(3);
    expect(requests.outgoingTotal).toBe(2);
    expect(requests.incoming[0]?.direction).toBe('incoming');
    expect(requests.incoming[0]?.profile.relationship).toBe('incoming-request');
    expect(requests.outgoingNextCursor).toBe('outgoing-cursor');

    const search = await api.listSuggestions({ query: '@fast rider', limit: 10 });
    expect(search.items[0]?.profile.relationship).toBe('friend');
    expect(calls.some((call) => call.url.includes('/api/friends/search?') && call.url.includes('q=%40fast+rider'))).toBe(true);

    expect(await api.listActiveInvites()).toEqual([{
      id: 'active-invite',
      createdAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-27T12:00:00.000Z',
    }]);
    expect((await api.getInvite()).inviteUrl).toContain('friendInvite=abc');
    await api.revokeInvite('invite-abc');
    expect(calls).toContainEqual(expect.objectContaining({ url: '/api/friends/invites/invite-abc', method: 'DELETE' }));
    expect(await api.revokeAllInvites()).toBe(0);
    expect((await api.getPrivacy()).profile?.handle).toBe('my.handle');
    expect((await api.updatePrivacy(true)).discoverable).toBe(true);
    expect((await api.listBlocked()).items[0]).toMatchObject({ id: 'blocked-1', relationship: 'blocked' });
    expect((await liveAudioApi.listLiveAudioInvites())[0]).toMatchObject({
      id: 'live-invite-1',
      from: { id: 'friend-1', displayName: 'Friend One' },
    });
    expect(await liveAudioApi.respondToLiveAudioInvite('live-invite-1', true))
      .toEqual({ accepted: true, roomId: 'live-room-1' });
    expect(await liveAudioApi.respondToLiveAudioInvite('live-invite-1', false))
      .toEqual({ accepted: false });
    await liveAudioApi.cancelLiveAudioInvite('live-invite-1');

    await api.sendFriendRequest('rider-2', 'client-1');
    await api.cancelFriendRequest('request-2');
    await api.unfriend('rider-3');
    await api.blockProfile('rider-4');
    await api.unblockProfile('rider-4');
    await api.reportProfile('rider-5', 'spam');
    await api.claimInvite('secure-token');

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: '/api/friends/requests', method: 'POST', body: { profileId: 'rider-2', clientRequestId: 'client-1' } }),
      expect.objectContaining({ url: '/api/friends/requests/request-2/cancel', method: 'POST' }),
      expect.objectContaining({ url: '/api/friends/rider-3', method: 'DELETE' }),
      expect.objectContaining({ url: '/api/friends/blocks', method: 'POST', body: { profileId: 'rider-4' } }),
      expect.objectContaining({ url: '/api/friends/blocks/rider-4', method: 'DELETE' }),
      expect.objectContaining({ url: '/api/friends/reports', method: 'POST', body: { profileId: 'rider-5', reason: 'spam' } }),
      expect.objectContaining({ url: '/api/friends/invites/claim', method: 'POST', body: { token: 'secure-token' } }),
      expect.objectContaining({ url: '/api/friends/live-audio-invites', method: 'GET' }),
      expect.objectContaining({
        url: '/api/friends/live-audio-invites/live-invite-1/respond',
        method: 'POST',
        body: { accepted: true },
      }),
      expect.objectContaining({
        url: '/api/friends/live-audio-invites/live-invite-1/respond',
        method: 'POST',
        body: { accepted: false },
      }),
      expect.objectContaining({ url: '/api/friends/live-audio-invites/live-invite-1', method: 'DELETE' }),
    ]));
  });

  it('warms and deduplicates the primary Friends hub data for instant remounts', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), 'https://tracklab.test');
      if (url.pathname === '/api/friends') {
        return jsonResponse({ items: [profile({ relationship: 'friend' })], total: 1, nextCursor: null });
      }
      if (url.pathname === '/api/friends/requests') {
        return jsonResponse({ items: [], total: 0, nextCursor: null });
      }
      if (url.pathname === '/api/friends/privacy') {
        return jsonResponse({ privacy: { discoverable: false, profile: { id: 'me', handle: 'me', displayName: 'Me' } } });
      }
      throw new Error(`Unexpected preload request: ${url.pathname}`);
    });
    const api = createFriendsApi(fetcher as unknown as typeof fetch);
    const sharesApi: TrackSharesApi = {
      listReceived: vi.fn(async () => ({ ...blankTrackShares, unreadTotal: 2 })),
      send: vi.fn(),
      markOpened: vi.fn(),
      dismiss: vi.fn(),
    };

    const first = preloadFriendsView('me', api, false, sharesApi);
    const concurrent = preloadFriendsView('me', api, false, sharesApi);
    await Promise.all([first, concurrent]);
    const warm = await preloadFriendsView('me', api, false, sharesApi);

    expect(warm.trackSharePage.unreadTotal).toBe(2);
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input), 'https://tracklab.test').pathname)).toEqual([
      '/api/friends',
      '/api/friends/requests',
      '/api/friends/privacy',
    ]);
    expect(new URL(String(fetcher.mock.calls[1]?.[0]), 'https://tracklab.test').searchParams.get('direction')).toBe('incoming');
    const markup = renderToStaticMarkup(createElement(FriendsView, {
      currentProfileId: 'me',
      api,
      trackSharesApi: sharesApi,
    }));
    expect(markup).toContain('Fast Rider');
    expect(markup).not.toContain('Loading riders');
    await preloadFriendsView('another-account', api, false, sharesApi);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(2);
  });

  it('renders Talk live as a primary action only for eligible online friends', async () => {
    const friends = [
      profile({ id: 'online-friend', displayName: 'Online Friend', online: true, relationship: 'friend', canTalkLive: true }),
      profile({ id: 'offline-friend', displayName: 'Offline Friend', online: false, relationship: 'friend', canTalkLive: true }),
      profile({ id: 'official-friend', displayName: 'Official Friend', online: true, relationship: 'friend', canTalkLive: true, officialKind: 'club' }),
      profile({ id: 'suggested-rider', displayName: 'Suggested Rider', online: true, relationship: 'none', canTalkLive: true }),
    ];
    const api = {
      listFriends: vi.fn(async () => ({ items: friends, nextCursor: null, total: friends.length })),
      listRequests: vi.fn(async () => blankRequests),
      getPrivacy: vi.fn(async () => ({ discoverable: false, profile: null })),
    } as unknown as FriendsApi;
    const sharesApi: TrackSharesApi = {
      listReceived: vi.fn(async () => blankTrackShares),
      send: vi.fn(),
      markOpened: vi.fn(),
      dismiss: vi.fn(),
    };
    await preloadFriendsView('talk-live-me', api, true, sharesApi);

    const markup = renderToStaticMarkup(createElement(FriendsView, {
      currentProfileId: 'talk-live-me',
      api,
      trackSharesApi: sharesApi,
      onTalkLive: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Talk live with Online Friend"');
    expect(markup).not.toContain('aria-label="Talk live with Offline Friend"');
    expect(markup).not.toContain('aria-label="Talk live with Official Friend"');
    expect(markup).not.toContain('aria-label="Talk live with Suggested Rider"');
  });

  it('queues one fresh shared-track read when invalidation arrives during an older request', async () => {
    const api = {
      listFriends: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      listRequests: vi.fn(async () => blankRequests),
      getPrivacy: vi.fn(async () => ({ discoverable: false, profile: null })),
    } as unknown as FriendsApi;
    let resolveOld = (_page: typeof blankTrackShares) => undefined;
    const oldPage = new Promise<typeof blankTrackShares>((resolve) => { resolveOld = resolve; });
    const newPage = { ...blankTrackShares, unreadTotal: 1, total: 1 };
    const sharesApi: TrackSharesApi = {
      listReceived: vi.fn()
        .mockImplementationOnce(() => oldPage)
        .mockResolvedValue(newPage),
      send: vi.fn(),
      markOpened: vi.fn(),
      dismiss: vi.fn(),
    };

    const oldLoad = preloadFriendsView('refresh-rider', api, false, sharesApi);
    const forcedLoad = preloadFriendsView('refresh-rider', api, true, sharesApi);
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(1);
    resolveOld(blankTrackShares);

    await expect(oldLoad).resolves.toMatchObject({ trackSharePage: { unreadTotal: 0 } });
    await expect(forcedLoad).resolves.toMatchObject({ trackSharePage: { unreadTotal: 1 } });
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(2);
    await expect(preloadFriendsView('refresh-rider', api, false, sharesApi))
      .resolves.toMatchObject({ trackSharePage: { unreadTotal: 1 } });
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(2);
  });

  it('queues another shared-track read when a second invalidation arrives during refresh', async () => {
    const api = {
      listFriends: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      listRequests: vi.fn(async () => blankRequests),
      getPrivacy: vi.fn(async () => ({ discoverable: false, profile: null })),
    } as unknown as FriendsApi;
    let resolveFirst = (_page: typeof blankTrackShares) => undefined;
    const firstPage = new Promise<typeof blankTrackShares>((resolve) => { resolveFirst = resolve; });
    const newestPage = { ...blankTrackShares, unreadTotal: 2, total: 2 };
    const sharesApi: TrackSharesApi = {
      listReceived: vi.fn().mockImplementationOnce(() => firstPage).mockResolvedValue(newestPage),
      send: vi.fn(),
      markOpened: vi.fn(),
      dismiss: vi.fn(),
    };

    const first = preloadFriendsView('refresh-burst-rider', api, true, sharesApi);
    const trailing = preloadFriendsView('refresh-burst-rider', api, true, sharesApi);
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(1);
    resolveFirst(blankTrackShares);

    await expect(first).resolves.toMatchObject({ trackSharePage: { unreadTotal: 0 } });
    await expect(trailing).resolves.toMatchObject({ trackSharePage: { unreadTotal: 2 } });
    expect(sharesApi.listReceived).toHaveBeenCalledTimes(2);
  });

  it('keeps discoverability off unless the server explicitly opts the rider in', () => {
    expect(normalizeFriendPrivacy({})).toEqual({ discoverable: false, profile: null });
    expect(normalizeFriendPrivacy({
      privacy: true,
      discoverable: true,
      id: 'me',
      handle: '@rider.me',
      displayName: 'Rider Me',
      email: 'private@example.com',
    })).toEqual({
      discoverable: true,
      profile: { id: 'me', handle: 'rider.me', displayName: 'Rider Me' },
    });
  });

  it('normalizes active invite metadata without retaining token, hash, or URL fields', () => {
    expect(normalizeFriendInviteMetadataList({
      invites: [{
        id: 'invite-safe',
        createdAt: '2026-08-20T12:00:00.000Z',
        expiresAt: '2026-08-27T12:00:00.000Z',
        token: 'must-not-survive',
        tokenHash: 'must-not-survive',
        inviteUrl: 'https://tracklab.test/?friendInvite=must-not-survive',
      }, {
        id: 'invite-invalid',
        createdAt: 'not-a-date',
        expiresAt: '2026-08-27T12:00:00.000Z',
      }],
    })).toEqual([{
      id: 'invite-safe',
      createdAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-27T12:00:00.000Z',
    }]);
  });

  it('subscribes to generic friend invalidations over authenticated fetch streaming', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    const invalidated = vi.fn();
    const unsubscribe = subscribeToFriendNetworkEvents(invalidated);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      '/api/friends/events',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
      }),
    ));
    streamController!.enqueue(new TextEncoder().encode([
      'event: graph-invalidated\ndata: {}\n\n',
      'event: track-shares-invalidated\ndata: {}\n\n',
      'event: live-audio-invites-invalidated\ndata: {}\n\n',
    ].join('')));
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledTimes(4));
    expect(invalidated).toHaveBeenCalledTimes(4);

    unsubscribe();
    expect(invalidated).toHaveBeenCalledTimes(4);
  });

  it('scopes offline requests by account and retries only transient failures', async () => {
    const { window } = storageWindow();
    vi.stubGlobal('window', window);
    queueFriendRequest('owner-a', 'retry-rider', 'retry-client');
    queueFriendRequest('owner-a', 'blocked-rider', 'blocked-client');
    queueFriendRequest('owner-b', 'other-rider', 'other-client');

    const api = createFriendsApi(vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { profileId: string };
      return body.profileId === 'retry-rider'
        ? jsonResponse({ error: 'Try later' }, 503)
        : jsonResponse({ error: 'Cannot add this rider' }, 403);
    }) as unknown as typeof fetch);
    const result = await flushQueuedFriendRequests('owner-a', api);

    expect(result.sent).toBe(0);
    expect(result.remaining.map((request) => request.targetProfileId)).toEqual(['retry-rider']);
    expect(readQueuedFriendRequests('owner-b').map((request) => request.targetProfileId)).toEqual(['other-rider']);
    clearQueuedFriendRequests('owner-a');
    expect(readQueuedFriendRequests('owner-a')).toEqual([]);
  });

  it('renders an accessible default-off discovery control and the five network sections', () => {
    const api: FriendsApi = {
      listFriends: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      listRequests: vi.fn(async () => ({ ...blankRequests })),
      listSuggestions: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      listBlocked: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      listActiveInvites: vi.fn(async () => []),
      getInvite: vi.fn(async () => ({ id: 'invite-1', inviteUrl: 'https://tracklab.test/invite', qrCodeUrl: 'https://tracklab.test/qr', expiresAt: null })),
      revokeInvite: vi.fn(async () => undefined),
      revokeAllInvites: vi.fn(async () => 0),
      getPrivacy: vi.fn(async () => ({ discoverable: false, profile: { id: 'me', handle: 'my.handle', displayName: 'Me' } })),
      updatePrivacy: vi.fn(async () => ({ discoverable: false, profile: null })),
      claimInvite: vi.fn(async () => undefined),
      sendFriendRequest: vi.fn(async () => undefined),
      acceptFriendRequest: vi.fn(async () => undefined),
      declineFriendRequest: vi.fn(async () => undefined),
      cancelFriendRequest: vi.fn(async () => undefined),
      unfriend: vi.fn(async () => undefined),
      blockProfile: vi.fn(async () => undefined),
      unblockProfile: vi.fn(async () => undefined),
      reportProfile: vi.fn(async () => undefined),
    };
    const trackSharesApi: TrackSharesApi = {
      listReceived: vi.fn(async () => blankTrackShares),
      send: vi.fn(),
      markOpened: vi.fn(),
      dismiss: vi.fn(),
    };
    const markup = renderToStaticMarkup(createElement(FriendsView, {
      currentProfileId: 'me',
      api,
      trackSharesApi,
      initialTab: 'invite',
    }));

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Appear in rider search and trusted suggestions');
    expect(markup).toContain('A friend connection does not unlock private rides, live location, or training history');
    expect(markup).toContain('Explicitly accepted friends can see when you are online');
    expect(markup).toContain('An auto-added official connection cannot see an ordinary rider');
    expect(markup).toContain('Blocked riders');
    expect(markup).toContain('>Friends<');
    expect(markup).toContain('>Requests<');
    expect(markup).toContain('>Suggestions<');
    expect(markup).toContain('>Shared tracks<');
    expect(markup).toContain('>Invite<');
    expect(markup).toContain('0 active invitation links');
    expect(markup).toContain('Revoke all links');
    expect(markup.match(/role="tab"/g)).toHaveLength(5);
    expect(markup.match(/aria-controls="friends-panel"/g)).toHaveLength(5);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(4);
    expect(markup).toContain('id="friends-panel"');
    expect(markup).not.toMatch(/(?:aria-controls|id)="friends-panel-(?:friends|requests|suggestions|invite)"/);
  });

  it('keeps Friends touch targets at least 44px on coarse pointers and narrow screens', () => {
    const css = readFileSync(new URL('../../src/components/FriendsView.css', import.meta.url), 'utf8');

    expect(css).toContain('@media (any-pointer: coarse), (max-width: 580px)');
    expect(css).toMatch(/\.friends-view button,\s*\.friends-view summary\s*{[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.friend-track-share-actions > a,[\s\S]*?\.friend-track-share-actions > button\s*{[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.friends-privacy-note \.friends-privacy-switch,\s*\.friends-privacy-note \.friends-privacy-switch\.on\s*{[^}]*height:\s*44px;[^}]*width:\s*52px;/);
  });
});

const blankRequests = {
  incoming: [],
  outgoing: [],
  incomingTotal: 0,
  outgoingTotal: 0,
  incomingNextCursor: null,
  outgoingNextCursor: null,
  total: 0,
};

const blankTrackShares = {
  items: [],
  nextCursor: null,
  total: 0,
  unreadTotal: 0,
};
