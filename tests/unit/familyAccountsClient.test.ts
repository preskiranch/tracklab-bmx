import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FamilyRequestError, acceptFamilyInvitation, claimFamilyClubInvitation, clearFamilyInviteFromUrl,
  createFamilyChild, createFamilyInvitation, familyClubInviteToken, familyInviteTokenFromHref,
  loadFamily, loadFamilyHistory, loadFamilyProfile, normalizeFamilyChild, normalizeFamilyHistory,
  normalizeFamilyProfile, previewFamilyInvitation, removeFamilyChild, revokeFamilyInvitation,
  revokeFamilyShare, restoreFamilyChild,
} from '../../src/lib/familyAccounts';

const token = 'q'.repeat(43);
const childId = 'child-one';
const permissions = { activity: true, health: false };
const child = { id: childId, kind: 'managed', name: 'Athlete One', createdAt: 100, updatedAt: 200, permissions };
const invite = { id: 'invitation-one', expiresAt: 5_000, claimedAt: null, revokedAt: null };
const session = {
  id: 'race-one', activityType: 'bmx-race', title: 'BMX Race',
  startedAt: 1_000, endedAt: 3_000, durationMs: 2_000, distanceMeters: 100,
  source: 'live', createdAt: 1_000, updatedAt: 3_000,
  details: { summaries: [{ riderId: 'rider-one', riderName: 'Athlete One', averageWatts: 420, topCadence: 145 }] },
};
const profile = { child, accountProfile: { updatedAt: 200 }, memberships: [], healthAvailable: false };

function reply(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('family invitation credentials', () => {
  it('reads family invitations from the fragment without accepting query credentials or malformed tokens', () => {
    expect(familyInviteTokenFromHref(`https://tracklab-bmx.onrender.com/#familyInvite=${token}`)).toBe(token);
    for (const href of [
      `https://tracklab-bmx.onrender.com/?familyInvite=${token}`,
      `https://tracklab-bmx.onrender.com/#familyInvite=${'a'.repeat(42)}`,
      `https://tracklab-bmx.onrender.com/#familyInvite=${'a'.repeat(44)}`,
      `https://tracklab-bmx.onrender.com/#familyInvite=${'a'.repeat(42)}!`,
      'not a URL',
    ]) expect(familyInviteTokenFromHref(href)).toBe('');
  });

  it('accepts copied Club Connect codes and links without mistaking a different invitation for a club claim', () => {
    for (const value of [
      `  ${token}  `,
      `https://tracklab-bmx.onrender.com/?clubInvite=${token}`,
      `https://tracklab-bmx.onrender.com/#clubInvite=${token}`,
    ]) expect(familyClubInviteToken(value)).toBe(token);
    expect(familyClubInviteToken(`https://tracklab-bmx.onrender.com/#familyInvite=${token}`)).toBe('');
    expect(familyClubInviteToken('invalid-code')).toBe('');
  });

  it('clears only the family credential while preserving other URL state and browser history', () => {
    const replaceState = vi.fn();
    const historyState = { route: 'profile' };
    vi.stubGlobal('window', {
      location: { href: `https://tracklab-bmx.onrender.com/?view=profile#familyInvite=${token}&tab=activity` },
      history: { state: historyState, replaceState },
    });
    clearFamilyInviteFromUrl();
    expect(replaceState).toHaveBeenCalledOnce();
    const [state, , url] = replaceState.mock.calls[0];
    expect(state).toBe(historyState);
    expect(String(url)).toBe('https://tracklab-bmx.onrender.com/?view=profile#tab=activity');
  });

  it('rejects invalid invitation credentials before any network request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(previewFamilyInvitation('invalid')).rejects.toThrow('invalid');
    await expect(acceptFamilyInvitation('invalid')).rejects.toThrow('invalid');
    await expect(claimFamilyClubInvitation(childId, 'invalid')).rejects.toThrow('valid Club Connect');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a link with explicit activity consent and no health consent or token in the request path', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ ok: true, parentName: 'Parent' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(acceptFamilyInvitation(token)).resolves.toEqual({ parentName: 'Parent' });
    expect(fetcher).toHaveBeenCalledWith('/api/family/link-invites/accept', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      body: JSON.stringify({ token, activityConsent: true }),
    }));
    expect(fetcher.mock.calls[0][0]).not.toContain(token);
  });

  it('does not report an invitation accepted or created when the server payload cannot confirm it', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ ok: false }))
      .mockResolvedValueOnce(reply({ invite, claimUrl: 'https://tracklab-bmx.onrender.com/#familyInvite=bad' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(acceptFamilyInvitation(token)).rejects.toThrow('could not be confirmed');
    await expect(createFamilyInvitation()).rejects.toThrow('invitation link could not be read');
  });
});

describe('family subject and privacy boundaries', () => {
  it('keeps managed and linked children distinct and rejects unverified access grants', () => {
    expect(normalizeFamilyChild(child)).toEqual(child);
    expect(normalizeFamilyChild({ ...child, kind: 'linked' }).kind).toBe('linked');
    for (const patch of [
      { id: '../another-child' }, { kind: 'owner' }, { name: '  ' },
      { permissions: { activity: true, health: true } },
      { permissions: { activity: false, health: false } },
      { permissions: { activity: true } },
    ]) expect(() => normalizeFamilyChild({ ...child, ...patch })).toThrow();
  });

  it('fails closed when a profile or history response belongs to a different sibling or allows health', () => {
    for (const patch of [
      { child: { ...child, id: 'child-two' } },
      { healthAvailable: true }, { healthAvailable: undefined },
    ]) {
      expect(() => normalizeFamilyProfile({ ...profile, ...patch }, childId)).toThrow('selected family profile');
      expect(() => normalizeFamilyHistory({ ...profile, sessions: [session], ...patch }, childId)).toThrow('selected family profile');
    }
  });

  it('allowlists family profile data so account credentials and private health fields cannot reach the view', () => {
    const raw = {
      ...profile, token: 'private-token', email: 'private@example.com', health: { bpm: 99 },
      accountProfile: { updatedAt: 200, email: 'private@example.com', appleHealth: { bpm: 98 },
        photoUrl: 'https://external.example/private-photo.jpg',
        personalRecords: { reactionTestBestMs: 180, getPulledMaxWatts: 750, restingPulse: 55 } },
      memberships: [{ clubId: 'club-one', clubName: 'BMX Club', studioRiderId: 'rider-one', riderName: 'Athlete One',
        claimedAt: 100, token: 'private-club-token', email: 'private@example.com' }],
    };
    const result = normalizeFamilyProfile(raw, childId);
    expect(result.accountProfile.personalRecords).toMatchObject({ reactionTestBestMs: 180, getPulledMaxWatts: 750 });
    expect(result.memberships[0]).toEqual({ clubId: 'club-one', clubName: 'BMX Club', studioRiderId: 'rider-one', riderName: 'Athlete One', claimedAt: 100 });
    for (const hidden of ['private-token', 'private@example.com', 'private-club-token', 'restingPulse', 'appleHealth', 'external.example']) {
      expect(JSON.stringify(result)).not.toContain(hidden);
    }
  });

  it('redacts health aliases recursively while preserving the child’s cycling metrics', () => {
    const unsafeSession = {
      ...session, appleWatch: { bpm: 200 }, heartRateSamples: [180],
      details: { summaries: [{ riderId: 'rider-one', averageWatts: 420, topCadence: 145,
        heartRate: 189, healthKit: { bpm: 190 }, restingPulse: 55,
        nested: { readings: [{ 'heart-rate': 180, hrv: 45, bloodOxygen: 98, speedKph: 32 }] } }],
        watchSessionId: 'private-watch', AppleHealth: { restingBpm: 54 } },
    };
    const result = normalizeFamilyHistory({ ...profile, sessions: [unsafeSession] }, childId);
    expect(result.sessions[0].details).toEqual({ summaries: [{ riderId: 'rider-one', averageWatts: 420, topCadence: 145,
      nested: { readings: [{ speedKph: 32 }] } }] });
    expect(result.sessions[0]).not.toHaveProperty('appleWatch');
    expect(result.sessions[0]).not.toHaveProperty('heartRateSamples');
    expect(unsafeSession.details.summaries[0].heartRate).toBe(189);
  });

  it('recomputes totals from verified activities and excludes legacy reaction attempts from training history', () => {
    const activities = ['bmx-race', 'straight-sprint', 'explore', 'get-pulled', 'monitor-sprint'];
    const sessions = activities.map((activityType, index) => ({ ...session, id: `session-${index}`, activityType }));
    sessions.push({ ...session, id: 'reaction-legacy', title: 'Reaction Test · practice' });
    const result = normalizeFamilyHistory({ ...profile, sessions, totals: { sessions: 999, distanceMeters: 99_999 } }, childId);
    expect(result.sessions.map((record) => record.id)).toEqual(['session-0', 'session-1', 'session-2', 'session-3', 'session-4']);
    expect(result.totals).toEqual({ sessions: 5, bmxRaces: 1, straightSprints: 1, exploreRides: 1,
      getPulledTests: 1, monitorSprints: 1, distanceMeters: 500, durationMs: 10_000 });
  });

  it('rejects malformed activity responses instead of silently displaying a partial sibling history', () => {
    for (const patch of [{ activityType: 'private-health' }, { id: '' }, { startedAt: NaN }, { endedAt: Infinity }]) {
      expect(() => normalizeFamilyHistory({ ...profile, sessions: [session, { ...session, ...patch }] }, childId)).toThrow('could not be verified');
    }
    expect(() => normalizeFamilyHistory({ ...profile, sessions: {} }, childId)).toThrow('could not be read');
  });
});

describe('authenticated family requests', () => {
  it('loads family access without caching and preserves cancellation for account changes', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(reply({ children: [child], invitations: [invite], sharedWith: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadFamily(abort.signal)).resolves.toEqual({ children: [child], archivedChildren: [], invitations: [invite], sharedWith: [] });
    expect(fetcher).toHaveBeenCalledWith('/api/family', expect.objectContaining({ signal: abort.signal, cache: 'no-store', credentials: 'same-origin' }));
  });

  it('creates a no-email child using only the supplied name', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ child }));
    vi.stubGlobal('fetch', fetcher);
    await expect(createFamilyChild('  Athlete One  ')).resolves.toEqual(child);
    expect(fetcher).toHaveBeenCalledWith('/api/family/children', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'Athlete One' }), credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }));
  });

  it('lists archived managed children without treating linked accounts as restorable child profiles', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ children: [], archivedChildren: [child], invitations: [], sharedWith: [] }))
      .mockResolvedValueOnce(reply({ children: [], archivedChildren: [{ ...child, kind: 'linked' }], invitations: [], sharedWith: [] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadFamily()).resolves.toMatchObject({ children: [], archivedChildren: [child] });
    await expect(loadFamily()).rejects.toThrow('archived family profile could not be verified');
  });

  it('restores only the requested managed child and rejects a different sibling or linked response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ child }))
      .mockResolvedValueOnce(reply({ child: { ...child, id: 'child-two' } }))
      .mockResolvedValueOnce(reply({ child: { ...child, kind: 'linked' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(restoreFamilyChild(childId)).resolves.toEqual(child);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/family/children/child-one/restore', expect.objectContaining({ method: 'POST', body: '{}', credentials: 'same-origin' }));
    await expect(restoreFamilyChild(childId)).rejects.toThrow('restored family profile could not be verified');
    await expect(restoreFamilyChild(childId)).rejects.toThrow('restored family profile could not be verified');
  });

  it('loads the explicitly selected child’s profile and period without changing the parent account', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn().mockResolvedValueOnce(reply(profile))
      .mockResolvedValueOnce(reply({ ...profile, sessions: [session] }));
    vi.stubGlobal('fetch', fetcher);
    await loadFamilyProfile(childId, abort.signal);
    await loadFamilyHistory(childId, 1_000, 3_000, abort.signal);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      '/api/family/children/child-one/profile',
      '/api/family/children/child-one/training-sessions?from=1000&to=3000&limit=1000',
    ]);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ signal: abort.signal, credentials: 'same-origin' });
  });

  it('rejects path traversal identifiers before fetch for every destructive family action', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(removeFamilyChild('../child-two')).rejects.toThrow('invalid profile reference');
    await expect(revokeFamilyShare('../parent')).rejects.toThrow('invalid profile reference');
    await expect(revokeFamilyInvitation('../invitation')).rejects.toThrow('invalid profile reference');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('loads a complete busy month by splitting capped responses and recomputing export totals', async () => {
    const records = Array.from({ length: 1_205 }, (_, index) => ({ ...session, id: `race-${index}`, startedAt: index + 1 }));
    const fetcher = vi.fn(async (path: string) => {
      const query = new URL(path, 'https://tracklab.test').searchParams;
      const from = Number(query.get('from'));
      const to = Number(query.get('to'));
      return reply({ ...profile, sessions: records.filter((record) => record.startedAt >= from && record.startedAt <= to)
        .sort((a, b) => b.startedAt - a.startedAt).slice(0, 1000) });
    });
    vi.stubGlobal('fetch', fetcher);
    const history = await loadFamilyHistory(childId, 0, 2_000);
    expect(history.sessions).toHaveLength(1_205);
    expect(new Set(history.sessions.map((record) => record.id)).size).toBe(1_205);
    expect(history.sessions[0].startedAt).toBe(1_205);
    expect(history.sessions.at(-1)?.startedAt).toBe(1);
    expect(history.totals).toMatchObject({ sessions: 1_205, bmxRaces: 1_205, distanceMeters: 120_500, durationMs: 2_410_000 });
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);
  });

  it('discards a partial month when a later window loses family permission', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ ...profile, sessions: Array(1000).fill(session) }))
      .mockResolvedValueOnce(reply({ ...profile, sessions: [session] }))
      .mockResolvedValueOnce(reply({ error: 'Family access ended.' }, 403));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadFamilyHistory(childId, 0, 3_000)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('splits an incomplete club pool even when projection returned no child records', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ ...profile, sessions: [], rangeComplete: false }))
      .mockResolvedValueOnce(reply({ ...profile, sessions: [session], rangeComplete: true }))
      .mockResolvedValueOnce(reply({ ...profile, sessions: [], rangeComplete: true }));
    vi.stubGlobal('fetch', fetcher);
    const history = await loadFamilyHistory(childId, 0, 3_000);
    expect(history.sessions).toEqual([session]);
    expect(history.totals.sessions).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed completeness metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...profile, sessions: [], rangeComplete: 'false' })));
    await expect(loadFamilyHistory(childId, 0, 3_000)).rejects.toThrow('completeness could not be verified');
  });

  it('preserves sub-millisecond database timestamps between adjacent date windows', async () => {
    const fetcher = vi.fn(async (path: string) => {
      const query = new URL(path, 'https://tracklab.test').searchParams;
      const from = Number(query.get('from'));
      const to = Number(query.get('to'));
      if (from === 0 && to === 3000) return reply({ ...profile, sessions: [], rangeComplete: false });
      const storedTimestamp = 1500.5;
      return reply({ ...profile, rangeComplete: true,
        sessions: storedTimestamp >= from && storedTimestamp <= to ? [{ ...session, startedAt: 1500 }] : [] });
    });
    vi.stubGlobal('fetch', fetcher);
    const history = await loadFamilyHistory(childId, 0, 3_000);
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0].startedAt).toBe(1500);
  });

  it('stops loading additional windows after cancellation', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(async () => {
      abort.abort();
      return reply({ ...profile, sessions: Array(1000).fill(session) });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(loadFamilyHistory(childId, 0, 3_000, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports an unsplittable full response rather than silently returning partial data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...profile, sessions: Array(1000).fill(session) })));
    await expect(loadFamilyHistory(childId, 1_000, 1_000)).rejects.toThrow('could not be loaded completely');
  });

  it.each([401, 403, 404, 409, 503])('preserves a %i denial so the UI can clear stale or revoked access', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: 'Family access ended.' }, status)));
    const error = await loadFamilyProfile(childId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FamilyRequestError);
    expect(error).toMatchObject({ status, message: 'Family access ended.' });
  });

  it('handles non-JSON service failures and rejects an incomplete success response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<h1>Unavailable</h1>', { status: 503 }))
      .mockResolvedValueOnce(reply({ children: [child] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(loadFamily()).rejects.toThrow('Family access returned 503.');
    await expect(loadFamily()).rejects.toThrow('Family access could not be verified');
  });
});
