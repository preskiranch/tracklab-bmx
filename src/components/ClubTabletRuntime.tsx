import { useEffect, useRef } from 'react';
import {
  ClubTabletRequestError,
  clearStoredClubTabletDevice,
  clearStoredClubTabletSession,
  clearStoredClubTabletSessionIfCurrent,
  endClubTabletSession,
  flushClubTabletOutbox,
  loadClubTabletRoster,
  readStoredClubTabletSession,
  refreshClubTabletSession,
  storeClubTabletSession,
  type ClubTabletDeviceCredential,
  type ClubTabletRoster,
  type ClubTabletSessionCredential,
} from '../lib/clubTablet';
import {
  loadLatestStudioTabletHeartRate,
  mergeLiveHeartRateEvent,
  type HeartRateLiveEvent,
} from '../lib/heartRateCloud';

export type ClubTabletDeviceStatus = 'idle' | 'checking' | 'active' | 'error' | 'revoked';

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
  bikeActivityAt: number;
  onDeviceReady: (roster: ClubTabletRoster, hasStoredSession: boolean) => void;
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
  bikeActivityAt,
  onDeviceReady,
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
    loadClubTabletRoster(device)
      .then((nextRoster) => {
        if (!cancelled) onDeviceReady(nextRoster, Boolean(readStoredClubTabletSession()));
      })
      .catch((error) => {
        if (cancelled) return;
        if (authorizationEnded(error)) {
          clearStoredClubTabletSession();
          clearStoredClubTabletDevice();
          onDeviceRevoked();
          return;
        }
        onDeviceError();
      });
    return () => { cancelled = true; };
  }, [device, onDeviceError, onDeviceReady, onDeviceRevoked]);

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
