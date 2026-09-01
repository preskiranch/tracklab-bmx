import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';
import {
  clearStoredClubTabletDevice,
  normalizeClubTabletDevice,
  normalizeClubTabletDeviceCredential,
  readStoredClubTabletDevice,
  storeClubTabletDevice,
  type ClubTabletDevice,
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

type NativeClubTabletRecoveryBindingWireValue = {
  version?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  clubId?: unknown;
  clubName?: unknown;
  pairedBikeDeviceId?: unknown;
  pairedBikeLabel?: unknown;
};

/**
 * Token-free identity retained after an expired bearer is discarded. It is a
 * recovery hint, never an authorization: the owner still has to sign in and
 * the server still decides whether this device may be reissued a credential.
 */
export type ClubTabletRecoveryBinding = Readonly<{
  version: 1;
  deviceId: string;
  deviceName: string;
  clubId: string;
  clubName: string;
  pairedBikeDeviceId: number | null;
  pairedBikeLabel: string | null;
}>;

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
  loadClubTabletRecoveryBinding: () => Promise<{
    binding?: NativeClubTabletRecoveryBindingWireValue;
  }>;
  saveClubTabletRecoveryBinding: (
    options: ClubTabletRecoveryBinding,
  ) => Promise<{ saved?: unknown }>;
  clearClubTabletRecoveryBinding: () => Promise<{ cleared?: unknown }>;
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

function strictRecoveryText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function normalizeRecoveryBinding(value: unknown): ClubTabletRecoveryBinding | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as NativeClubTabletRecoveryBindingWireValue;
  if (candidate.version !== 1) return null;
  const deviceId = strictRecoveryText(candidate.deviceId, 120);
  const deviceName = strictRecoveryText(candidate.deviceName, 80);
  const clubId = strictRecoveryText(candidate.clubId, 120);
  const clubName = strictRecoveryText(candidate.clubName, 120);
  if (!deviceId || !deviceName || !clubId || !clubName) return null;

  const bikeDeviceIdAbsent = candidate.pairedBikeDeviceId == null;
  const bikeLabelAbsent = candidate.pairedBikeLabel == null;
  if (bikeDeviceIdAbsent !== bikeLabelAbsent) return null;
  if (bikeDeviceIdAbsent) {
    return {
      version: 1,
      deviceId,
      deviceName,
      clubId,
      clubName,
      pairedBikeDeviceId: null,
      pairedBikeLabel: null,
    };
  }
  const pairedBikeDeviceId = Number(candidate.pairedBikeDeviceId);
  const pairedBikeLabel = strictRecoveryText(candidate.pairedBikeLabel, 120);
  if (!Number.isSafeInteger(pairedBikeDeviceId) || pairedBikeDeviceId <= 0 || !pairedBikeLabel) {
    return null;
  }
  return {
    version: 1,
    deviceId,
    deviceName,
    clubId,
    clubName,
    pairedBikeDeviceId,
    pairedBikeLabel,
  };
}

function recoveryBindingFromDevice(deviceValue: unknown) {
  const device = normalizeClubTabletDevice(deviceValue);
  if (!device) return null;
  return normalizeRecoveryBinding({
    version: 1,
    deviceId: device.id,
    deviceName: device.name,
    clubId: device.clubId,
    clubName: device.clubName,
    pairedBikeDeviceId: device.pairedBike?.deviceId ?? null,
    pairedBikeLabel: device.pairedBike?.label ?? null,
  });
}

function recoveryBindingFromSource(
  value: ClubTabletRecoveryBinding | ClubTabletDevice | ClubTabletDeviceCredential,
) {
  if ('version' in value) return normalizeRecoveryBinding(value);
  if ('device' in value) return recoveryBindingFromDevice(value.device);
  return recoveryBindingFromDevice(value);
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
      // Native save seeds the binding atomically with the bearer. Refresh it
      // here as well so a server-returned paired-bike hint is not discarded.
      await saveNativeClubTabletRecoveryBinding(credential);
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

/** Loads the device-only, non-secret recovery hint without authorizing use. */
export async function loadNativeClubTabletRecoveryBinding() {
  if (!nativeClubTabletCredentialAvailable()) return null;
  const result = await nativePlugin.loadClubTabletRecoveryBinding();
  return normalizeRecoveryBinding(result?.binding);
}

/**
 * Saves or refreshes the durable recovery identity from either a roster
 * device, its credential, or an already-normalized binding.
 */
export async function saveNativeClubTabletRecoveryBinding(
  value: ClubTabletRecoveryBinding | ClubTabletDevice | ClubTabletDeviceCredential,
) {
  const binding = recoveryBindingFromSource(value);
  if (!binding) {
    throw new Error('TrackLab received an invalid club tablet recovery identity.');
  }
  if (nativeClubTabletCredentialAvailable()) {
    const result = await nativePlugin.saveClubTabletRecoveryBinding(binding);
    if (result?.saved !== true) {
      throw new Error('This iPad could not securely save its club tablet recovery identity.');
    }
  }
  return binding;
}

/** Removes only the recovery hint. Normal credential clearing preserves it. */
export async function clearNativeClubTabletRecoveryBinding() {
  if (!nativeClubTabletCredentialAvailable()) return;
  const result = await nativePlugin.clearClubTabletRecoveryBinding();
  if (result?.cleared !== true) {
    throw new Error('This iPad could not clear its club tablet recovery identity.');
  }
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
 * Permanently forgets both authorization and recovery identity. Use only for
 * an explicit owner revoke; expiry and verification failures must call the
 * bearer-only clear above so the same physical tablet remains recoverable.
 */
export async function forgetNativeClubTabletAuthorization() {
  let firstError: unknown = null;
  try {
    await clearNativeClubTabletCredential();
  } catch (error) {
    firstError = error;
  }
  try {
    await clearNativeClubTabletRecoveryBinding();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
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
