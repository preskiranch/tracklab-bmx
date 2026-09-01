import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = vi.hoisted(() => ({
  loadClubTabletCredential: vi.fn(),
  saveClubTabletCredential: vi.fn(),
  clearClubTabletCredential: vi.fn(),
  loadClubTabletRecoveryBinding: vi.fn(),
  saveClubTabletRecoveryBinding: vi.fn(),
  clearClubTabletRecoveryBinding: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === 'TrackLabNativeSession',
  },
  registerPlugin: () => nativePlugin,
}));

import {
  clearNativeClubTabletRecoveryBinding,
  clearNativeClubTabletCredential,
  forgetNativeClubTabletAuthorization,
  loadNativeClubTabletRecoveryBinding,
  restoreNativeClubTabletCredential,
  saveNativeClubTabletRecoveryBinding,
  saveNativeClubTabletCredential,
  type ClubTabletRecoveryBinding,
} from '../../src/lib/nativeClubTabletCredential';
import {
  readStoredClubTabletDevice,
  storeClubTabletDevice,
  type ClubTabletDeviceCredential,
} from '../../src/lib/clubTabletStorage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const credential: ClubTabletDeviceCredential = {
  device: {
    id: '2fa55661-7f72-433c-80e5-1e05d56557d8',
    name: 'Club tablet · Bike 701',
    clubId: '8e970e7d-dc91-4657-a97c-c25905509dc8',
    clubName: 'Preski Ranch',
  },
  deviceToken: 'T'.repeat(43),
};

const recoveryBinding: ClubTabletRecoveryBinding = {
  version: 1,
  deviceId: credential.device.id,
  deviceName: credential.device.name,
  clubId: credential.device.clubId,
  clubName: credential.device.clubName,
  pairedBikeDeviceId: null,
  pairedBikeLabel: null,
};

function nativeWireValue(value = credential) {
  return {
    version: 1,
    deviceId: value.device.id,
    deviceName: value.device.name,
    clubId: value.device.clubId,
    clubName: value.device.clubName,
    deviceToken: value.deviceToken,
  };
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage, sessionStorage });
  nativePlugin.loadClubTabletCredential.mockReset();
  nativePlugin.saveClubTabletCredential.mockReset();
  nativePlugin.clearClubTabletCredential.mockReset();
  nativePlugin.loadClubTabletRecoveryBinding.mockReset();
  nativePlugin.saveClubTabletRecoveryBinding.mockReset();
  nativePlugin.clearClubTabletRecoveryBinding.mockReset();
  nativePlugin.saveClubTabletCredential.mockResolvedValue({ saved: true });
  nativePlugin.clearClubTabletCredential.mockResolvedValue({ cleared: true });
  nativePlugin.loadClubTabletRecoveryBinding.mockResolvedValue({});
  nativePlugin.saveClubTabletRecoveryBinding.mockResolvedValue({ saved: true });
  nativePlugin.clearClubTabletRecoveryBinding.mockResolvedValue({ cleared: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native Club Tablet credential persistence', () => {
  it('hydrates WebView storage from the device-only native credential', async () => {
    nativePlugin.loadClubTabletCredential.mockResolvedValue({
      credential: nativeWireValue(),
    });

    await expect(restoreNativeClubTabletCredential()).resolves.toEqual(credential);
    expect(readStoredClubTabletDevice()).toEqual(credential);
    expect(nativePlugin.saveClubTabletCredential).not.toHaveBeenCalled();
  });

  it('migrates a valid bundled-origin local credential into native storage', async () => {
    storeClubTabletDevice(credential);
    nativePlugin.loadClubTabletCredential.mockResolvedValue({});

    await expect(restoreNativeClubTabletCredential()).resolves.toEqual(credential);
    expect(nativePlugin.saveClubTabletCredential).toHaveBeenCalledWith(nativeWireValue());
    expect(readStoredClubTabletDevice()).toEqual(credential);
  });

  it('does not erase a local credential after a transient Keychain read failure', async () => {
    storeClubTabletDevice(credential);
    nativePlugin.loadClubTabletCredential.mockRejectedValue(new Error('protected data unavailable'));

    await expect(restoreNativeClubTabletCredential()).resolves.toEqual(credential);
    expect(nativePlugin.saveClubTabletCredential).not.toHaveBeenCalled();
    expect(readStoredClubTabletDevice()).toEqual(credential);
  });

  it('commits a valid credential to both local and native storage', async () => {
    await expect(saveNativeClubTabletCredential(credential)).resolves.toEqual(credential);
    expect(nativePlugin.saveClubTabletCredential).toHaveBeenCalledWith(nativeWireValue());
    expect(nativePlugin.saveClubTabletRecoveryBinding).toHaveBeenCalledWith(recoveryBinding);
    expect(readStoredClubTabletDevice()).toEqual(credential);
  });

  it('keeps the new local credential and removes stale native state after a save failure', async () => {
    nativePlugin.saveClubTabletCredential.mockRejectedValue(new Error('Keychain write failed'));

    await expect(saveNativeClubTabletCredential(credential)).rejects.toThrow('Keychain write failed');
    expect(nativePlugin.clearClubTabletCredential).toHaveBeenCalledOnce();
    expect(readStoredClubTabletDevice()).toEqual(credential);
  });

  it('opens with the valid local credential when first-run native migration is unavailable', async () => {
    storeClubTabletDevice(credential);
    nativePlugin.loadClubTabletCredential.mockResolvedValue({});
    nativePlugin.saveClubTabletCredential.mockRejectedValue(new Error('Keychain write failed'));

    await expect(restoreNativeClubTabletCredential()).resolves.toEqual(credential);
    expect(nativePlugin.clearClubTabletCredential).toHaveBeenCalledOnce();
    expect(readStoredClubTabletDevice()).toEqual(credential);
  });

  it('clears both the native credential and its WebView mirror', async () => {
    storeClubTabletDevice(credential);
    await expect(clearNativeClubTabletCredential()).resolves.toBeUndefined();
    expect(nativePlugin.clearClubTabletCredential).toHaveBeenCalledOnce();
    expect(nativePlugin.clearClubTabletRecoveryBinding).not.toHaveBeenCalled();
    expect(readStoredClubTabletDevice()).toBeNull();
  });

  it('loads the token-free recovery identity independently of the bearer', async () => {
    nativePlugin.loadClubTabletRecoveryBinding.mockResolvedValue({ binding: recoveryBinding });

    await expect(loadNativeClubTabletRecoveryBinding()).resolves.toEqual(recoveryBinding);
    expect(nativePlugin.loadClubTabletCredential).not.toHaveBeenCalled();
  });

  it('refreshes recovery identity with a server-returned paired Wattbike', async () => {
    const device = {
      ...credential.device,
      pairedBike: {
        deviceId: 701,
        label: 'WattbikePM25058701',
        updatedAt: Date.now(),
      },
    };

    await expect(saveNativeClubTabletRecoveryBinding(device)).resolves.toEqual({
      ...recoveryBinding,
      pairedBikeDeviceId: 701,
      pairedBikeLabel: 'WattbikePM25058701',
    });
    expect(nativePlugin.saveClubTabletRecoveryBinding).toHaveBeenCalledWith({
      ...recoveryBinding,
      pairedBikeDeviceId: 701,
      pairedBikeLabel: 'WattbikePM25058701',
    });
  });

  it('rejects a malformed or partially paired recovery identity', async () => {
    await expect(saveNativeClubTabletRecoveryBinding({
      ...recoveryBinding,
      pairedBikeDeviceId: 701,
      pairedBikeLabel: null,
    })).rejects.toThrow('invalid club tablet recovery identity');
    expect(nativePlugin.saveClubTabletRecoveryBinding).not.toHaveBeenCalled();
  });

  it('clears the recovery identity only when explicitly requested', async () => {
    await expect(clearNativeClubTabletRecoveryBinding()).resolves.toBeUndefined();
    expect(nativePlugin.clearClubTabletRecoveryBinding).toHaveBeenCalledOnce();
    expect(nativePlugin.clearClubTabletCredential).not.toHaveBeenCalled();
  });

  it('forgets bearer, WebView mirror, and recovery identity on owner revoke', async () => {
    storeClubTabletDevice(credential);
    await expect(forgetNativeClubTabletAuthorization()).resolves.toBeUndefined();
    expect(nativePlugin.clearClubTabletCredential).toHaveBeenCalledOnce();
    expect(nativePlugin.clearClubTabletRecoveryBinding).toHaveBeenCalledOnce();
    expect(readStoredClubTabletDevice()).toBeNull();
  });

  it('rejects malformed bearer credentials before writing Keychain', async () => {
    await expect(saveNativeClubTabletCredential({
      ...credential,
      deviceToken: 'not-a-server-issued-token',
    })).rejects.toThrow('invalid club tablet authorization');
    expect(nativePlugin.saveClubTabletCredential).not.toHaveBeenCalled();
    expect(readStoredClubTabletDevice()).toBeNull();
  });
});
