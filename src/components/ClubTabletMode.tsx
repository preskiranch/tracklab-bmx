import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Bluetooth,
  CheckCircle2,
  Clock3,
  Compass,
  Gauge,
  LogOut,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  TabletSmartphone,
  Trash2,
  UserRoundCheck,
} from 'lucide-react';
import { RiderAvatar } from './RiderAvatar';
import {
  clubTabletAthleteDisplayName,
  endClubTabletSession,
  enrollClubTablet,
  loadClubTabletDevices,
  loadClubTabletRoster,
  revokeClubTabletDevice,
  startClubTabletSession,
  type ClubTabletAthlete,
  type ClubTabletDevice,
  type ClubTabletDeviceCredential,
  type ClubTabletRoster,
  type ClubTabletSessionCredential,
  type ClubTabletWatchConnectStatus,
} from '../lib/clubTablet';
import type { AppMode } from '../types';
import type { HeartRateLiveEvent } from '../lib/heartRateCloud';
import type { NativeBluetoothBootstrapStatus } from '../lib/nativeBluetoothBootstrap';
import type { ClubTabletDeviceStatus } from './ClubTabletRuntime';
import { loadClubTabletWatchConnectStatus } from '../lib/watchConnectCloud';
import { clubTabletWatchConnectSelectionState } from '../lib/studioWatchConnectSelection';
import { StudioWatchConnectStatus } from './StudioWatchConnectStatus';
import './ClubTabletMode.css';

type ClubTabletBike = {
  deviceId: number;
  label: string;
};

type ClubTabletModeProps = {
  canAuthorize: boolean;
  device: ClubTabletDeviceCredential | null;
  status: ClubTabletDeviceStatus;
  ready: boolean;
  roster: ClubTabletRoster | null;
  session: ClubTabletSessionCredential | null;
  hr: Readonly<Record<string, HeartRateLiveEvent>>;
  bikes: ClubTabletBike[];
  btSupported: boolean;
  btBusy: boolean;
  bikeCount: number;
  nativeStatus: NativeBluetoothBootstrapStatus;
  setDevice: (device: ClubTabletDeviceCredential | null) => void;
  setRoster: (roster: ClubTabletRoster | null) => void;
  setSession: (session: ClubTabletSessionCredential | null) => void;
  openPairing: () => void;
  reconnectBikes: () => Promise<void> | void;
  retryAuthorization: () => void;
  openProgram: (mode: Extract<AppMode, 'race' | 'straight-sprint' | 'explore' | 'get-pulled'>) => void;
};

export function clubTabletBikeAccessReady(
  deviceStatus: ClubTabletDeviceStatus,
  accessReady: boolean,
) {
  return deviceStatus === 'active' && accessReady;
}

export function clubTabletWatchStatusRequestIsCurrent(requestKey: string, currentKey: string) {
  return Boolean(requestKey) && requestKey === currentKey;
}

export function clubTabletFreshHeartRateReading(
  reading: HeartRateLiveEvent | null | undefined,
  now = Date.now(),
) {
  if (
    !reading
    || reading.freshUntil == null
    || reading.freshUntil !== reading.recordedAt + 10_000
    || reading.freshUntil <= now
    || reading.recordedAt > now + 2_000
    || now - reading.recordedAt >= 10_000
  ) return null;
  return reading;
}

function bikeLabel(bike: ClubTabletBike) {
  const suffix = String(Math.round(bike.deviceId)).slice(-3).padStart(3, '0');
  return `${bike.label || 'Wattbike'} · PM ${suffix}`;
}

export default function ClubTabletMode({
  canAuthorize,
  device: deviceCredential,
  status: deviceStatus,
  ready: accessReady,
  roster,
  session: sessionCredential,
  hr,
  bikes,
  btSupported: bluetoothSupported,
  btBusy: bluetoothBusy,
  bikeCount: authorizedBikeCount,
  nativeStatus: nativeBluetoothStatus,
  setDevice: onDeviceChange,
  setRoster: onRosterChange,
  setSession: onSessionChange,
  openPairing: onOpenBikePairing,
  reconnectBikes: onReconnectSavedBikes,
  retryAuthorization: onRetryAuthorization,
  openProgram: onOpenProgram,
}: ClubTabletModeProps) {
  const [tabletName, setTabletName] = useState(() => {
    const platform = navigator.platform?.trim();
    return platform ? `Club tablet · ${platform}` : 'Club training tablet';
  });
  const [search, setSearch] = useState('');
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [selectedBikeId, setSelectedBikeId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'idle' | 'authorizing' | 'roster' | 'starting' | 'ending'>('idle');
  const [managedDevices, setManagedDevices] = useState<ClubTabletDevice[]>([]);
  const [deviceManagementBusy, setDeviceManagementBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<ClubTabletWatchConnectStatus | null>(null);
  const [watchClock, setWatchClock] = useState(Date.now());
  const bikeAccessReady = clubTabletBikeAccessReady(deviceStatus, accessReady);
  const nativeBluetoothFailed = nativeBluetoothStatus.state === 'failed';

  const activeSession = sessionCredential && sessionCredential.session.expiresAt > Date.now()
    ? sessionCredential
    : null;
  const heartRateReading = clubTabletFreshHeartRateReading(
    activeSession ? hr[activeSession.session.studioRiderId] : null,
    watchClock,
  );
  const sessionAthlete = activeSession
    ? roster?.athletes.find((athlete) => athlete.studioRiderId === activeSession.session.studioRiderId)
    : null;
  const activeWatchRequestKey = activeSession
    ? `${activeSession.sessionToken}:${activeSession.session.clubId}:${activeSession.session.studioRiderId}`
    : '';
  const activeWatchRequestKeyRef = useRef(activeWatchRequestKey);
  activeWatchRequestKeyRef.current = activeWatchRequestKey;
  const filteredAthletes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return roster?.athletes ?? [];
    return (roster?.athletes ?? []).filter((athlete) => (
      athlete.riderName.toLowerCase().includes(query)
      || athlete.athleteName?.toLowerCase().includes(query)
    ));
  }, [roster?.athletes, search]);

  useEffect(() => {
    if (bikes.length === 1) setSelectedBikeId(bikes[0].deviceId);
    if (bikes.length === 0) setSelectedBikeId(null);
  }, [bikes]);

  useEffect(() => {
    if (!selectedRiderId && filteredAthletes.length === 1) {
      setSelectedRiderId(filteredAthletes[0].studioRiderId);
    }
  }, [filteredAthletes, selectedRiderId]);

  useEffect(() => {
    const timer = window.setInterval(() => setWatchClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeSession || !activeWatchRequestKey) {
      setWatchStatus(null);
      return undefined;
    }
    let cancelled = false;
    setWatchStatus(sessionAthlete?.watchConnect ?? null);
    const refresh = () => {
      const requestKey = activeWatchRequestKey;
      void loadClubTabletWatchConnectStatus(activeSession.sessionToken)
        .then((next) => {
          if (
            cancelled
            || !clubTabletWatchStatusRequestIsCurrent(requestKey, activeWatchRequestKeyRef.current)
          ) return;
          setWatchStatus(next);
          setWatchClock(Date.now());
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSession, activeWatchRequestKey, sessionAthlete?.watchConnect]);

  useEffect(() => {
    if (!canAuthorize || deviceCredential) return;
    let cancelled = false;
    setDeviceManagementBusy(true);
    loadClubTabletDevices()
      .then((devices) => {
        if (!cancelled) setManagedDevices(devices);
      })
      .catch(() => {
        if (!cancelled) setManagedDevices([]);
      })
      .finally(() => {
        if (!cancelled) setDeviceManagementBusy(false);
      });
    return () => { cancelled = true; };
  }, [canAuthorize, deviceCredential]);

  const revokeDevice = async (device: ClubTabletDevice) => {
    if (!window.confirm(`Revoke ${device.name}? It will immediately lose access to the club roster and Club Live.`)) return;
    setDeviceManagementBusy(true);
    setMessage(null);
    try {
      await revokeClubTabletDevice(device.id);
      setManagedDevices((current) => current.filter((candidate) => candidate.id !== device.id));
      setMessage(`${device.name} has been revoked.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not revoke this tablet.');
    } finally {
      setDeviceManagementBusy(false);
    }
  };

  const refreshRoster = async (credential = deviceCredential) => {
    if (!credential) return;
    setBusy('roster');
    setMessage(null);
    try {
      onRosterChange(await loadClubTabletRoster(credential));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load the club athlete list.');
    } finally {
      setBusy('idle');
    }
  };

  const authorizeTablet = async () => {
    setBusy('authorizing');
    setMessage(null);
    try {
      const credential = await enrollClubTablet(tabletName);
      onDeviceChange(credential);
      setMessage('Tablet saved. Verifying authorization…');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not authorize this tablet.');
    } finally {
      setBusy('idle');
    }
  };

  const startAthlete = async () => {
    if (!selectedRiderId || selectedBikeId == null) return;
    setBusy('starting');
    setMessage(null);
    try {
      const session = await startClubTabletSession(selectedRiderId, selectedBikeId, deviceCredential);
      const selectedAthlete = roster?.athletes.find((athlete) => athlete.studioRiderId === selectedRiderId);
      onSessionChange({
        ...session,
        session: {
          ...session.session,
          ...(selectedAthlete?.athleteName ? { athleteName: selectedAthlete.athleteName } : {}),
          ...(selectedAthlete?.photoUrl ? { photoUrl: selectedAthlete.photoUrl } : {}),
        },
      });
      setMessage(`${selectedAthlete ? clubTabletAthleteDisplayName(selectedAthlete) : 'Athlete'} is ready. Choose a program below.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start this athlete session.');
    } finally {
      setBusy('idle');
    }
  };

  const endAthlete = async () => {
    const endingSession = sessionCredential;
    setBusy('ending');
    setMessage(null);
    // Remove the selected identity and its BPM before the network request. A
    // slow or offline DELETE must never leave the former athlete visible on a
    // shared tablet.
    onSessionChange(null);
    setSelectedRiderId('');
    try {
      await endClubTabletSession(endingSession);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The athlete was cleared locally.');
    } finally {
      setBusy('idle');
      setMessage('Athlete signed out. The Wattbike remains paired to this tablet for the next student.');
    }
  };

  const openBikePairing = () => {
    if (!bikeAccessReady) {
      setMessage(deviceStatus === 'checking'
        ? 'Verifying tablet authorization before Bluetooth pairing.'
        : 'Tablet authorization must be restored before Bluetooth pairing.');
      return;
    }
    if (!bluetoothSupported) {
      setMessage(nativeBluetoothFailed
        ? 'Native Bluetooth could not start. Close and reopen the TrackLab app, then try again.'
        : 'Bluetooth is unavailable here. Use the TrackLab iPad app or a supported browser.');
      return;
    }
    setMessage(null);
    onOpenBikePairing();
  };

  const reconnectSavedBike = async () => {
    if (!bikeAccessReady) {
      setMessage(deviceStatus === 'checking'
        ? 'Verifying tablet authorization before reconnecting the Wattbike.'
        : 'Tablet authorization must be restored before reconnecting the Wattbike.');
      return;
    }
    if (!bluetoothSupported) {
      setMessage(nativeBluetoothFailed
        ? 'Native Bluetooth could not start. Close and reopen the TrackLab app, then try again.'
        : 'Bluetooth is unavailable here. Use the TrackLab iPad app or a supported browser.');
      return;
    }
    setMessage(null);
    await onReconnectSavedBikes();
  };

  if (!deviceCredential) {
    return (
      <section className="club-tablet-mode setup">
        <div className="club-tablet-hero">
          <span className="club-tablet-icon"><ShieldCheck /></span>
          <div>
            <span className="eyebrow">Shared studio device</span>
            <h2>Authorize this club tablet</h2>
            <p>The club owner authorizes each tablet once. Students can then choose their approved athlete profile and use any club Wattbike paired to this device.</p>
          </div>
        </div>
        <div className="club-tablet-setup-card">
          {canAuthorize ? (
            <>
              <label>
                <span>Tablet name</span>
                <input value={tabletName} maxLength={80} onChange={(event) => setTabletName(event.target.value)} />
              </label>
              <button className="club-tablet-primary" type="button" disabled={busy !== 'idle' || !tabletName.trim()} onClick={authorizeTablet}>
                <ShieldCheck size={19} /> {busy === 'authorizing' ? 'Authorizing…' : 'Authorize this tablet'}
              </button>
              <small>This does not assign a student or a bike. Those choices remain separate and can change every session.</small>
            </>
          ) : (
            <div className="club-tablet-empty">
              <ShieldCheck size={34} />
              <strong>Club owner authorization required</strong>
              <p>Ask the club owner to sign in once on this tablet and authorize it. The authorization remains on this device.</p>
            </div>
          )}
          {message && <p className="club-tablet-message">{message}</p>}
        </div>
        {canAuthorize && (
          <section className="club-tablet-device-manager" aria-label="Authorized club tablets">
            <div>
              <span className="eyebrow">Owner controls</span>
              <h3>Authorized club tablets</h3>
              <p>Revoke a lost, sold, or retired tablet here. Revocation ends its active athlete session and Club Live feed.</p>
            </div>
            <div className="club-tablet-device-list">
              {managedDevices.map((device) => (
                <article key={device.id}>
                  <TabletSmartphone size={23} />
                  <span>
                    <strong>{device.name}</strong>
                    <small>{device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : 'Not used yet'}</small>
                  </span>
                  <button
                    type="button"
                    disabled={deviceManagementBusy}
                    onClick={() => void revokeDevice(device)}
                    aria-label={`Revoke ${device.name}`}
                  >
                    <Trash2 size={17} /> Revoke
                  </button>
                </article>
              ))}
              {!deviceManagementBusy && managedDevices.length === 0 && <p>No authorized tablets yet.</p>}
              {deviceManagementBusy && <p>Loading authorized tablets…</p>}
            </div>
          </section>
        )}
      </section>
    );
  }

  if (deviceStatus === 'checking' || !accessReady && deviceStatus === 'active') {
    return (
      <section className="club-tablet-mode setup" aria-live="polite">
        <div className="club-tablet-access-state">
          <RefreshCw className="club-tablet-spin" size={38} />
          <span className="eyebrow">Secure shared device</span>
          <h2>Verifying tablet authorization…</h2>
          <p>TrackLab is confirming this tablet with the club before it enables the athlete roster or Wattbike pairing.</p>
        </div>
      </section>
    );
  }

  if (deviceStatus === 'error') {
    return (
      <section className="club-tablet-mode setup" aria-live="assertive">
        <div className="club-tablet-access-state error">
          <ShieldCheck size={38} />
          <span className="eyebrow">Authorization check interrupted</span>
          <h2>Could not verify this club tablet</h2>
          <p>Check this iPad’s internet connection, then retry. Wattbike pairing stays locked until the club authorization is confirmed.</p>
          <div className="club-tablet-access-actions">
            <button className="club-tablet-primary" type="button" onClick={onRetryAuthorization}>
              <RefreshCw size={18} /> Retry authorization
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              Refresh app
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (deviceStatus === 'revoked') {
    return (
      <section className="club-tablet-mode setup" aria-live="assertive">
        <div className="club-tablet-access-state error">
          <ShieldCheck size={38} />
          <h2>Tablet authorization ended</h2>
          <p>Ask the club owner to sign in and authorize this tablet again.</p>
        </div>
      </section>
    );
  }

  if (activeSession) {
    const athleteName = sessionAthlete
      ? clubTabletAthleteDisplayName(sessionAthlete)
      : activeSession.session.athleteName || activeSession.session.riderName;
    const expiresInMinutes = Math.max(1, Math.ceil((activeSession.session.expiresAt - Date.now()) / 60_000));
    const activeWatchState = clubTabletWatchConnectSelectionState({
      claimed: sessionAthlete?.status === 'claimed',
      status: watchStatus ?? sessionAthlete?.watchConnect,
      now: watchClock,
    });
    return (
      <section className="club-tablet-mode active">
        <div className="club-tablet-active-card">
          <RiderAvatar
            name={athleteName}
            photoUrl={sessionAthlete?.photoUrl ?? activeSession.session.photoUrl}
            accent="#7ade36"
            className="club-tablet-active-avatar"
          />
          <div>
            <span className="eyebrow"><CheckCircle2 size={15} /> Athlete session active</span>
            <h2>{athleteName}</h2>
            <p>{activeSession.session.clubName} · {bikeLabel({ deviceId: activeSession.session.bikeDeviceId, label: bikes.find((bike) => bike.deviceId === activeSession.session.bikeDeviceId)?.label ?? 'Wattbike' })}</p>
            <small><Clock3 size={13} /> Secure session renews automatically · about {expiresInMinutes} min remaining</small>
            <StudioWatchConnectStatus athleteName={athleteName} state={activeWatchState} />
            {activeWatchState.phase === 'connected'
              && (watchStatus ?? sessionAthlete?.watchConnect)?.liveSharingEnabled === true && (
                <span
                  aria-label={heartRateReading
                    ? `${athleteName} heart rate: ${Math.round(heartRateReading.bpm)} beats per minute, live now`
                    : `${athleteName} heart rate: No recent reading`}
                  aria-live="polite"
                  className={`club-tablet-heart-rate ${heartRateReading ? 'live' : 'waiting'}`}
                  role="status"
                >
                  <strong>{heartRateReading ? `${Math.round(heartRateReading.bpm)} BPM` : '—'}</strong>
                  <small>{heartRateReading ? 'Live from Apple Watch' : 'No recent reading'}</small>
                </span>
              )}
          </div>
          <button type="button" className="club-tablet-end" disabled={busy === 'ending'} onClick={endAthlete}>
            <LogOut size={18} /> {busy === 'ending' ? 'Ending…' : 'End athlete session'}
          </button>
        </div>

        <div className="club-tablet-programs">
          <button type="button" onClick={() => onOpenProgram('race')}>
            <Bike /><span><strong>BMX Race Intervals</strong><small>Tracks, pedal zones, races, and multiplayer</small></span>
          </button>
          <button type="button" onClick={() => onOpenProgram('straight-sprint')}>
            <Route /><span><strong>Straight Sprint</strong><small>Timed sprint distances and personal records</small></span>
          </button>
          <button type="button" onClick={() => onOpenProgram('get-pulled')}>
            <Gauge /><span><strong>Get Pulled</strong><small>Timed sled pulls with Wattbike Air 1–10 records</small></span>
          </button>
          <button type="button" onClick={() => onOpenProgram('explore')}>
            <Compass /><span><strong>Explore the World</strong><small>Solo or multiplayer route riding</small></span>
          </button>
        </div>

        <div className="club-tablet-info-grid">
          <div><Radio /><span><strong>Club Live display is optional</strong><small>This tablet securely publishes the chosen program so the owner can open the central monitor when desired. The laptop does not connect to this bike.</small></span></div>
          <div><Bluetooth /><span><strong>Bike pairing stays saved</strong><small>Ending this athlete session clears only the student identity. It never erases the Wattbike pairing.</small></span></div>
          <div><UserRoundCheck /><span><strong>Records follow the athlete</strong><small>Completed sessions save to the selected athlete and club history, including profiles that have not been claimed yet.</small></span></div>
        </div>
        {message && <p className="club-tablet-message">{message}</p>}
      </section>
    );
  }

  return (
    <section className="club-tablet-mode">
      <header className="club-tablet-header">
        <div>
          <span className="eyebrow">{deviceCredential.device.clubName}</span>
          <h2>Who is training on this tablet?</h2>
          <p>Choose a student, then choose the Wattbike currently paired to this tablet. The choices are independent.</p>
        </div>
        <button type="button" disabled={busy !== 'idle'} onClick={() => void refreshRoster()}>
          <RefreshCw size={17} /> Refresh roster
        </button>
      </header>

      <div className="club-tablet-workflow">
        <section className="club-tablet-step">
          <div className="club-tablet-step-title"><b>1</b><span><strong>Choose athlete</strong><small>Claimed and unclaimed club profiles are both available.</small></span></div>
          <label className="club-tablet-search">
            <Search size={18} />
            <input value={search} placeholder="Find athlete" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="club-tablet-athletes">
            {filteredAthletes.map((athlete) => {
              const selected = athlete.studioRiderId === selectedRiderId;
              const selectedWatchState = selected
                ? clubTabletWatchConnectSelectionState({
                  claimed: athlete.status === 'claimed',
                  status: athlete.watchConnect,
                  now: watchClock,
                })
                : null;
              return (
                <button
                  className={selected ? 'selected' : ''}
                  type="button"
                  key={athlete.studioRiderId}
                  onClick={() => setSelectedRiderId(athlete.studioRiderId)}
                >
                  <RiderAvatar name={clubTabletAthleteDisplayName(athlete)} photoUrl={athlete.photoUrl} accent={selected ? '#7ade36' : '#8d9a87'} />
                  <span>
                    <strong>{clubTabletAthleteDisplayName(athlete)}</strong>
                    <small>{athlete.status === 'claimed' ? 'Claimed TrackLab profile' : 'Studio profile · not claimed yet'}</small>
                    {selectedWatchState && (
                      <StudioWatchConnectStatus
                        athleteName={clubTabletAthleteDisplayName(athlete)}
                        state={selectedWatchState}
                      />
                    )}
                  </span>
                  {selected && <CheckCircle2 size={20} />}
                </button>
              );
            })}
            {busy === 'roster' && <p>Loading club athletes…</p>}
            {busy !== 'roster' && filteredAthletes.length === 0 && <p>No athletes match this search.</p>}
          </div>
        </section>

        <section className="club-tablet-step">
          <div className="club-tablet-step-title"><b>2</b><span><strong>Choose this tablet’s bike</strong><small>Any club Wattbike can be paired. Its saved pairing stays after sign-out.</small></span></div>
          <div className="club-tablet-bikes">
            {bikes.map((bike) => (
              <button className={selectedBikeId === bike.deviceId ? 'selected' : ''} type="button" key={bike.deviceId} onClick={() => setSelectedBikeId(bike.deviceId)}>
                <Bluetooth size={21} />
                <span><strong>{bikeLabel(bike)}</strong><small>Connected and available</small></span>
                {selectedBikeId === bike.deviceId && <CheckCircle2 size={20} />}
              </button>
            ))}
          </div>
          {bikes.length === 0 && (
            <div className="club-tablet-bike-actions">
              <p>{bluetoothSupported
                ? 'No Wattbike is connected to this tablet yet.'
                : nativeBluetoothFailed
                  ? 'Native Bluetooth could not start. Close and reopen the TrackLab app. If it continues, install the latest app build.'
                  : 'Bluetooth is unavailable in this browser. Use the TrackLab iPad app.'}</p>
              {bluetoothSupported && bikeAccessReady && authorizedBikeCount > 0 && (
                <button type="button" disabled={bluetoothBusy} onClick={() => void reconnectSavedBike()}>
                  <RefreshCw size={17} /> Reconnect saved Wattbike
                </button>
              )}
              {bluetoothSupported && bikeAccessReady && (
                <button type="button" disabled={bluetoothBusy} onClick={openBikePairing}>
                  <Bluetooth size={17} /> Pair a Wattbike
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="club-tablet-start">
        <span><ShieldCheck size={18} /> The server verifies the selected athlete before any data is saved.</span>
        <button className="club-tablet-primary" type="button" disabled={!selectedRiderId || selectedBikeId == null || busy !== 'idle'} onClick={startAthlete}>
          <UserRoundCheck size={20} /> {busy === 'starting' ? 'Starting athlete session…' : 'Start athlete session'}
        </button>
      </footer>
      {message && <p className="club-tablet-message">{message}</p>}
    </section>
  );
}
