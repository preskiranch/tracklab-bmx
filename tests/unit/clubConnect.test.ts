import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clubConnectRequestIsCurrent,
  loadClubConnect,
} from '../../src/lib/clubConnect';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Club Connect access state', () => {
  it('rejects responses from an older request or a different signed-in profile', () => {
    expect(clubConnectRequestIsCurrent('profile-a', 2, 'profile-a', 2)).toBe(true);
    expect(clubConnectRequestIsCurrent('profile-a', 1, 'profile-a', 2)).toBe(false);
    expect(clubConnectRequestIsCurrent('profile-a', 2, 'profile-b', 2)).toBe(false);
    expect(clubConnectRequestIsCurrent('profile-a', 2, null, 2)).toBe(false);
  });

  it('defaults roster management to denied when the server does not explicitly grant it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ownedClub: { id: 'club-1', name: 'Studio', members: [] },
      memberships: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(loadClubConnect()).resolves.toMatchObject({
      canManageClub: false,
      memberships: [],
    });
  });

  it('enables roster controls only when the server explicitly grants management', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      canManageClub: true,
      ownedClub: { id: 'club-1', name: 'Studio', members: [] },
      memberships: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(loadClubConnect()).resolves.toMatchObject({
      canManageClub: true,
      ownedClub: { name: 'Studio' },
    });
  });
});
