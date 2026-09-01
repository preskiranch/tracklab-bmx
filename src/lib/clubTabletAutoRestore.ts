import type { ClubTabletDevice } from './clubTabletStorage';

export type ClubTabletRecoveryHint = Readonly<{
  deviceId: string;
  clubId: string;
}>;

export type ClubTabletAutoRestoreMatch = Readonly<{
  device: ClubTabletDevice;
  reason: 'device-binding' | 'paired-wattbike';
}>;

/**
 * Automatic conversion is intentionally limited to the installed native app.
 * A club owner may use a personal browser/iPad with the same Wattbike, and
 * that browser must never silently become a shared kiosk.
 */
export function clubTabletAutoRestoreMayRun({
  hasDeviceCredential,
  nativeShell,
  ownerReady,
}: Readonly<{
  hasDeviceCredential: boolean;
  nativeShell: boolean;
  ownerReady: boolean;
}>) {
  return nativeShell && ownerReady && !hasDeviceCredential;
}

/**
 * Chooses a logical Club Tablet only when this installation can identify it
 * without guessing. A device-only native binding is authoritative for the
 * same club. Older installations that predate that binding may recover from
 * one unique live Wattbike-to-tablet assignment instead.
 */
export function selectClubTabletAutoRestoreMatch({
  clubId,
  connectedBikeDeviceIds,
  devices,
  recoveryHint,
}: Readonly<{
  clubId: string;
  connectedBikeDeviceIds: readonly number[];
  devices: readonly ClubTabletDevice[];
  recoveryHint: ClubTabletRecoveryHint | null | undefined;
}>): ClubTabletAutoRestoreMatch | null {
  const normalizedClubId = clubId.trim();
  if (!normalizedClubId) return null;
  const clubDevices = devices.filter((device) => device.clubId === normalizedClubId);

  if (recoveryHint?.clubId === normalizedClubId) {
    const boundDevice = clubDevices.find((device) => device.id === recoveryHint.deviceId);
    if (boundDevice) return { device: boundDevice, reason: 'device-binding' };
  }

  const connectedIds = new Set(connectedBikeDeviceIds.flatMap((value) => {
    const deviceId = Math.round(Number(value));
    return Number.isSafeInteger(deviceId) && deviceId > 0 ? [deviceId] : [];
  }));
  if (connectedIds.size === 0) return null;

  const assignedMatches = clubDevices.filter((device) => (
    device.pairedBike != null && connectedIds.has(device.pairedBike.deviceId)
  ));
  return assignedMatches.length === 1
    ? { device: assignedMatches[0], reason: 'paired-wattbike' }
    : null;
}
