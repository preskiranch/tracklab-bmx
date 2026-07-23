const warnedStorageKeys = new Set<string>();

export function safeSetLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    warnedStorageKeys.delete(key);
    return true;
  } catch (error) {
    if (!warnedStorageKeys.has(key)) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not cache ${key} in this browser: ${message}`);
      warnedStorageKeys.add(key);
    }
    return false;
  }
}
