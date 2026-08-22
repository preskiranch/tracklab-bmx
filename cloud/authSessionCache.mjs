export function createAuthSessionCache({
  ttlMs = 5_000,
  touchIntervalMs = 5 * 60 * 1000,
  maxEntries = 2_048,
  now = () => Date.now(),
  onOutcome = () => {},
} = {}) {
  const entries = new Map();
  const touchScheduledAt = new Map();

  const prune = (currentTime = now()) => {
    for (const [hash, entry] of entries) {
      const cachedAt = Number(entry.cachedAt ?? entry.startedAt) || 0;
      const expiresAt = Date.parse(entry.session?.expiresAt ?? '');
      if (
        currentTime - cachedAt >= ttlMs
        || (Number.isFinite(expiresAt) && expiresAt <= currentTime)
      ) {
        entries.delete(hash);
      }
    }
    while (entries.size > maxEntries) {
      const oldestHash = entries.keys().next().value;
      if (!oldestHash) break;
      entries.delete(oldestHash);
    }
    for (const [hash, scheduledAt] of touchScheduledAt) {
      if (currentTime - scheduledAt >= touchIntervalMs) touchScheduledAt.delete(hash);
    }
  };

  const remember = (hash, session, currentTime = now()) => {
    if (!hash || !session?.user || Date.parse(session.expiresAt ?? '') <= currentTime) {
      entries.delete(hash);
      return null;
    }
    entries.delete(hash);
    entries.set(hash, { session, cachedAt: currentTime });
    if (entries.size > maxEntries) prune(currentTime);
    return session;
  };

  const forget = (hash) => {
    entries.delete(hash);
    touchScheduledAt.delete(hash);
  };

  const refreshUser = (user) => {
    if (!user?.id) return;
    for (const [hash, entry] of entries) {
      if (entry.session?.user?.id !== user.id) continue;
      entries.set(hash, {
        ...entry,
        session: { ...entry.session, user },
      });
    }
  };

  const load = async (hash, loader) => {
    const currentTime = now();
    const cached = entries.get(hash);
    const cachedExpiresAt = Date.parse(cached?.session?.expiresAt ?? '');
    if (
      cached?.session?.user
      && currentTime - cached.cachedAt < ttlMs
      && Number.isFinite(cachedExpiresAt)
      && cachedExpiresAt > currentTime
    ) {
      onOutcome('hit');
      entries.delete(hash);
      entries.set(hash, cached);
      return cached.session;
    }
    if (cached?.pending) {
      onOutcome('coalesced');
      return cached.pending;
    }

    onOutcome('miss');
    const pending = Promise.resolve().then(() => loader(hash)).then((session) => {
      const entry = entries.get(hash);
      if (entry?.pending !== pending) return session;
      if (session?.user) return remember(hash, session);
      entries.delete(hash);
      return null;
    }, (error) => {
      if (entries.get(hash)?.pending === pending) entries.delete(hash);
      throw error;
    });
    entries.set(hash, { pending, startedAt: currentTime });
    if (entries.size > maxEntries) prune(currentTime);
    return pending;
  };

  const scheduleTouch = (hash, session, toucher) => {
    const currentTime = now();
    const lastScheduledAt = touchScheduledAt.get(hash);
    if (lastScheduledAt != null && currentTime - lastScheduledAt < touchIntervalMs) return false;
    touchScheduledAt.set(hash, currentTime);
    if (touchScheduledAt.size > maxEntries) prune(currentTime);
    const cached = entries.get(hash);
    if (cached?.session === session) {
      remember(hash, { ...session, lastSeen: new Date(currentTime).toISOString() }, currentTime);
    }
    void Promise.resolve().then(() => toucher(hash)).catch(() => {});
    return true;
  };

  return Object.freeze({
    forget,
    load,
    refreshUser,
    remember,
    scheduleTouch,
  });
}
