export class KeyedCleanupRegistry<Key> {
  private readonly cleanupsByKey = new Map<Key, Set<() => void>>();

  add(key: Key, cleanup: () => void) {
    const cleanups = this.cleanupsByKey.get(key) ?? new Set<() => void>();
    cleanups.add(cleanup);
    this.cleanupsByKey.set(key, cleanups);
  }

  clear(key: Key) {
    const cleanups = this.cleanupsByKey.get(key);
    if (!cleanups) {
      return;
    }

    this.cleanupsByKey.delete(key);
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // Cleanup must remain best-effort so one device cannot leak all other listeners.
      }
    });
  }

  clearAll() {
    [...this.cleanupsByKey.keys()].forEach((key) => this.clear(key));
  }

  count(key: Key) {
    return this.cleanupsByKey.get(key)?.size ?? 0;
  }
}
