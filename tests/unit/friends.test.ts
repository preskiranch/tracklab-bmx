import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FriendsView, friendGhostDetail, friendInviteTokenFromHref } from '../../src/components/FriendsView';
import {
  clearQueuedFriendRequests,
  createFriendsApi,
  flushQueuedFriendRequests,
  friendSearchMatches,
  normalizeFriendInviteMetadataList,
  normalizeFriendPrivacy,
  normalizeFriendGhostPreview,
  normalizeFriendProfile,
  officialFriendLabel,
  queueFriendRequest,
  readQueuedFriendRequests,
  subscribeToFriendNetworkEvents,
  type FriendProfile,
  type FriendsApi,
} from '../../src/lib/friends';

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
    })).toMatchObject({
      id: 'backend-rider',
      handle: 'backend.handle',
      officialKind: 'club',
    });
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
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const api = createFriendsApi(fetcher);

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
    ]));
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

  it('subscribes to generic friend invalidations and refreshes again after reconnect', () => {
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
      close = vi.fn();

      constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        this.listeners.get(type)?.delete(listener);
      }

      dispatch(type: string) {
        this.listeners.get(type)?.forEach((listener) => {
          const event = { type } as Event;
          if (typeof listener === 'function') listener(event);
          else listener.handleEvent(event);
        });
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const invalidated = vi.fn();
    const unsubscribe = subscribeToFriendNetworkEvents(invalidated);
    const stream = FakeEventSource.instances[0];

    expect(stream?.url).toBe('/api/friends/events');
    stream?.dispatch('open');
    stream?.dispatch('graph-invalidated');
    expect(invalidated).toHaveBeenCalledTimes(2);

    unsubscribe();
    stream?.dispatch('graph-invalidated');
    expect(invalidated).toHaveBeenCalledTimes(2);
    expect(stream?.close).toHaveBeenCalledOnce();
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

  it('renders an accessible default-off discovery control and the four network sections', () => {
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
    const markup = renderToStaticMarkup(createElement(FriendsView, { currentProfileId: 'me', api, initialTab: 'invite' }));

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('Appear in rider search and trusted suggestions');
    expect(markup).toContain('A friend connection does not unlock private rides, live location, or training history');
    expect(markup).toContain('Blocked riders');
    expect(markup).toContain('>Friends<');
    expect(markup).toContain('>Requests<');
    expect(markup).toContain('>Suggestions<');
    expect(markup).toContain('>Invite<');
    expect(markup).toContain('0 active invitation links');
    expect(markup).toContain('Revoke all links');
    expect(markup.match(/role="tab"/g)).toHaveLength(4);
    expect(markup.match(/aria-controls="friends-panel"/g)).toHaveLength(4);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(markup).toContain('id="friends-panel"');
    expect(markup).not.toMatch(/(?:aria-controls|id)="friends-panel-(?:friends|requests|suggestions|invite)"/);
  });

  it('keeps Friends touch targets at least 44px on coarse pointers and narrow screens', () => {
    const css = readFileSync(new URL('../../src/components/FriendsView.css', import.meta.url), 'utf8');

    expect(css).toContain('@media (any-pointer: coarse), (max-width: 580px)');
    expect(css).toMatch(/\.friends-view button,\s*\.friends-view summary\s*{[^}]*min-height:\s*44px;/);
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
