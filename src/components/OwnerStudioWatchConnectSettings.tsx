import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disconnectStudioWatchConnectEnrollment,
  loadStudioWatchConnect,
  type WatchConnectStudioProjection,
} from '../lib/watchConnectCloud';
import { formatWatchConnectTimeRemaining } from '../lib/watchConnect';

export type OwnerStudioWatchConnectContext = Readonly<{
  clubId: string;
  clubName: string;
}>;

export function ownerStudioWatchConnectLabel(athlete: WatchConnectStudioProjection) {
  if (athlete.state === 'connected' && athlete.connection) {
    return `Connected · ${formatWatchConnectTimeRemaining(athlete.connection.remainingMs)}`;
  }
  if (athlete.state === 'ready') return 'Recognized';
  if (athlete.state === 'expired') return 'Session ended';
  if (athlete.state === 'membership-required') return 'Membership required';
  return 'Not set up';
}

export function replaceOwnerStudioWatchConnectAthlete(
  athletes: readonly WatchConnectStudioProjection[],
  athlete: WatchConnectStudioProjection,
) {
  const remaining = athletes.filter((candidate) => (
    candidate.clubId !== athlete.clubId || candidate.studioRiderId !== athlete.studioRiderId
  ));
  return athlete.enrollment?.state === 'trusted' ? [athlete, ...remaining] : remaining;
}

export async function runOwnerStudioWatchDisconnect(
  studio: OwnerStudioWatchConnectContext,
  athlete: WatchConnectStudioProjection,
  disconnect = disconnectStudioWatchConnectEnrollment,
) {
  const enrollment = athlete.enrollment;
  if (athlete.clubId !== studio.clubId || enrollment?.state !== 'trusted') {
    throw new Error('That studio Watch Connect setup is no longer available.');
  }
  return disconnect(studio.clubId, enrollment.id);
}

export function OwnerStudioWatchConnectList({
  studio,
  athletes,
  busyRiderId,
  error,
  onDisconnect,
}: Readonly<{
  studio: OwnerStudioWatchConnectContext;
  athletes: readonly WatchConnectStudioProjection[];
  busyRiderId: string | null;
  error: string;
  onDisconnect: (athlete: WatchConnectStudioProjection) => void;
}>) {
  return (
    <section aria-label={`${studio.clubName} Watch Connect`} className="watch-connect-card">
      <header><div><span className="eyebrow">Studio athletes</span><h3>Watch Connect</h3><small>{studio.clubName}</small></div></header>
      <p className="watch-connect-owner-note">
        Disconnecting a Watch stops studio access. It does not remove the athlete from your studio.
      </p>
      {athletes.length ? (
        <ul className="watch-connect-owner-list">
          {athletes.map((athlete) => {
            const canDisconnect = athlete.enrollment?.state === 'trusted';
            return (
              <li key={athlete.studioRiderId}>
                <span><strong>{athlete.riderName}</strong><small>{ownerStudioWatchConnectLabel(athlete)}</small></span>
                {canDisconnect && (
                  <button disabled={busyRiderId != null} onClick={() => onDisconnect(athlete)} type="button">
                    {busyRiderId === athlete.studioRiderId ? 'Disconnecting…' : 'Disconnect Watch'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <small>No studio athletes have set up Watch Connect yet.</small>}
      {error && <small className="watch-connect-card-required" role="alert">{error}</small>}
    </section>
  );
}

export function OwnerStudioWatchConnectSettings({
  studio,
}: Readonly<{ studio: OwnerStudioWatchConnectContext }>) {
  const [athletes, setAthletes] = useState<readonly WatchConnectStudioProjection[]>([]);
  const [busyRiderId, setBusyRiderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const next = await loadStudioWatchConnect(studio.clubId);
      if (request === requestRef.current) {
        setAthletes(next.filter((athlete) => athlete.enrollment?.state === 'trusted'));
        setError('');
      }
    } catch (cause) {
      if (request === requestRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, [studio.clubId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 12_000);
    return () => {
      ++requestRef.current;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const disconnect = async (athlete: WatchConnectStudioProjection) => {
    if (!window.confirm(
      `Disconnect ${athlete.riderName}'s Watch from this studio? The athlete can set it up again later.`,
    )) return;
    setBusyRiderId(athlete.studioRiderId);
    setError('');
    try {
      const updated = await runOwnerStudioWatchDisconnect(studio, athlete);
      setAthletes((current) => replaceOwnerStudioWatchConnectAthlete(current, updated));
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyRiderId(null);
    }
  };

  return (
    <OwnerStudioWatchConnectList
      athletes={athletes}
      busyRiderId={busyRiderId}
      error={error}
      onDisconnect={(athlete) => { void disconnect(athlete); }}
      studio={studio}
    />
  );
}

export default OwnerStudioWatchConnectSettings;
