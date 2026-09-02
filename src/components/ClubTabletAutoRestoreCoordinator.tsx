import { useEffect, useMemo, useState } from 'react';
import {
  ClubTabletRequestError,
  loadClubTabletDevices,
  recoverClubTabletDevice,
  type ClubTabletDevice,
  type ClubTabletDeviceCredential,
} from '../lib/clubTablet';
import { loadNativeClubTabletRecoveryBinding } from '../lib/nativeClubTabletCredential';
import {
  claimClubTabletSharedRecoveryAttempt,
  claimClubTabletSharedRecoveryErrorDelivery,
  selectClubTabletAutoRestoreMatch,
  updateClubTabletSharedRecoveryAttempt,
} from '../lib/clubTabletAutoRestore';

type ClubTabletRecoveryDiscovery = Readonly<{
  scopeKey: string;
  devices: readonly ClubTabletDevice[];
  recoveryHint: Awaited<ReturnType<typeof loadNativeClubTabletRecoveryBinding>>;
}>;

type ClubTabletAutoRestoreCoordinatorProps = Readonly<{
  clubId: string;
  connectedBikeDeviceIds: readonly number[];
  enabled: boolean;
  ownerUserId: string;
  onBeforeRecover: () => Promise<void> | void;
  onRecovered: (credential: ClubTabletDeviceCredential) => void;
  onRecoveryError?: (error: unknown) => void;
}>;

const clubTabletAutoRestoreRetryEvent = 'tracklab:club-tablet-auto-restore-retry';

/**
 * Converts an authenticated owner installation back into its existing kiosk
 * identity. Recovery rotates the device bearer and consumes the owner session,
 * so concurrent/remounted coordinators share one attempt. One explicit 5xx
 * retry is allowed; ambiguous transport failures are never repeated.
 */
export default function ClubTabletAutoRestoreCoordinator({
  clubId,
  connectedBikeDeviceIds,
  enabled,
  ownerUserId,
  onBeforeRecover,
  onRecovered,
  onRecoveryError,
}: ClubTabletAutoRestoreCoordinatorProps) {
  const scopeKey = enabled && ownerUserId && clubId ? `${ownerUserId}:${clubId}` : '';
  const [discovery, setDiscovery] = useState<ClubTabletRecoveryDiscovery | null>(null);
  const [recoveryRetryRevision, setRecoveryRetryRevision] = useState(0);
  const connectedBikeKey = useMemo(
    () => [...new Set(connectedBikeDeviceIds)].sort((left, right) => left - right).join(','),
    [connectedBikeDeviceIds],
  );

  useEffect(() => {
    const handleRetry = () => setRecoveryRetryRevision((current) => current + 1);
    window.addEventListener(clubTabletAutoRestoreRetryEvent, handleRetry);
    return () => {
      window.removeEventListener(clubTabletAutoRestoreRetryEvent, handleRetry);
    };
  }, []);

  useEffect(() => {
    if (!scopeKey) {
      setDiscovery(null);
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    let retryTimer: number | null = null;
    setDiscovery(null);
    const discover = async (resetAttempts = false) => {
      if (cancelled || inFlight) return;
      if (resetAttempts) attempts = 0;
      if (attempts >= 3) return;
      attempts += 1;
      inFlight = true;
      try {
        const [devices, recoveryHint] = await Promise.all([
          loadClubTabletDevices(),
          loadNativeClubTabletRecoveryBinding().catch(() => null),
        ]);
        if (!cancelled) setDiscovery({ scopeKey, devices, recoveryHint });
      } catch {
        if (!cancelled && attempts < 3) {
          retryTimer = window.setTimeout(() => void discover(), attempts * 1_000);
        }
      } finally {
        inFlight = false;
      }
    };
    const rediscoverWhenOnline = () => { void discover(true); };
    const rediscoverWhenVisible = () => {
      if (document.visibilityState === 'visible') void discover(true);
    };
    window.addEventListener('online', rediscoverWhenOnline);
    document.addEventListener('visibilitychange', rediscoverWhenVisible);
    void discover();
    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      window.removeEventListener('online', rediscoverWhenOnline);
      document.removeEventListener('visibilitychange', rediscoverWhenVisible);
    };
  }, [scopeKey]);

  useEffect(() => {
    if (!scopeKey || discovery?.scopeKey !== scopeKey) return;
    const connectedIds = connectedBikeKey
      ? connectedBikeKey.split(',').map((value) => Number(value))
      : [];
    const match = selectClubTabletAutoRestoreMatch({
      clubId,
      connectedBikeDeviceIds: connectedIds,
      devices: discovery.devices,
      recoveryHint: discovery.recoveryHint,
    });
    if (!match) return;

    const attemptKey = `${scopeKey}:${match.device.id}`;
    const claimed = claimClubTabletSharedRecoveryAttempt(
      attemptKey,
      () => Promise.resolve(onBeforeRecover())
        .then(() => recoverClubTabletDevice(match.device.id)),
    );
    if (!claimed) return;

    let active = true;
    void claimed.attempt.promise
      .then((credential) => {
        if (claimed.started) {
          updateClubTabletSharedRecoveryAttempt(attemptKey, 'succeeded');
        }
        if (!active) return;
        // Commit the rotated credential before continuing into kiosk mode.
        // A successful recovery has already consumed the owner session. Every
        // remounted coordinator receives the same result so React StrictMode
        // or a landing-to-app transition cannot lose the kiosk state update.
        onRecovered(credential);
        // Recovery turns this physical device into a shared kiosk. Clear the
        // former owner's registered delivery endpoint in the background so a
        // personal Recovery Alert cannot later appear on a studio tablet. It
        // must not delay or jeopardize the durable auto-restore handoff.
        void import('./NativeNotificationsCoordinator')
          .then(({ clearNativePushAccountBoundary }) => clearNativePushAccountBoundary())
          .catch(() => undefined);
      })
      .catch((error) => {
        // A generic transport failure is ambiguous: the server may already
        // have rotated the bearer and consumed the owner session. Retry only
        // an explicit server-side 5xx, which means recovery did not commit.
        if (
          claimed.attempt.attempts === 1
          && error instanceof ClubTabletRequestError
          && error.status >= 500
        ) {
          if (claimed.started) {
            updateClubTabletSharedRecoveryAttempt(attemptKey, 'retry-ready');
            window.setTimeout(() => {
              window.dispatchEvent(new Event(clubTabletAutoRestoreRetryEvent));
            }, 1_500);
          }
          return;
        }
        if (claimed.started) {
          updateClubTabletSharedRecoveryAttempt(attemptKey, 'failed');
        }
        if (
          active
          && claimClubTabletSharedRecoveryErrorDelivery(attemptKey, claimed.attempt)
        ) {
          onRecoveryError?.(error);
        }
      });
    return () => {
      active = false;
    };
  }, [
    clubId,
    connectedBikeKey,
    discovery,
    onBeforeRecover,
    onRecovered,
    onRecoveryError,
    recoveryRetryRevision,
    scopeKey,
  ]);

  return null;
}
