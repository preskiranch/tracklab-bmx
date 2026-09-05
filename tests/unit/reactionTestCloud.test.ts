import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactionTestResult } from '../../src/lib/reactionTest';
import type { ReactionRecordOwner } from '../../src/lib/reactionTestCloud';

const account = { kind: 'account', accountId: 'athlete-a' } as const;
const result = (id: string, milliseconds: number): ReactionTestResult => ({
  id, startedAt: 1000, startedAtEpoch: 10000, recordedAt: 1000 + milliseconds,
  recordedAtEpoch: 10000 + milliseconds, reactionTimeMs: milliseconds,
  rating: 'great', stage: 'yellow-1', valid: true, late: false, falseStart: false, cadenceDelayMs: 100,
});
const response = () => new Response(JSON.stringify({
  personalBestMs: 180, leaderboard: { joined: false, displayName: '' }, canJoinLeaderboard: true,
}));
const storage = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Reaction Test best-only cloud synchronization', () => {
  it('retains just the fastest pending attempt across reload and syncs under the original account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    let api = await import('../../src/lib/reactionTestCloud');
    await expect(api.saveReactionPersonalBest(result('first', 200), account)).rejects.toThrow('Offline');
    await expect(api.saveReactionPersonalBest(result('best', 180), account)).rejects.toThrow('Offline');
    await expect(api.saveReactionPersonalBest(result('slower', 210), account)).rejects.toThrow('Offline');
    expect(storage.size).toBe(1);
    expect([...storage.values()][0]).not.toContain('slower');
    vi.resetModules();
    api = await import('../../src/lib/reactionTestCloud');
    expect(api.localReactionPersonalBest(account)).toBe(180);
    expect(api.localReactionPersonalBest({ kind: 'account', accountId: 'athlete-b' })).toBeNull();
    const fetcher = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetcher);
    await api.flushReactionPersonalBest(account);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('/api/reaction-test/result');
    expect(JSON.parse(request.body)).toMatchObject({ expectedAccountId: 'athlete-a', result: { id: 'best' } });
    expect(JSON.parse([...storage.values()][0])).toEqual({ bestMs: 180 });
  });

  it('uses captured tablet credentials even after local tablet storage changes', async () => {
    const owner: ReactionRecordOwner = {
      kind: 'tablet', deviceToken: 'device-a', credential: {
        deviceId: 'tablet-a', sessionToken: 'session-a', resultUploadToken: 'result-a',
        session: { clubId: 'club', clubName: 'Studio', studioRiderId: 'rider-a', riderName: 'A', bikeDeviceId: 1, expiresAt: Date.now() + 10000 },
        heartbeatTtlMs: 10000, pollAfterMs: 5000,
      },
    };
    storage.set('tracklab.club-tablet-athlete-session.v1', JSON.stringify({ sessionToken: 'session-b' }));
    const fetcher = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetcher);
    const api = await import('../../src/lib/reactionTestCloud');
    await api.saveReactionPersonalBest(result('tablet-best', 180), owner);
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer device-a',
      'X-TrackLab-Club-Tablet-Session': 'session-a',
      'X-TrackLab-Club-Tablet-Result-Token': 'result-a',
    });
    await api.loadReactionProfile(owner);
    expect(fetcher.mock.calls[1][1].headers['X-TrackLab-Club-Tablet-Result-Token']).toBeUndefined();
  });

  it('does not persist false starts or send them to a training endpoint', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const api = await import('../../src/lib/reactionTestCloud');
    await api.saveReactionPersonalBest({ ...result('early', 0), valid: false, falseStart: true, reactionTimeMs: null }, account);
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });

  it('uploads the newer in-memory minimum when persistent storage rejects writes', async () => {
    storage.set('tracklab.reaction-best.v1:account:athlete-a', JSON.stringify({ bestMs: 300 }));
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: () => { throw new Error('Quota'); } });
    const fetcher = vi.fn().mockImplementation(response);
    vi.stubGlobal('fetch', fetcher);
    const api = await import('../../src/lib/reactionTestCloud');
    await api.saveReactionPersonalBest(result('new-best', 180), account);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(api.localReactionPersonalBest(account)).toBe(180);
  });

  it('clears local account data and never recreates it after an in-flight save', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const api = await import('../../src/lib/reactionTestCloud');
    const pending = api.saveReactionPersonalBest(result('deleted-best', 180), account);
    api.clearLocalReactionAccount(account.accountId);
    finish(response());
    await pending;
    expect(storage.size).toBe(0);
    expect(api.localReactionPersonalBest(account)).toBeNull();
  });
});
