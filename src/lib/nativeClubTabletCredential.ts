import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';
import {
  clearStoredClubTabletDevice,
  normalizeClubTabletDeviceCredential,
  readStoredClubTabletDevice,
  storeClubTabletDevice,
  type ClubTabletDeviceCredential,
} from './clubTabletStorage';

export const nativeClubTabletCredentialPluginName = 'TrackLabNativeSession' as const;

type NativeClubTabletCredentialWireValue = {
  version?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  clubId?: unknown;
  clubName?: unknown;
  deviceToken?: unknown;
};

type NativeClubTabletCredentialPlugin = {
  loadClubTabletCredential: () => Promise<{ credential?: NativeClubTabletCredentialWireValue }>;
  saveClubTabletCredential: (options: {
    version: number;
    deviceId: string;
    deviceName: string;
    clubId: string;
    clubName: string;
    deviceToken: string;
  }) => Promise<{ saved?: unknown }>;
  clearClubTabletCredential: () => Promise<{ cleared?: unknown }>;
};

const nativePlugin = registerPlugin<NativeClubTabletCredentialPlugin>(
  nativeClubTabletCredentialPluginName,
);

function nativeClubTabletCredentialAvailable() {
  try {
    return Capacitor.getPlatform() === 'ios'
      && Capacitor.isNativePlatform()
      && Capacitor.isPluginAvailable(nativeClubTabletCredentialPluginName);
  } catch {
    return false;
  }
}

function normalizeNativeCredential(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as NativeClubTabletCredentialWireValue;
  if (candidate.version !== 1) return null;
  return normalizeClubTabletDeviceCredential({
    device: {
      id: candidate.deviceId,
      name: candidate.deviceName,
      clubId: candidate.clubId,
      clubName: candidate.clubName,
    },
    deviceToken: candidate.deviceToken,
  });
}

function nativeSaveOptions(credential: ClubTabletDeviceCredential) {
  return {
    version: 1,
    deviceId: credential.device.id,
    deviceName: credential.device.name,
    clubId: credential.device.clubId,
    clubName: credential.device.clubName,
    deviceToken: credential.deviceToken,
  } as const;
}

/**
 * Securely saves the durable club-tablet enrollment on iOS. Web builds retain
 * their existing origin-scoped storage contract.
 */
export async function saveNativeClubTabletCredential(value: ClubTabletDeviceCredential) {
  const credential = normalizeClubTabletDeviceCredential(value);
  if (!credential || !/^[A-Za-z0-9_-]{43}$/u.test(credential.deviceToken)) {
    throw new Error('TrackLab received an invalid club tablet authorization.');
  }
  // Commit the newly issued credential locally first. If Keychain is
  // temporarily unavailable, the just-authorized tablet must remain usable
  // and a stale native token must never win on the next launch.
  storeClubTabletDevice(credential);
  if (nativeClubTabletCredentialAvailable()) {
    try {
      const result = await nativePlugin.saveClubTabletCredential(nativeSaveOptions(credential));
      if (result?.saved !== true) {
        throw new Error('This iPad could not securely save its club tablet authorization.');
      }
    } catch (error) {
      // Saving can fail after an older Keychain item was read successfully.
      // Remove that item best-effort so restore cannot overwrite the newer
      // local enrollment. Deliberately preserve localStorage in this path.
      await nativePlugin.clearClubTabletCredential().catch(() => undefined);
      throw error;
    }
  }
  return credential;
}

/** Clears both the device-only Keychain item and its current web-view mirror. */
export async function clearNativeClubTabletCredential() {
  try {
    if (nativeClubTabletCredentialAvailable()) {
      const result = await nativePlugin.clearClubTabletCredential();
      if (result?.cleared !== true) {
        throw new Error('This iPad could not clear its club tablet authorization.');
      }
    }
  } finally {
    clearStoredClubTabletDevice();
  }
}

/**
 * Restores the Keychain enrollment before App reads its synchronous initial
 * state. The first bundled-native build migrates a valid capacitor-origin
 * localStorage credential; later builds hydrate localStorage from Keychain
 * after ordinary TestFlight/App Store updates or WebKit data eviction.
 */
export async function restoreNativeClubTabletCredential() {
  const locallyStored = readStoredClubTabletDevice();
  if (!nativeClubTabletCredentialAvailable()) return locallyStored;

  let result: Awaited<ReturnType<NativeClubTabletCredentialPlugin['loadClubTabletCredential']>>;
  try {
    result = await nativePlugin.loadClubTabletCredential();
  } catch {
    // A transient Keychain read failure must not erase a still-valid local
    // enrollment. Server verification remains authoritative after App mounts.
    return locallyStored;
  }

  const nativeCredential = normalizeNativeCredential(result?.credential);
  if (nativeCredential) {
    storeClubTabletDevice(nativeCredential);
    return nativeCredential;
  }
  if (!locallyStored) return null;

  // Migrate only a credential that already passed the shared strict
  // normalizer. Native persistence is a hardening layer; its temporary
  // failure must not block a valid local enrollment from opening.
  return saveNativeClubTabletCredential(locallyStored).catch(() => locallyStored);
}
