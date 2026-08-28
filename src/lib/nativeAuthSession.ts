import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';

export const nativeAuthSessionPluginName = 'TrackLabNativeSession' as const;

type NativeSessionPlugin = {
  loadSession: () => Promise<{ token?: unknown }>;
  saveSession: (options: { token: string }) => Promise<{ saved?: unknown }>;
  clearSession: () => Promise<{ cleared?: unknown }>;
};

const nativeSessionPlugin = registerPlugin<NativeSessionPlugin>(nativeAuthSessionPluginName);
let cachedToken: string | null | undefined;
let tokenLoad: Promise<string> | null = null;

export function normalizeNativeAuthToken(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
    ? value
    : '';
}

export function nativeAuthSessionAvailable() {
  try {
    return Capacitor.getPlatform() === 'ios'
      && Capacitor.isNativePlatform()
      && Capacitor.isPluginAvailable(nativeAuthSessionPluginName);
  } catch {
    return false;
  }
}

export async function loadNativeAuthToken() {
  if (!nativeAuthSessionAvailable()) return '';
  if (cachedToken !== undefined) return cachedToken ?? '';
  if (tokenLoad) return tokenLoad;
  tokenLoad = nativeSessionPlugin.loadSession()
    .then((result) => normalizeNativeAuthToken(result?.token))
    .catch(() => '')
    .then((token) => {
      cachedToken = token || null;
      return token;
    })
    .finally(() => {
      tokenLoad = null;
    });
  return tokenLoad;
}

export async function saveNativeAuthToken(value: unknown) {
  const token = normalizeNativeAuthToken(value);
  if (!token || !nativeAuthSessionAvailable()) return false;
  const result = await nativeSessionPlugin.saveSession({ token });
  if (result?.saved !== true) throw new Error('iOS could not securely save this sign-in.');
  cachedToken = token;
  return true;
}

export async function clearNativeAuthToken() {
  cachedToken = null;
  tokenLoad = null;
  if (!nativeAuthSessionAvailable()) return;
  await nativeSessionPlugin.clearSession().catch(() => undefined);
}

/** Test-only cache reset; it never reads from browser storage. */
export function resetNativeAuthTokenCacheForTests() {
  cachedToken = undefined;
  tokenLoad = null;
}
