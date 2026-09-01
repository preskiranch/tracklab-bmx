import { describe, expect, it } from 'vitest';
import {
  claimClubTabletSharedRecoveryAttempt,
  claimClubTabletSharedRecoveryErrorDelivery,
  clubTabletAutoRestoreMayRun,
  selectClubTabletAutoRestoreMatch,
  type ClubTabletRecoveryHint,
} from '../../src/lib/clubTabletAutoRestore';
import type { ClubTabletDevice } from '../../src/lib/clubTabletStorage';

const baseDevice: ClubTabletDevice = {
  id: 'tablet-bike-701',
  name: 'Club tablet · Bike 701',
  clubId: 'club-preski-ranch',
  clubName: 'Preski Ranch LLC',
  recoveryState: 'restored',
  recoveryCompleted: true,
  pairedBike: {
    deviceId: 58_701,
    label: 'WattbikePM25058701',
    updatedAt: 1_000,
  },
};

describe('Club Tablet automatic restore matching', () => {
  it('delivers a terminal recovery failure to the active follower after a remount', async () => {
    let rejectRecovery: (error: unknown) => void = () => undefined;
    const recovery = new Promise<never>((_resolve, reject) => {
      rejectRecovery = reject;
    });
    const attemptKey = `remount-failure:${Date.now()}:${Math.random()}`;
    const starter = claimClubTabletSharedRecoveryAttempt(attemptKey, () => recovery);
    const follower = claimClubTabletSharedRecoveryAttempt(attemptKey, () => recovery);
    expect(starter?.started).toBe(true);
    expect(follower?.started).toBe(false);
    if (!starter || !follower) throw new Error('Expected a shared recovery attempt.');

    const terminalError = new Error('Recovery rejected with 409');
    const inactiveStarter = starter.attempt.promise.catch((error) => ({
      delivered: false,
      error,
    }));
    const activeFollower = follower.attempt.promise.catch((error) => ({
      delivered: claimClubTabletSharedRecoveryErrorDelivery(attemptKey, follower.attempt),
      error,
    }));
    rejectRecovery(terminalError);

    await expect(inactiveStarter).resolves.toEqual({ delivered: false, error: terminalError });
    await expect(activeFollower).resolves.toEqual({ delivered: true, error: terminalError });
    expect(claimClubTabletSharedRecoveryErrorDelivery(attemptKey, starter.attempt)).toBe(false);
  });

  it('never auto-converts a personal web browser into a shared kiosk', () => {
    expect(clubTabletAutoRestoreMayRun({
      hasDeviceCredential: false,
      nativeShell: false,
      ownerReady: true,
    })).toBe(false);
    expect(clubTabletAutoRestoreMayRun({
      hasDeviceCredential: false,
      nativeShell: true,
      ownerReady: true,
    })).toBe(true);
  });

  it('uses the exact durable device binding before requiring a live Wattbike', () => {
    const recoveryHint: ClubTabletRecoveryHint = {
      clubId: baseDevice.clubId,
      deviceId: baseDevice.id,
    };
    expect(selectClubTabletAutoRestoreMatch({
      clubId: baseDevice.clubId,
      connectedBikeDeviceIds: [],
      devices: [baseDevice],
      recoveryHint,
    })).toEqual({ device: baseDevice, reason: 'device-binding' });
  });

  it('ignores a binding from another club and uses one unique connected Wattbike assignment', () => {
    expect(selectClubTabletAutoRestoreMatch({
      clubId: baseDevice.clubId,
      connectedBikeDeviceIds: [58_701],
      devices: [baseDevice],
      recoveryHint: { clubId: 'another-club', deviceId: baseDevice.id },
    })).toEqual({ device: baseDevice, reason: 'paired-wattbike' });
  });

  it('restores complete and restored rows because state is not physical-device presence', () => {
    for (const recoveryState of ['complete', 'restored'] as const) {
      const device = { ...baseDevice, recoveryState, recoveryCompleted: true };
      expect(selectClubTabletAutoRestoreMatch({
        clubId: device.clubId,
        connectedBikeDeviceIds: [device.pairedBike!.deviceId],
        devices: [device],
        recoveryHint: null,
      })).toEqual({ device, reason: 'paired-wattbike' });
    }
  });

  it('refuses to guess when a Wattbike is assigned to more than one tablet', () => {
    expect(selectClubTabletAutoRestoreMatch({
      clubId: baseDevice.clubId,
      connectedBikeDeviceIds: [58_701],
      devices: [
        baseDevice,
        { ...baseDevice, id: 'duplicate-tablet', name: 'Duplicate tablet' },
      ],
      recoveryHint: null,
    })).toBeNull();
  });

  it('refuses to guess when multiple connected assignments identify multiple tablets', () => {
    expect(selectClubTabletAutoRestoreMatch({
      clubId: baseDevice.clubId,
      connectedBikeDeviceIds: [58_701, 58_950],
      devices: [
        baseDevice,
        {
          ...baseDevice,
          id: 'tablet-bike-950',
          pairedBike: { deviceId: 58_950, label: 'WattbikePM25058950', updatedAt: 2_000 },
        },
      ],
      recoveryHint: null,
    })).toBeNull();
  });
});
