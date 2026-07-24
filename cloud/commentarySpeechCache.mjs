export function createCommentarySpeechCache({
  maxEntries = 48,
  ttlMs = 10 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();

  function pruneExpired() {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) {
        entries.delete(key);
      }
    }
  }

  function trimOldest() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey == null) {
        break;
      }
      entries.delete(oldestKey);
    }
  }

  return {
    get(key) {
      pruneExpired();
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return {
        status: entry.settled ? 'hit' : 'shared',
        promise: entry.promise,
      };
    },

    setPending(key, promise) {
      const entry = {
        promise,
        settled: false,
        expiresAt: now() + ttlMs,
      };
      entries.delete(key);
      entries.set(key, entry);
      trimOldest();

      void promise.then(
        () => {
          if (entries.get(key) === entry) {
            entry.settled = true;
            entry.expiresAt = now() + ttlMs;
          }
        },
        () => {
          if (entries.get(key) === entry) {
            entries.delete(key);
          }
        },
      );
      return {
        status: 'miss',
        promise,
      };
    },

    get size() {
      pruneExpired();
      return entries.size;
    },
  };
}
