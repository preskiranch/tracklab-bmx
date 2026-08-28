import { describe, expect, it, vi } from 'vitest';
import { createAuthSessionCache } from '../../cloud/authSessionCache.mjs';
import { createAuthSession, deleteAuthSession } from '../../cloud/persistence.mjs';

function session(id = 'user-one', expiresAt = 60_000) {
  return {
    sessionId: `session-${id}`,
    expiresAt: new Date(expiresAt).toISOString(),
    lastSeen: new Date(1_000).toISOString(),
    user: { id, friendDiscoverable: false },
  };
}

describe('bounded auth session cache', () => {
  it('caches a newly signed-in session only after memory persistence confirms the write', async () => {
    const tokenHash = `auth-cache-write-${Date.now()}-${Math.random()}`;
    await expect(createAuthSession({
      id: `session-${tokenHash}`,
      userId: `user-${tokenHash}`,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).resolves.toBe(true);
    await deleteAuthSession(tokenHash);
  });

  it('coalesces simultaneous database lookups and reloads after the five-second TTL', async () => {
    let clock = 1_000;
    let resolveFirst!: (value: ReturnType<typeof session>) => void;
    const first = new Promise<ReturnType<typeof session>>((resolve) => { resolveFirst = resolve; });
    const loader = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => session());
    const outcomes: string[] = [];
    const cache = createAuthSessionCache({
      ttlMs: 5_000,
      now: () => clock,
      onOutcome: (outcome) => outcomes.push(outcome),
    });

    const one = cache.load('hash-one', loader);
    const two = cache.load('hash-one', loader);
    resolveFirst(session());
    await expect(Promise.all([one, two])).resolves.toEqual([session(), session()]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(['miss', 'coalesced']);

    await expect(cache.load('hash-one', loader)).resolves.toEqual(session());
    expect(loader).toHaveBeenCalledTimes(1);
    clock += 5_000;
    await expect(cache.load('hash-one', loader)).resolves.toEqual(session());
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('forgets logout immediately and never re-caches an in-flight lookup after logout', async () => {
    let resolveLookup!: (value: ReturnType<typeof session>) => void;
    const pendingLookup = new Promise<ReturnType<typeof session>>((resolve) => { resolveLookup = resolve; });
    const loader = vi.fn()
      .mockImplementationOnce(() => pendingLookup)
      .mockImplementationOnce(async () => null);
    const cache = createAuthSessionCache({ now: () => 1_000 });

    const pending = cache.load('logout-hash', loader);
    cache.forget('logout-hash');
    resolveLookup(session());
    await expect(pending).resolves.toEqual(session());
    await expect(cache.load('logout-hash', loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('refreshes privacy state in cached sessions and coalesces session touches', async () => {
    let clock = 1_000;
    const cache = createAuthSessionCache({
      now: () => clock,
      touchIntervalMs: 300_000,
    });
    const original = session();
    cache.remember('privacy-hash', original);
    cache.refreshUser({ ...original.user, friendDiscoverable: true });
    await expect(cache.load('privacy-hash', vi.fn())).resolves.toMatchObject({
      user: { id: 'user-one', friendDiscoverable: true },
    });

    const toucher = vi.fn(async () => undefined);
    expect(cache.scheduleTouch('privacy-hash', original, toucher)).toBe(true);
    expect(cache.scheduleTouch('privacy-hash', original, toucher)).toBe(false);
    await Promise.resolve();
    expect(toucher).toHaveBeenCalledTimes(1);
    clock += 300_000;
    expect(cache.scheduleTouch('privacy-hash', original, toucher)).toBe(true);
    await Promise.resolve();
    expect(toucher).toHaveBeenCalledTimes(2);
  });

  it('forgets every cached session for an erased user and blocks an in-flight lookup from restoring it', async () => {
    let resolveLookup!: (value: ReturnType<typeof session>) => void;
    const pendingLookup = new Promise<ReturnType<typeof session>>((resolve) => { resolveLookup = resolve; });
    const cache = createAuthSessionCache({ now: () => 1_000 });
    cache.remember('first-hash', session('erased-user'));
    cache.remember('other-hash', session('other-user'));
    const pending = cache.load('pending-hash', () => pendingLookup);

    cache.forgetUser('erased-user');
    resolveLookup(session('erased-user'));

    await expect(pending).resolves.toBeNull();
    await expect(cache.load('first-hash', async () => session('erased-user'))).resolves.toBeNull();
    await expect(cache.load('other-hash', vi.fn())).resolves.toMatchObject({
      user: { id: 'other-user' },
    });
  });
});
