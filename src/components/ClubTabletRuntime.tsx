import { useEffect, useRef } from 'react';
import {
  ClubTabletRequestError,
  clearClubTabletBikePresence,
  clearStoredClubTabletDevice,
  clearStoredClubTabletSession,
  clearStoredClubTabletSessionIfCurrent,
  endClubTabletSession,
  flushClubTabletOutbox,
  loadClubTabletRoster,
  publishClubTabletBikePresence,
  readStoredClubTabletSession,
  refreshClubTabletSession,
  storeClubTabletSession,
  type ClubTabletDeviceCredential,
  type ClubTabletBikePresenceInput,
  type ClubTabletRoster,
  type ClubTabletSessionCredential,
} from '../lib/clubTablet';
import { clearNativeClubTabletCredential } from '../lib/nativeClubTabletCredential';
import {
  loadLatestStudioTabletHeartRate,
  mergeLiveHeartRateEvent,
  type HeartRateLiveEvent,
} from '../lib/heartRateCloud';

export type ClubTabletDeviceStatus = 'idle' | 'checking' | 'active' | 'error' | 'revoked';

export const clubTabletAuthorizationTimeoutMs = 15_000;
export const clubTabletRosterRefreshMs = 10_000;

export function expireClubTabletSessionLocallyFirst(
  session: ClubTabletSessionCredential,
  onSessionExpired: () => void,
  onHeartRateReading: (reading: HeartRateLiveEvent | null) => void,
  stopRemote: (credential: ClubTabletSessionCredential) => Promise<unknown> = endClubTabletSession,
) {
  clearStoredClubTabletSessionIfCurrent(session);
  onHeartRateReading(null);
  onSessionExpired();
  void stopRemote(session).catch(() => undefined);
}

type ClubTabletRuntimeProps = {
  device: ClubTabletDeviceCredential;
  roster: ClubTabletRoster | null;
  session: ClubTabletSessionCredential | null;
  /** The tablet's actual GATT-connected bike, independent of pedaling. */
  connectedBike?: ClubTabletBikePresenceInput | null;
  bikeActivityAt: number;
  onDeviceReady: (roster: ClubTabletRoster, hasStoredSession: boolean) => void;
  onRosterRefresh: (roster: ClubTabletRoster) => void;
  onDeviceError: () => void;
  onDeviceRevoked: () => void;
  onSessionRenewed: (session: ClubTabletSessionCredential) => void;
  onSessionExpired: () => void;
  onHeartRateReading: (reading: HeartRateLiveEvent | null) => void;
};

function authorizationEnded(error: unknown) {
  return error instanceof ClubTabletRequestError && (error.status === 401 || error.status === 403);
}

export default function ClubTabletRuntime({
  device,
  roster,
  session,
  connectedBike = null,
  bikeActivityAt,
  onDeviceReady,
  onRosterRefresh,
  onDeviceError,
  onDeviceRevoked,
  onSessionRenewed,
  onSessionExpired,
  onHeartRateReading,
}: ClubTabletRuntimeProps) {
  const lastActivityAtRef = useRef(Date.now());
  const activityVersionRef = useRef(0);

  useEffect(() => {
    void import('../lib/nativePushNotifications')
      .then(({ disableNativePushDelivery }) => disableNativePushDelivery())
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const bikeDeviceId = Math.round(Number(connectedBike?.deviceId));
    const bikeLabel = connectedBike?.label?.trim() ?? '';
    const controller = new AbortController();
    let cancelled = false;
    let requestActive = false;

    if (!Number.isSafeInteger(bikeDeviceId) || bikeDeviceId <= 0 || !bikeLabel) {
      void clearClubTabletBikePresence(device, { signal: controller.signal }).catch(() => undefined);
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const publish = async () => {
      if (cancelled || requestActive || document.visibilityState === 'hidden') return;
      requestActive = true;
      try {
        await publishClubTabletBikePresence({ deviceId: bikeDeviceId, label: bikeLabel }, device, {
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          // Presence is deliberately ephemeral. Authorization and roster
          // coordinators own user-visible recovery for an offline tablet.
        }
      } finally {
        requestActive = false;
      }
    };

    void publish();
    const timer = window.setInterval(() => { void publish(); }, 4_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void publish();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connectedBike?.deviceId, connectedBike?.label, device.device.id, device.deviceToken]);

  useEffect(() => () => {
    void clearClubTabletBikePresence(device, { keepalive: true }).catch(() => undefined);
  }, [device.device.id, device.deviceToken]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const flushDurableResults = async () => {
      await flushClubTabletOutbox().catch(() => undefined);
      if (!cancelled) timer = window.setTimeout(flushDurableResults, 5_000);
    };
    void flushDurableResults();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [device.device.id]);

  useEffect(() => {
    if (!session) return;
    lastActivityAtRef.current = Date.now();
    activityVersionRef.current += 1;
  }, [session?.sessionToken]);

  useEffect(() => {
    if (!session) return;
    const markActive = () => {
      lastActivityAtRef.current = Date.now();
      activityVersionRef.current += 1;
    };
    window.addEventListener('pointerdown', markActive, { passive: true });
    window.addEventListener('keydown', markActive);
    window.addEventListener('touchstart', markActive, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('touchstart', markActive);
    };
  }, [session?.sessionToken]);

  useEffect(() => {
    if (!session || !bikeActivityAt) return;
    lastActivityAtRef.current = Math.max(lastActivityAtRef.current, bikeActivityAt);
    activityVersionRef.current += 1;
  }, [bikeActivityAt, session?.sessionToken]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), clubTabletAuthorizationTimeoutMs);
    loadClubTabletRoster(device, { signal: controller.signal })
      .then((nextRoster) => {
        if (!cancelled) onDeviceReady(nextRoster, Boolean(readStoredClubTabletSession()));
      })
      .catch((error) => {
        if (cancelled) return;
        if (authorizationEnded(error)) {
          clearStoredClubTabletSession();
          clearStoredClubTabletDevice();
          void clearNativeClubTabletCredential().catch(() => undefined);
          onDeviceRevoked();
          return;
        }
        onDeviceError();
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [device.device.id, device.deviceToken, onDeviceError, onDeviceReady, onDeviceRevoked]);

  useEffect(() => {
    if (!roster || roster.device.id !== device.device.id) return undefined;
    let cancelled = false;
    let authorizationRevoked = false;
    let requestActive = false;
    let controller: AbortController | null = null;
    let timer: number | null = null;

    const schedule = (delayMs = clubTabletRosterRefreshMs) => {
      if (cancelled || authorizationRevoked) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), delayMs);
    };
    const refresh = async () => {
      if (cancelled || authorizationRevoked || requestActive) return;
      if (document.visibilityState === 'hidden') {
        schedule();
        return;
      }
      requestActive = true;
      controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller?.abort(),
        clubTabletAuthorizationTimeoutMs,
      );
      try {
        const nextRoster = await loadClubTabletRoster(device, { signal: controller.signal });
        if (!cancelled) onRosterRefresh(nextRoster);
      } catch (error) {
        if (!cancelled && authorizationEnded(error)) {
          authorizationRevoked = true;
          clearStoredClubTabletSession();
          clearStoredClubTabletDevice();
          void clearNativeClubTabletCredential().catch(() => undefined);
          onDeviceRevoked();
        }
        // A transient refresh failure must not eject an already-authorized
        // rider. The last verified roster remains usable until the next poll.
      } finally {
        window.clearTimeout(timeout);
        requestActive = false;
        schedule();
      }
    };

    schedule();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [device.device.id, device.deviceToken, onDeviceRevoked, onRosterRefresh, roster?.device.id]);

  useEffect(() => {
    if (!session) return;
    const remainingMs = session.session.expiresAt - Date.now();
    if (remainingMs <= 0) {
      clearStoredClubTabletSession();
      onSessionExpired();
      return;
    }
    const timer = window.setTimeout(() => {
      clearStoredClubTabletSession();
      onSessionExpired();
    }, Math.min(remainingMs + 25, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [onSessionExpired, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let timer = 0;
    let lastRenewedActivityVersion = -1;
    let ending = false;
    const idleTimeoutMs = Math.max(60_000, session.heartbeatTtlMs - 15_000);

    const expireIdentity = () => {
      if (ending || cancelled) return;
      ending = true;
      expireClubTabletSessionLocallyFirst(
        session,
        onSessionExpired,
        onHeartRateReading,
      );
    };

    const renew = async () => {
      if (cancelled) return;
      const idleForMs = Date.now() - lastActivityAtRef.current;
      if (idleForMs >= idleTimeoutMs) {
        expireIdentity();
        return;
      }
      if (lastRenewedActivityVersion === activityVersionRef.current) {
        timer = window.setTimeout(() => void renew(), Math.max(2_000, Math.min(15_000, session.pollAfterMs)));
        return;
      }
      controller = new AbortController();
      try {
        const next = await refreshClubTabletSession(session, controller.signal);
        if (cancelled) return;
        lastRenewedActivityVersion = activityVersionRef.current;
        const athlete = roster?.athletes.find(
          (candidate) => candidate.studioRiderId === next.session.studioRiderId,
        );
        const enriched: ClubTabletSessionCredential = {
          ...next,
          session: {
            ...next.session,
            ...(athlete?.athleteName ? { athleteName: athlete.athleteName } : {}),
            ...(athlete?.photoUrl ? { photoUrl: athlete.photoUrl } : {}),
          },
        };
        storeClubTabletSession(enriched);
        onSessionRenewed(enriched);
        void flushClubTabletOutbox(enriched);
        timer = window.setTimeout(() => void renew(), Math.max(5_000, Math.min(30_000, enriched.pollAfterMs)));
      } catch (error) {
        if (cancelled || (error as Error).name === 'AbortError') return;
        if (authorizationEnded(error)) {
          clearStoredClubTabletSession();
          onSessionExpired();
          return;
        }
        timer = window.setTimeout(() => void renew(), 5_000);
      }
    };

    timer = window.setTimeout(() => void renew(), Math.max(2_000, Math.min(15_000, session.pollAfterMs)));
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [onHeartRateReading, onSessionExpired, onSessionRenewed, roster?.athletes, session?.sessionToken]);

  useEffect(() => {
    onHeartRateReading(null);
    if (!session) return undefined;
    const expectedRiderId = session.session.studioRiderId;
    const controller = new AbortController();
    let cancelled = false;
    let requestActive = false;
    let readings: Readonly<Record<string, HeartRateLiveEvent>> = {};
    const refresh = async () => {
      if (cancelled || requestActive) return;
      requestActive = true;
      try {
        const reading = await loadLatestStudioTabletHeartRate(
          session.sessionToken,
          expectedRiderId,
          { signal: controller.signal },
        );
        if (cancelled) return;
        if (!reading || reading.studioRiderId !== expectedRiderId) {
          readings = {};
          onHeartRateReading(null);
          return;
        }
        const event: HeartRateLiveEvent = {
          streamId: 'club-tablet-live',
          sessionId: 'club-tablet-athlete-session',
          relayScope: 'studio-block',
          riderId: expectedRiderId,
          studioRiderId: expectedRiderId,
          playerId: null,
          bpm: reading.bpm,
          recordedAt: reading.recordedAt,
          receivedAt: reading.receivedAt,
          freshUntil: reading.freshUntil,
          activeElapsedMs: null,
        };
        const next = mergeLiveHeartRateEvent(readings, event, { expectedRiderId });
        if (next === readings) return;
        readings = next;
        onHeartRateReading(event);
      } catch (error) {
        if (!cancelled && (error as Error).name !== 'AbortError') {
          readings = {};
          onHeartRateReading(null);
        }
      } finally {
        requestActive = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      onHeartRateReading(null);
    };
  }, [onHeartRateReading, session?.session.studioRiderId, session?.sessionToken]);

  return null;
}
