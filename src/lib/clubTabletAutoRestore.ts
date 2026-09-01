import type {
  ClubTabletDevice,
  ClubTabletDeviceCredential,
} from './clubTabletStorage';

export type ClubTabletRecoveryHint = Readonly<{
  deviceId: string;
  clubId: string;
}>;

export type ClubTabletAutoRestoreMatch = Readonly<{
  device: ClubTabletDevice;
  reason: 'device-binding' | 'paired-wattbike';
}>;

export type ClubTabletSharedRecoveryAttempt = Readonly<{
  attempts: number;
  errorDelivered: boolean;
  promise: Promise<ClubTabletDeviceCredential>;
  state: 'failed' | 'in-flight' | 'retry-ready' | 'succeeded';
  updatedAt: number;
}>;

const sharedRecoveryAttempts = new Map<string, ClubTabletSharedRecoveryAttempt>();
const sharedRecoveryAttemptTtlMs = 30_000;

/** Shares one recovery request across StrictMode and conditional-tree remounts. */
export function claimClubTabletSharedRecoveryAttempt(
  attemptKey: string,
  recover: () => Promise<ClubTabletDeviceCredential>,
) {
  const now = Date.now();
  let existing = sharedRecoveryAttempts.get(attemptKey);
  if (
    existing
    && existing.state !== 'in-flight'
    && now - existing.updatedAt >= sharedRecoveryAttemptTtlMs
  ) {
    sharedRecoveryAttempts.delete(attemptKey);
    existing = undefined;
  } else if (existing?.state === 'in-flight' || existing?.state === 'succeeded') {
    return { attempt: existing, started: false } as const;
  } else if (existing && existing.state !== 'retry-ready') {
    return null;
  }
  const attempts = existing?.attempts ?? 0;
  if (attempts >= 2) return null;
  const promise = Promise.resolve().then(recover);
  const attempt: ClubTabletSharedRecoveryAttempt = {
    attempts: attempts + 1,
    errorDelivered: false,
    promise,
    state: 'in-flight',
    updatedAt: now,
  };
  sharedRecoveryAttempts.set(attemptKey, attempt);
  return { attempt, started: true } as const;
}

export function updateClubTabletSharedRecoveryAttempt(
  attemptKey: string,
  state: ClubTabletSharedRecoveryAttempt['state'],
) {
  const existing = sharedRecoveryAttempts.get(attemptKey);
  if (!existing) return;
  sharedRecoveryAttempts.set(attemptKey, {
    ...existing,
    state,
    updatedAt: Date.now(),
  });
}

/** Lets exactly one currently mounted subscriber surface a terminal failure. */
export function claimClubTabletSharedRecoveryErrorDelivery(
  attemptKey: string,
  attempt: ClubTabletSharedRecoveryAttempt,
) {
  const existing = sharedRecoveryAttempts.get(attemptKey);
  if (
    !existing
    || existing.promise !== attempt.promise
    || existing.errorDelivered
  ) return false;
  sharedRecoveryAttempts.set(attemptKey, {
    ...existing,
    errorDelivered: true,
  });
  return true;
}

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
