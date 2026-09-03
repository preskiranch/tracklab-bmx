import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExploreRoute,
  MultiplayerChallenge,
  MultiplayerExploreState,
  MultiplayerLatencySnapshot,
  MultiplayerMatchInvite,
  MultiplayerMatchmakingScope,
  MultiplayerMatchmakingState,
  MultiplayerRaceSetup,
  MultiplayerRaceState,
  MultiplayerRider,
  MultiplayerRoom,
  MultiplayerRoomMessage,
  MultiplayerSocialState,
  MultiplayerTrackSummary,
  MultiplayerTrackVoteCandidate,
  MultiplayerVoiceSignal,
  MultiplayerVoiceSignalPayload,
  SplitBranchChoice,
  TrackRecord,
} from '../types';
import { safeSetLocalStorage } from '../lib/browserStorage';
import type {
  ClubTabletDeviceCredential,
  ClubTabletSessionCredential,
} from '../lib/clubTabletStorage';
import {
  clubTabletWattbikeCapacityGrant,
  normalizeWattbikeCapacityMessage,
  wattbikeCapacityClientGrantTtlMs,
  type WattbikeCapacityState,
} from '../lib/wattbikeCapacity';
import { authenticatedWebSocketUrl, requestWebSocketTicket } from '../lib/webSocketTicket';
import { trackLabPublicOrigin } from '../lib/serviceOrigins';
import { canonicalPlayerAccent } from '../lib/playerPalette';

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type MultiplayerProfile = {
  guestKey: string;
  name: string;
  email: string;
  available: boolean;
  membershipTier: 'visitor' | 'spectator' | 'racer';
};

export type MultiplayerIdentityOverride = {
  /** Changes whenever a shared tablet switches athlete sessions. Never sent to the server. */
  scopeKey: string;
  guestKey: string;
  name: string;
  email?: string;
  available?: boolean;
  membershipTier?: MultiplayerProfile['membershipTier'];
  readOnly?: boolean;
};

export type ClubTabletDemoMultiplayerConfiguration = Readonly<{
  activityType: 'bmx-race' | 'straight-sprint' | 'explore';
  /** Versioned compatibility key for the exact demo race mechanics. */
  configurationId: string;
}>;

export function canonicalizeMultiplayerRaceState(
  rawState: MultiplayerRaceState,
  receivedAt = Date.now(),
): MultiplayerRaceState {
  return {
    ...rawState,
    riders: rawState.riders.map((rider) => ({
      ...rider,
      accent: canonicalPlayerAccent(rider.colorName, rider.accent),
    })),
    summary: rawState.summary.map((entry) => ({
      ...entry,
      accent: canonicalPlayerAccent(entry.colorName, entry.accent),
    })),
    receivedAt,
  };
}

export function canonicalizeMultiplayerExploreState(
  rawState: MultiplayerExploreState,
): MultiplayerExploreState {
  return {
    ...rawState,
    riders: rawState.riders.map((rider) => ({
      ...rider,
      accent: canonicalPlayerAccent(rider.colorName, rider.accent),
    })),
  };
}

type UseMultiplayerOptions = {
  enabled: boolean;
  /** Keeps only the authenticated capacity transport online outside multiplayer. */
  capacityChannelEnabled?: boolean;
  track: TrackRecord;
  bikeCount: number;
  wattbikeConnectionCount?: number;
  identityOverride?: MultiplayerIdentityOverride | null;
  clubTabletSession?: ClubTabletSessionCredential | null;
  /** Exact authorized device used only for an explicitly active kiosk demo. */
  clubTabletDemoDevice?: ClubTabletDeviceCredential | null;
  clubTabletDemoConfiguration?: ClubTabletDemoMultiplayerConfiguration | null;
  onFriendNetworkChange?: () => void;
  onWattbikeCapacityChange?: (capacity: WattbikeCapacityState | null) => void;
};

type IncomingChallenge = {
  challenge: MultiplayerChallenge;
  from: MultiplayerRider;
};

type IncomingMatchInvite = {
  invite: MultiplayerMatchInvite;
  from: MultiplayerRider;
};

export type MultiplayerRoomExit = Readonly<{
  sequence: number;
  roomId: string | null;
  reason: string | null;
}>;

const emptySocialState: MultiplayerSocialState = {
  friends: [],
  incomingFriendRequests: [],
  outgoingFriendRequests: [],
  groups: [],
  incomingGroupInvites: [],
};

const initialLatency: MultiplayerLatencySnapshot = {
  rttMs: null,
  clockOffsetMs: 0,
  quality: 'unknown',
  measuredAt: null,
};

const initialMatchmaking: MultiplayerMatchmakingState = {
  active: false,
  scope: null,
  activityType: null,
  queuedAt: null,
  queuedRacers: 0,
  message: '',
};

export const profileStorageKey = 'tracklab-bmx-multiplayer-profile-v1';
const profileCookieName = 'tracklab_profile_key';
const profileQueryParamNames = ['profileKey', 'profile'];

export function normalizeMultiplayerRoomId(value: string) {
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? `ROOM-${code}` : code;
}

/** Exact number of entered athletes represented by this browser connection. */
export function quickRaceEnteredRacerCount(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : null;
}

function createGuestKey() {
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGuestKey(value: string, fallback: string) {
  return value.trim().replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 160) || fallback;
}

function normalizeProfileEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 160) : '';
}

function normalizeMembershipTier(value: unknown): MultiplayerProfile['membershipTier'] {
  return value === 'spectator' || value === 'racer' ? value : 'visitor';
}

export function resolveMultiplayerProfile(
  storedProfile: MultiplayerProfile,
  identityOverride?: MultiplayerIdentityOverride | null,
): MultiplayerProfile {
  if (!identityOverride) return storedProfile;
  return {
    guestKey: normalizeGuestKey(identityOverride.guestKey, 'club-tablet-athlete'),
    name: identityOverride.name.trim().slice(0, 64) || 'Club Tablet athlete',
    email: normalizeProfileEmail(identityOverride.email),
    available: Boolean(identityOverride.available),
    membershipTier: normalizeMembershipTier(identityOverride.membershipTier),
  };
}

function profileKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const paramName of profileQueryParamNames) {
    const value = params.get(paramName);
    if (value) {
      return normalizeGuestKey(value, '');
    }
  }

  return '';
}

function writeProfileCookie(guestKey: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${profileCookieName}=${encodeURIComponent(guestKey)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

function updateManifestProfile(guestKey: string) {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    return;
  }

  const params = new URLSearchParams({ profileKey: guestKey });
  manifest.href = `/manifest.webmanifest?${params.toString()}`;
}

function randomRiderName() {
  return `TrackLab Rider ${Math.floor(1000 + Math.random() * 9000)}`;
}

function readProfile(): MultiplayerProfile {
  const urlGuestKey = profileKeyFromUrl();

  try {
    const stored = window.localStorage.getItem(profileStorageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<MultiplayerProfile>;
      const fallbackGuestKey = createGuestKey();
      const profile = {
        guestKey: urlGuestKey || (typeof parsed.guestKey === 'string' ? normalizeGuestKey(parsed.guestKey, fallbackGuestKey) : fallbackGuestKey),
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 64) : randomRiderName(),
        email: normalizeProfileEmail(parsed.email),
        available: Boolean(parsed.available),
        membershipTier: normalizeMembershipTier(parsed.membershipTier),
      };
      writeProfile(profile);
      writeProfileCookie(profile.guestKey);
      updateManifestProfile(profile.guestKey);
      return profile;
    }
  } catch {
    // Fall through to a new guest profile.
  }

  const profile = {
    guestKey: urlGuestKey || createGuestKey(),
    name: randomRiderName(),
    email: '',
    available: false,
    membershipTier: 'visitor' as const,
  };
  writeProfile(profile);
  writeProfileCookie(profile.guestKey);
  updateManifestProfile(profile.guestKey);
  return profile;
}

function writeProfile(profile: MultiplayerProfile) {
  safeSetLocalStorage(profileStorageKey, JSON.stringify(profile));
}

function trackSummary(track: TrackRecord): MultiplayerTrackSummary {
  return {
    id: track.id,
    name: track.name,
    country: track.country,
    state: track.state,
  };
}

function formatRoomMessages(messages: MultiplayerRoomMessage[]) {
  return messages.slice(-40);
}

function latencyQualityForMs(value: number | null): MultiplayerLatencySnapshot['quality'] {
  if (value == null || value <= 0) {
    return 'unknown';
  }

  if (value <= 90) {
    return 'good';
  }

  if (value <= 180) {
    return 'ok';
  }

  return 'poor';
}

export function useMultiplayer({
  enabled,
  capacityChannelEnabled = false,
  track,
  bikeCount,
  wattbikeConnectionCount = bikeCount,
  identityOverride = null,
  clubTabletSession = null,
  clubTabletDemoDevice = null,
  clubTabletDemoConfiguration = null,
  onFriendNetworkChange,
  onWattbikeCapacityChange,
}: UseMultiplayerOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const capacityHeartbeatTimerRef = useRef<number | null>(null);
  const capacityGrantExpiryTimerRef = useRef<number | null>(null);
  const pendingPingRef = useRef<Map<string, number>>(new Map());
  const pendingInviteRoomRef = useRef<string | null>(null);
  const pendingRoomJoinRetryTimerRef = useRef<number | null>(null);
  const pendingRoomJoinAttemptRef = useRef(0);
  const identityScopeRef = useRef('');
  const identityOverrideActiveRef = useRef(Boolean(identityOverride));
  const latestClubTabletSessionRef = useRef(clubTabletSession);
  const latestClubTabletDemoDeviceRef = useRef(clubTabletDemoDevice);
  const latestClubTabletDemoConfigurationRef = useRef(clubTabletDemoConfiguration);
  const latestProfileRef = useRef<MultiplayerProfile | null>(null);
  const latestWattbikeConnectionCountRef = useRef(wattbikeConnectionCount);
  const latestTrackRef = useRef<MultiplayerTrackSummary | null>(null);
  const currentRoomRef = useRef<MultiplayerRoom | null>(null);
  const onFriendNetworkChangeRef = useRef(onFriendNetworkChange);
  const onWattbikeCapacityChangeRef = useRef(onWattbikeCapacityChange);
  const sendPresenceRef = useRef<(nextProfile?: MultiplayerProfile) => boolean>(() => false);
  const [storedProfile, setStoredProfile] = useState<MultiplayerProfile>(readProfile);
  const profile = useMemo(
    () => resolveMultiplayerProfile(storedProfile, identityOverride),
    [identityOverride, storedProfile],
  );
  const profileReadOnly = Boolean(identityOverride);
  const identityScopeKey = identityOverride?.scopeKey ?? `owner:${storedProfile.guestKey}`;
  const clubTabletSessionToken = clubTabletSession?.sessionToken ?? '';
  const clubTabletDemoDeviceToken = clubTabletDemoDevice?.deviceToken ?? '';
  const clubTabletDemoConfigurationKey = clubTabletDemoConfiguration
    ? `${clubTabletDemoConfiguration.activityType}:${clubTabletDemoConfiguration.configurationId}`
    : '';
  const transportEnabled = enabled || capacityChannelEnabled;
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [clientId, setClientId] = useState<string | null>(null);
  const [onlineRiders, setOnlineRiders] = useState<MultiplayerRider[]>([]);
  const [rooms, setRooms] = useState<MultiplayerRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<MultiplayerRoom | null>(null);
  const [roomExit, setRoomExit] = useState<MultiplayerRoomExit>({
    sequence: 0,
    roomId: null,
    reason: null,
  });
  const [roomMessages, setRoomMessages] = useState<MultiplayerRoomMessage[]>([]);
  const [roomRaceStates, setRoomRaceStates] = useState<MultiplayerRaceState[]>([]);
  const [roomExploreStates, setRoomExploreStates] = useState<MultiplayerExploreState[]>([]);
  const [voiceSignals, setVoiceSignals] = useState<MultiplayerVoiceSignal[]>([]);
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingChallenge[]>([]);
  const [incomingMatchInvites, setIncomingMatchInvites] = useState<IncomingMatchInvite[]>([]);
  const [social, setSocial] = useState<MultiplayerSocialState>(emptySocialState);
  const [status, setStatus] = useState('Multiplayer offline.');
  const [latency, setLatency] = useState<MultiplayerLatencySnapshot>(initialLatency);
  const [matchmaking, setMatchmaking] = useState<MultiplayerMatchmakingState>(initialMatchmaking);

  currentRoomRef.current = currentRoom;

  const resetTransientMultiplayerState = useCallback(() => {
    setClientId(null);
    setOnlineRiders([]);
    setRooms([]);
    setCurrentRoom(null);
    setRoomMessages([]);
    setRoomRaceStates([]);
    setRoomExploreStates([]);
    setVoiceSignals([]);
    setIncomingChallenges([]);
    setIncomingMatchInvites([]);
    setSocial(emptySocialState);
    setLatency(initialLatency);
    setMatchmaking(initialMatchmaking);
    pendingPingRef.current.clear();
  }, []);

  const currentTrack = useMemo(() => trackSummary(track), [track.country, track.id, track.name, track.state]);

  // Session renewal replaces the credential object every few seconds without
  // changing its identity token. Keep the live value available to transport
  // callbacks without reconnecting (and momentarily dropping the BLE grant).
  identityOverrideActiveRef.current = Boolean(identityOverride);
  latestClubTabletSessionRef.current = clubTabletSession;
  latestClubTabletDemoDeviceRef.current = clubTabletDemoDevice;
  latestClubTabletDemoConfigurationRef.current = clubTabletDemoConfiguration;

  useEffect(() => {
    latestProfileRef.current = profile;
    latestWattbikeConnectionCountRef.current = wattbikeConnectionCount;
    latestTrackRef.current = currentTrack;
  }, [currentTrack, profile, wattbikeConnectionCount]);

  useEffect(() => {
    onFriendNetworkChangeRef.current = onFriendNetworkChange;
  }, [onFriendNetworkChange]);

  useEffect(() => {
    onWattbikeCapacityChangeRef.current = onWattbikeCapacityChange;
  }, [onWattbikeCapacityChange]);

  const clearWattbikeCapacityGrant = useCallback(() => {
    if (capacityGrantExpiryTimerRef.current != null) {
      window.clearTimeout(capacityGrantExpiryTimerRef.current);
      capacityGrantExpiryTimerRef.current = null;
    }
    onWattbikeCapacityChangeRef.current?.(null);
  }, []);

  const publishWattbikeCapacityGrant = useCallback((capacity: WattbikeCapacityState) => {
    if (capacityGrantExpiryTimerRef.current != null) {
      window.clearTimeout(capacityGrantExpiryTimerRef.current);
    }
    onWattbikeCapacityChangeRef.current?.(capacity);
    capacityGrantExpiryTimerRef.current = window.setTimeout(() => {
      capacityGrantExpiryTimerRef.current = null;
      onWattbikeCapacityChangeRef.current?.(null);
    }, wattbikeCapacityClientGrantTtlMs);
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendLatencyPing = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const id = `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const clientSentAt = Date.now();
    pendingPingRef.current.set(id, clientSentAt);
    socket.send(JSON.stringify({ type: 'ping', id, clientSentAt }));
    return true;
  }, []);

  const sendPresence = useCallback((nextProfile = profile) => {
    return send({
      type: 'presence',
      guestKey: nextProfile.guestKey,
      name: nextProfile.name,
      email: nextProfile.email,
      // Capacity-only sockets must not advertise a local rider as available or
      // alter multiplayer discovery while the activity remains in local mode.
      available: enabled ? nextProfile.available : false,
      membershipTier: nextProfile.membershipTier,
      bikeCount: wattbikeConnectionCount,
      track: currentTrack,
    });
  }, [currentTrack, enabled, profile, send, wattbikeConnectionCount]);

  useEffect(() => {
    sendPresenceRef.current = sendPresence;
  }, [sendPresence]);

  const setProfile = useCallback((patch: Partial<Pick<MultiplayerProfile, 'guestKey' | 'name' | 'email' | 'available' | 'membershipTier'>>) => {
    if (profileReadOnly) return;
    setStoredProfile((current) => {
      const next = {
        ...current,
        ...patch,
        guestKey: patch.guestKey != null ? normalizeGuestKey(patch.guestKey, current.guestKey) : current.guestKey,
        name: patch.name != null ? patch.name.trim().slice(0, 64) || current.name : current.name,
        email: patch.email != null ? normalizeProfileEmail(patch.email) : current.email,
        membershipTier: patch.membershipTier != null ? normalizeMembershipTier(patch.membershipTier) : current.membershipTier,
      };
      writeProfile(next);
      void sendPresence(next);
      return next;
    });
  }, [profileReadOnly, sendPresence]);

  useEffect(() => {
    if (identityOverride) return;
    writeProfile(storedProfile);
    writeProfileCookie(storedProfile.guestKey);
    updateManifestProfile(storedProfile.guestKey);
  }, [identityOverride, storedProfile]);

  useEffect(() => {
    const previousScope = identityScopeRef.current;
    const scopeChanged = Boolean(previousScope && previousScope !== identityScopeKey);
    identityScopeRef.current = identityScopeKey;
    if (!scopeChanged) {
      if (!identityOverride) {
        const requestedRoom = new URLSearchParams(window.location.search).get('room');
        pendingInviteRoomRef.current = requestedRoom
          ? normalizeMultiplayerRoomId(requestedRoom)
          : null;
      }
      return;
    }

    // A room, social graph, challenge, or telemetry snapshot must never cross
    // between the owner's browser identity and a selected shared-tablet athlete.
    pendingInviteRoomRef.current = null;
    resetTransientMultiplayerState();
    clearWattbikeCapacityGrant();
    const url = new URL(window.location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      window.history.replaceState(null, '', url);
    }
  }, [clearWattbikeCapacityGrant, identityOverride, identityScopeKey, resetTransientMultiplayerState]);

  useEffect(() => {
    if (enabled) return;
    // The capacity channel is transport-only. Leaving multiplayer closes any
    // server room through the socket reconnect below and immediately removes
    // local room/social state so local race behavior remains independent.
    resetTransientMultiplayerState();
  }, [enabled, resetTransientMultiplayerState]);

  useEffect(() => {
    const clearPendingRoomJoinRetry = (resetAttempts = true) => {
      if (pendingRoomJoinRetryTimerRef.current != null) {
        window.clearTimeout(pendingRoomJoinRetryTimerRef.current);
        pendingRoomJoinRetryTimerRef.current = null;
      }
      if (resetAttempts) pendingRoomJoinAttemptRef.current = 0;
    };
    if (!transportEnabled) {
      clearPendingRoomJoinRetry();
      setConnection('idle');
      socketRef.current?.close();
      socketRef.current = null;
      clearWattbikeCapacityGrant();
      resetTransientMultiplayerState();
      return;
    }

    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimerRef.current != null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, 1400);
    };

    const connect = async () => {
      if (cancelled) {
        return;
      }

      setConnection('connecting');
      setStatus('Connecting to TrackLab multiplayer.');
      let ticket = '';
      let ownerTicket = '';
      // Never infer a kiosk identity from ambient browser storage. The caller
      // must provide the exact in-memory athlete session that also produced
      // identityOverride, preventing an abandoned token from authorizing the
      // owner's multiplayer connection.
      const tabletSession = identityOverrideActiveRef.current
        ? latestClubTabletSessionRef.current
        : null;
      const tabletDemoDevice = identityOverrideActiveRef.current && !tabletSession
        ? latestClubTabletDemoDeviceRef.current
        : null;
      if (tabletSession || tabletDemoDevice) {
        try {
          const authorization = await import('../lib/clubTablet').then((clubTablet) => (
            tabletSession
              ? clubTablet.requestClubTabletMultiplayerTicket(tabletSession)
              : clubTablet.requestClubTabletDemoMultiplayerTicket(tabletDemoDevice)
          ));
          if (cancelled) return;
          ticket = authorization?.ticket ?? '';
          if (!ticket) throw new Error('Club Tablet multiplayer authorization is unavailable.');
        } catch (error) {
          if (cancelled || (error as Error).name === 'AbortError') return;
          setConnection('error');
          setStatus(tabletDemoDevice
            ? 'Club Tablet demo multiplayer is reconnecting.'
            : 'Club Tablet athlete authorization expired. Return to Club Tablet and choose the athlete again.');
          scheduleReconnect();
          return;
        }
      } else {
        try {
          const authorization = await requestWebSocketTicket('multiplayer');
          if (cancelled) return;
          ownerTicket = authorization.ticket;
        } catch (error) {
          if (cancelled || (error as Error).name === 'AbortError') return;
          setConnection('error');
          setStatus(error instanceof Error ? error.message : 'TrackLab multiplayer authorization is unavailable.');
          clearWattbikeCapacityGrant();
          scheduleReconnect();
          return;
        }
      }
      const socket = new WebSocket(authenticatedWebSocketUrl({
        authTicket: ownerTicket,
        clubTabletTicket: ticket,
      }));
      socketRef.current = socket;
      const connectionIdentityScopeKey = identityScopeKey;
      const joinPendingRoom = () => {
        clearPendingRoomJoinRetry(false);
        const pendingRoom = pendingInviteRoomRef.current;
        if (
          !pendingRoom
          || cancelled
          || socketRef.current !== socket
          || socket.readyState !== WebSocket.OPEN
          || currentRoomRef.current
        ) return;
        socket.send(JSON.stringify({ type: 'join-room', roomId: pendingRoom }));
        pendingRoomJoinAttemptRef.current += 1;
        // Retain the target until room-state/room-left confirms the outcome,
        // while bounding retries on one socket for stale or expired codes.
        if (pendingRoomJoinAttemptRef.current < 4) {
          pendingRoomJoinRetryTimerRef.current = window.setTimeout(joinPendingRoom, 2_500);
        }
      };

      socket.addEventListener('open', () => {
        if (socketRef.current !== socket) return;
        const latestProfile = latestProfileRef.current ?? profile;
        setConnection('open');
        setStatus(enabled ? 'Multiplayer online.' : 'Wattbike authorization online.');
        socket.send(JSON.stringify({
          type: 'hello',
          guestKey: latestProfile.guestKey,
          name: latestProfile.name,
          email: latestProfile.email,
          available: enabled ? latestProfile.available : false,
          membershipTier: latestProfile.membershipTier,
          bikeCount: latestWattbikeConnectionCountRef.current,
          track: latestTrackRef.current ?? currentTrack,
        }));
        if (tabletSession) {
          // Issuing the one-time ticket revalidated the athlete session and its
          // reserved Wattbike lease. Socket closure/rejection clears this grant.
          publishWattbikeCapacityGrant(clubTabletWattbikeCapacityGrant());
        }
        sendLatencyPing();
        if (pingTimerRef.current != null) {
          window.clearInterval(pingTimerRef.current);
        }
        pingTimerRef.current = window.setInterval(sendLatencyPing, 4000);
        if (capacityHeartbeatTimerRef.current != null) {
          window.clearInterval(capacityHeartbeatTimerRef.current);
        }
        if (capacityChannelEnabled) {
          // Zero-bike owners are not part of the server lease-renewal loop, so
          // repeat authenticated presence to receive a fresh zero-seat capacity
          // snapshot before the short client grant expires.
          let tabletCapacityValidationInFlight = false;
          capacityHeartbeatTimerRef.current = window.setInterval(() => {
            if (!tabletSession) {
              void sendPresenceRef.current();
              return;
            }
            if (tabletCapacityValidationInFlight) return;
            tabletCapacityValidationInFlight = true;
            void import('../lib/clubTablet')
              .then(({ validateClubTabletSessionCapacity }) => (
                validateClubTabletSessionCapacity(tabletSession)
              ))
              .then((valid) => {
                if (
                  !valid
                  || cancelled
                  || socketRef.current !== socket
                  || identityScopeRef.current !== connectionIdentityScopeKey
                ) return;
                publishWattbikeCapacityGrant(clubTabletWattbikeCapacityGrant());
              })
              .catch(() => {
                if (cancelled || socketRef.current !== socket) return;
                clearWattbikeCapacityGrant();
                socket.close(1008, 'Club tablet Wattbike authorization expired');
              })
              .finally(() => {
                tabletCapacityValidationInFlight = false;
              });
          }, 10_000);
        }
      });

      socket.addEventListener('message', (event) => {
        if (
          socketRef.current !== socket
          || identityScopeRef.current !== connectionIdentityScopeKey
        ) return;
        const message = JSON.parse(event.data as string);

        if (message.type === 'wattbike-capacity') {
          const capacity = normalizeWattbikeCapacityMessage(message);
          if (capacity) {
            publishWattbikeCapacityGrant(capacity);
          }
        }

        if (message.type === 'connected') {
          setClientId(message.clientId ?? null);
        }

        if (message.type === 'welcome') {
          if (!enabled) return;
          setClientId(message.clientId ?? null);
          setOnlineRiders(Array.isArray(message.riders) ? message.riders : []);
          setRooms(Array.isArray(message.rooms) ? message.rooms : []);
          if (tabletDemoDevice) {
            // Authorized demo tablets share one ephemeral, club-scoped room.
            // The server derives the identity and room; no athlete or owner
            // profile is borrowed and no race result is persisted.
            pendingInviteRoomRef.current = null;
            clearPendingRoomJoinRetry();
            const demoConfiguration = latestClubTabletDemoConfigurationRef.current;
            if (!demoConfiguration) {
              setStatus('Open BMX Race Intervals or Straight Sprint before starting demo multiplayer.');
              return;
            }
            socket.send(JSON.stringify({
              type: 'join-club-demo',
              track: latestTrackRef.current ?? currentTrack,
              activityType: demoConfiguration.activityType,
              configurationId: demoConfiguration.configurationId,
            }));
            return;
          }
          const pendingRoom = pendingInviteRoomRef.current;
          if (pendingRoom) {
            pendingRoomJoinAttemptRef.current = 0;
            joinPendingRoom();
          }
        }

        if (message.type === 'lobby-state') {
          if (!enabled) return;
          setOnlineRiders(Array.isArray(message.riders) ? message.riders : []);
          setRooms(Array.isArray(message.rooms) ? message.rooms : []);
        }

        if (message.type === 'social-state' && message.social) {
          if (!enabled) return;
          setSocial({
            friends: Array.isArray(message.social.friends) ? message.social.friends : [],
            incomingFriendRequests: Array.isArray(message.social.incomingFriendRequests) ? message.social.incomingFriendRequests : [],
            outgoingFriendRequests: Array.isArray(message.social.outgoingFriendRequests) ? message.social.outgoingFriendRequests : [],
            groups: Array.isArray(message.social.groups) ? message.social.groups : [],
            incomingGroupInvites: Array.isArray(message.social.incomingGroupInvites) ? message.social.incomingGroupInvites : [],
          });
        }

        if (message.type === 'friend-event') {
          if (enabled) onFriendNetworkChangeRef.current?.();
        }

        if (message.type === 'room-state') {
          if (!enabled) return;
          if (message.room?.id) {
            pendingInviteRoomRef.current = null;
            clearPendingRoomJoinRetry();
          }
          setMatchmaking(initialMatchmaking);
          setCurrentRoom(message.room ?? null);
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
          setRoomRaceStates(Array.isArray(message.raceStates) ? message.raceStates : []);
          setRoomExploreStates(Array.isArray(message.exploreStates) ? message.exploreStates : []);
          if (message.room?.id) {
            const url = new URL(window.location.href);
            if (message.room.demo) url.searchParams.delete('room');
            else url.searchParams.set('room', message.room.id);
            window.history.replaceState(null, '', url);
          }
        }

        if (message.type === 'room-left') {
          if (!enabled) return;
          pendingInviteRoomRef.current = null;
          clearPendingRoomJoinRetry();
          setRoomExit((current) => ({
            sequence: current.sequence + 1,
            roomId: typeof message.roomId === 'string' ? message.roomId : null,
            reason: typeof message.reason === 'string' ? message.reason : null,
          }));
          setCurrentRoom(null);
          setRoomMessages([]);
          setRoomRaceStates([]);
          setRoomExploreStates([]);
          setVoiceSignals([]);
          setMatchmaking(initialMatchmaking);
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.replaceState(null, '', url);
        }

        if (message.type === 'room-chat') {
          if (!enabled) return;
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
        }

        if (message.type === 'matchmaking-state') {
          if (!enabled) return;
          const rawState = message.state && typeof message.state === 'object' ? message.state : {};
          const scope = rawState.scope === 'studio' || rawState.scope === 'world'
            ? rawState.scope
            : null;
          const activityType = rawState.activityType === 'bmx-race' || rawState.activityType === 'straight-sprint'
            ? rawState.activityType
            : null;
          const nextMatchmaking: MultiplayerMatchmakingState = {
            active: rawState.active === true,
            scope,
            activityType,
            queuedAt: Number.isFinite(Number(rawState.queuedAt)) ? Number(rawState.queuedAt) : null,
            queuedRacers: Math.max(0, Math.min(4, Math.round(Number(rawState.queuedRacers) || 0))),
            message: typeof rawState.message === 'string' ? rawState.message.slice(0, 240) : '',
          };
          setMatchmaking(nextMatchmaking);
          if (nextMatchmaking.message) setStatus(nextMatchmaking.message);
        }

        if (message.type === 'room-safety-result') {
          if (!enabled) return;
          setStatus(message.message ?? 'Room safety action completed.');
          onFriendNetworkChangeRef.current?.();
        }

        if (message.type === 'pong') {
          const pingId = typeof message.id === 'string' ? message.id : '';
          const clientSentAt = pendingPingRef.current.get(pingId) ?? Number(message.clientSentAt);
          pendingPingRef.current.delete(pingId);
          const receivedAt = Date.now();
          const rttMs = Math.max(0, Math.round(receivedAt - clientSentAt));
          const serverNow = Number(message.serverNow);
          if (Number.isFinite(clientSentAt) && Number.isFinite(serverNow) && rttMs < 5000) {
            const clockOffsetMs = Math.round((serverNow + (rttMs / 2)) - receivedAt);
            const snapshot = {
              rttMs,
              clockOffsetMs,
              quality: latencyQualityForMs(rttMs),
              measuredAt: receivedAt,
            };
            setLatency(snapshot);
            socket.send(JSON.stringify({
              type: 'latency',
              rttMs: snapshot.rttMs,
              clockOffsetMs: snapshot.clockOffsetMs,
            }));
          }
        }

        if (message.type === 'race-sync' && message.state) {
          if (!enabled) return;
          const nextState = canonicalizeMultiplayerRaceState(message.state as MultiplayerRaceState);
          setRoomRaceStates((current) => [
            ...current.filter((state) => state.clientId !== nextState.clientId),
            nextState,
          ].slice(-32));
        }

        if (message.type === 'explore-sync' && message.state) {
          if (!enabled) return;
          const nextState = canonicalizeMultiplayerExploreState(message.state as MultiplayerExploreState);
          setRoomExploreStates((current) => [
            ...current.filter((state) => state.clientId !== nextState.clientId),
            nextState,
          ].slice(-32));
        }

        if (message.type === 'voice-signal' && message.signal) {
          if (!enabled) return;
          setVoiceSignals((current) => [
            ...current,
            message.signal as MultiplayerVoiceSignal,
          ].slice(-80));
        }

        if (message.type === 'room-error' || message.type === 'challenge-status' || message.type === 'error') {
          setStatus(message.message ?? 'Multiplayer status updated.');
        }

        if (message.type === 'challenge-incoming') {
          if (!enabled) return;
          setIncomingChallenges((current) => [
            ...current.filter((item) => item.challenge.id !== message.challenge?.id),
            { challenge: message.challenge, from: message.from },
          ].slice(-4));
          setStatus(`${message.from?.name ?? 'A rider'} sent a challenge.`);
        }

        if (message.type === 'match-invite') {
          if (!enabled) return;
          setIncomingMatchInvites((current) => [
            ...current.filter((item) => item.invite.id !== message.invite?.id),
            { invite: message.invite, from: message.from },
          ].slice(-6));
          setStatus(`${message.from?.name ?? 'A rider'} invited you to a match.`);
        }
      });

      socket.addEventListener('close', () => {
        if (socketRef.current !== socket) return;
        clearPendingRoomJoinRetry();
        const interruptedRoom = currentRoomRef.current;
        if (
          interruptedRoom
          && interruptedRoom.purpose === 'race'
          && !interruptedRoom.demo
          && !interruptedRoom.clubEventId
        ) {
          // Preserve the private room across a transient Wi-Fi/app interruption.
          // The next authenticated socket must still pass the server's room,
          // studio-club, racer-seat, and current-setup checks before rejoining.
          pendingInviteRoomRef.current = interruptedRoom.id;
        }
        setConnection('closed');
        setStatus('Multiplayer disconnected. Reconnecting...');
        socketRef.current = null;
        clearWattbikeCapacityGrant();
        setCurrentRoom(null);
        setIncomingMatchInvites([]);
        setRoomExploreStates([]);
        setLatency(initialLatency);
        setMatchmaking(initialMatchmaking);
        pendingPingRef.current.clear();
        if (pingTimerRef.current != null) {
          window.clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (capacityHeartbeatTimerRef.current != null) {
          window.clearInterval(capacityHeartbeatTimerRef.current);
          capacityHeartbeatTimerRef.current = null;
        }
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        clearWattbikeCapacityGrant();
        setConnection('error');
        setStatus('Could not reach TrackLab multiplayer.');
      });
    };

    void connect();

    return () => {
      cancelled = true;
      clearPendingRoomJoinRetry();
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (pingTimerRef.current != null) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (capacityHeartbeatTimerRef.current != null) {
        window.clearInterval(capacityHeartbeatTimerRef.current);
        capacityHeartbeatTimerRef.current = null;
      }
      pendingPingRef.current.clear();
      clearWattbikeCapacityGrant();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [
    capacityChannelEnabled,
    clearWattbikeCapacityGrant,
    clubTabletDemoDeviceToken,
    clubTabletDemoConfigurationKey,
    clubTabletSessionToken,
    enabled,
    identityScopeKey,
    publishWattbikeCapacityGrant,
    resetTransientMultiplayerState,
    sendLatencyPing,
    transportEnabled,
  ]);

  useEffect(() => {
    if (transportEnabled && connection === 'open') {
      void sendPresence();
    }
  }, [connection, sendPresence, transportEnabled]);

  useEffect(() => {
    if (
      !enabled
      || !clubTabletDemoDeviceToken
      || !clubTabletDemoConfiguration
      || connection !== 'open'
      || currentRoom?.demo
    ) return undefined;

    // The first join is sent with the welcome packet. Keep a low-frequency
    // retry while this authorized tablet is roomless so staggered activity or
    // configuration changes converge without asking anyone to toggle modes.
    const retryJoin = () => {
      const configuration = latestClubTabletDemoConfigurationRef.current;
      const activeTrack = latestTrackRef.current;
      if (!configuration || !activeTrack) return;
      send({
        type: 'join-club-demo',
        track: activeTrack,
        activityType: configuration.activityType,
        configurationId: configuration.configurationId,
      });
    };
    const timer = window.setInterval(retryJoin, 1_500);
    return () => window.clearInterval(timer);
  }, [
    clubTabletDemoConfiguration,
    clubTabletDemoDeviceToken,
    connection,
    currentRoom?.demo,
    enabled,
    send,
  ]);

  const createPrivateRoom = useCallback((setup?: MultiplayerRaceSetup) => {
    const racerSeatCount = quickRaceEnteredRacerCount(bikeCount);
    if (!racerSeatCount) {
      setStatus('Choose at least one athlete before creating a race.');
      return false;
    }
    pendingInviteRoomRef.current = null;
    setStatus('Opening private room.');
    return send({
      type: 'create-room',
      private: true,
      racerSeatCount,
      track: currentTrack,
      ...(setup ? { setup } : {}),
    });
  }, [bikeCount, currentTrack, send]);

  const createMatch = useCallback((targetIds: string[], localSeatCount = 1) => {
    setStatus('Sending match invites.');
    return send({ type: 'create-match', targetIds, localSeatCount, track: currentTrack });
  }, [currentTrack, send]);

  const respondToMatchInvite = useCallback((inviteId: string, accepted: boolean) => {
    setIncomingMatchInvites((current) => current.filter((item) => item.invite.id !== inviteId));
    return send({ type: 'match-response', inviteId, accepted });
  }, [send]);

  const joinRoom = useCallback((roomId: string) => {
    const normalizedRoomId = normalizeMultiplayerRoomId(roomId);
    if (!normalizedRoomId) return false;
    pendingInviteRoomRef.current = normalizedRoomId;
    setStatus(`Joining ${normalizedRoomId}.`);
    return send({ type: 'join-room', roomId: normalizedRoomId });
  }, [send]);

  const joinClubEvent = useCallback((eventId: string) => {
    const normalizedEventId = eventId.trim().slice(0, 180);
    if (!normalizedEventId) return false;
    setStatus('Joining the coach-led Club Event.');
    return send({ type: 'join-club-event', eventId: normalizedEventId });
  }, [send]);

  const leaveRoom = useCallback(() => {
    return send({ type: 'leave-room' });
  }, [send]);

  const startClubDemoRace = useCallback(() => {
    setStatus('Starting the shared Club Tablet demo race.');
    return send({ type: 'club-demo-start' });
  }, [send]);

  const syncTrack = useCallback((nextTrack: TrackRecord) => {
    if (!currentRoom || currentRoom.setup) {
      return false;
    }

    return send({ type: 'room-track', track: trackSummary(nextTrack) });
  }, [currentRoom, send]);

  const sendRoomChat = useCallback((text: string) => {
    return send({ type: 'room-chat', text });
  }, [send]);

  const reportRoomMember = useCallback((targetId: string) => {
    setStatus('Sending room safety report.');
    return send({ type: 'room-report', targetId, reason: 'harassment' });
  }, [send]);

  const blockRoomMember = useCallback((targetId: string) => {
    setStatus('Blocking room rider.');
    return send({ type: 'room-block', targetId });
  }, [send]);

  const startTrackVote = useCallback((candidates: MultiplayerTrackVoteCandidate[]) => {
    setStatus('Starting track vote.');
    return send({ type: 'room-vote-start', candidates });
  }, [send]);

  const submitTrackVote = useCallback((trackId: string) => {
    setStatus('Submitting track vote.');
    return send({ type: 'room-vote', trackId });
  }, [send]);

  const chooseRoomRoute = useCallback((choice: SplitBranchChoice) => {
    return send({ type: 'room-route-choice', choice });
  }, [send]);

  const resetRoomFlow = useCallback(() => {
    return send({ type: 'room-reset-lobby' });
  }, [send]);

  const currentRoomId = currentRoom?.id ?? null;
  const demoParticipantEligible = useMemo(() => {
    if (!currentRoom?.demo) return true;
    const localMember = currentRoom.members.find((member) => member.id === clientId);
    return localMember?.demoParticipantEligible === true;
  }, [clientId, currentRoom]);
  const sendVoiceSignal = useCallback((targetId: string | null, signal: MultiplayerVoiceSignalPayload) => {
    if (!currentRoomId) {
      return false;
    }
    return send({ type: 'voice-signal', targetId, signal });
  }, [currentRoomId, send]);

  const sendRaceState = useCallback((state: Omit<MultiplayerRaceState, 'clientId' | 'riderName' | 'roomId' | 'at'>) => {
    if (!currentRoom || (currentRoom.demo && !demoParticipantEligible)) {
      return false;
    }
    if (
      (currentRoom.demo || currentRoom.setup)
      && (
        !currentRoom.flow.raceToken
        || state.raceToken !== currentRoom.flow.raceToken
      )
    ) {
      // Never relabel a previous generation's finished packet with the new
      // token while the next synchronized countdown is arming.
      return false;
    }

    return send({
      type: 'race-sync',
      state: {
        ...state,
        roomId: currentRoom.id,
      },
    });
  }, [currentRoom, demoParticipantEligible, send]);

  const syncExploreRoute = useCallback((route: ExploreRoute) => {
    if (!currentRoom || (currentRoom.demo && !demoParticipantEligible)) {
      return false;
    }
    return send({ type: 'room-explore-route', route });
  }, [currentRoom, demoParticipantEligible, send]);

  const controlExploreSession = useCallback((action: 'start' | 'pause' | 'resume' | 'reset') => {
    if (
      !currentRoom
      || (currentRoom.demo && action !== 'reset' && !demoParticipantEligible)
    ) {
      return false;
    }
    return send({ type: 'room-explore-action', action });
  }, [currentRoom, demoParticipantEligible, send]);

  const sendExploreState = useCallback((state: Omit<MultiplayerExploreState, 'clientId' | 'roomId' | 'at'>) => {
    if (!currentRoom || (currentRoom.demo && !demoParticipantEligible)) {
      return false;
    }
    return send({
      type: 'explore-sync',
      state: {
        ...state,
        roomId: currentRoom.id,
      },
    });
  }, [currentRoom, demoParticipantEligible, send]);

  const challengeRider = useCallback((targetId: string) => {
    setStatus('Sending challenge.');
    return send({ type: 'challenge', targetId, track: currentTrack });
  }, [currentTrack, send]);

  const createGroup = useCallback((name: string) => {
    setStatus('Creating group.');
    return send({ type: 'group-create', name });
  }, [send]);

  const inviteToGroup = useCallback((groupId: string, targetId: string) => {
    setStatus('Sending group invite.');
    return send({ type: 'group-invite', groupId, targetId });
  }, [send]);

  const respondToGroupInvite = useCallback((inviteId: string, accepted: boolean) => {
    return send({ type: 'group-invite-response', inviteId, accepted });
  }, [send]);

  const quickMatch = useCallback((
    scope: MultiplayerMatchmakingScope = 'world',
    setup?: MultiplayerRaceSetup,
  ) => {
    if (!setup) {
      setStatus('Choose Race Intervals or Straight Sprint settings before matchmaking.');
      return false;
    }
    const racerSeatCount = quickRaceEnteredRacerCount(bikeCount);
    if (!racerSeatCount) {
      setStatus('Choose at least one athlete before finding a race.');
      return false;
    }
    pendingInviteRoomRef.current = null;
    setStatus(scope === 'studio'
      ? 'Looking for this studio’s authorized tablets.'
      : 'Looking for racers worldwide.');
    return send({ type: 'quick-race', scope, setup, racerSeatCount });
  }, [bikeCount, send]);

  const cancelMatchmaking = useCallback(() => {
    setStatus('Leaving the matchmaking queue.');
    return send({ type: 'matchmaking-cancel' });
  }, [send]);

  const startStudioMatch = useCallback(() => {
    setStatus('Starting with the studio racers who are ready now.');
    return send({ type: 'quick-race-start-now' });
  }, [send]);

  const setRoomReady = useCallback((ready: boolean) => {
    if (!currentRoom?.setup) return false;
    if (ready) {
      const enteredRacerCount = quickRaceEnteredRacerCount(bikeCount);
      const localMember = currentRoom.members.find((member) => member.id === clientId);
      const assignedSeatCount = localMember?.roomRole === 'racer'
        ? quickRaceEnteredRacerCount(Math.round(localMember.racerSeatCount ?? 1))
        : null;
      if (!enteredRacerCount || !assignedSeatCount || enteredRacerCount < assignedSeatCount) {
        setStatus(assignedSeatCount && assignedSeatCount > 1
          ? `Choose all ${assignedSeatCount} athletes assigned to this device before tapping Ready.`
          : 'Choose an athlete before tapping Ready.');
        return false;
      }
    }
    return send({
      type: 'room-ready',
      ready,
      setupRevision: currentRoom.setup.revision,
    });
  }, [bikeCount, clientId, currentRoom, send]);

  const startRoomRace = useCallback(() => {
    if (!currentRoom?.setup) return false;
    if (!quickRaceEnteredRacerCount(bikeCount)) {
      setStatus('Choose an athlete before starting the race.');
      return false;
    }
    setStatus('Starting every ready racer together.');
    return send({ type: 'room-start' });
  }, [bikeCount, currentRoom, send]);

  const updateRoomSetup = useCallback((setup: MultiplayerRaceSetup) => {
    if (!currentRoom?.setup) return false;
    setStatus('Confirming the new setup for everyone.');
    return send({ type: 'room-setup', setup });
  }, [currentRoom, send]);

  const beginRoomSetupSelection = useCallback(() => {
    if (!currentRoom?.setup) return false;
    setStatus('Choose the next Race Intervals or Straight Sprint setup.');
    return send({ type: 'room-setup-edit' });
  }, [currentRoom, send]);

  const raceAgain = useCallback(() => {
    if (!currentRoom?.setup) return false;
    if (!quickRaceEnteredRacerCount(bikeCount)) {
      setStatus('Choose an athlete before racing again.');
      return false;
    }
    setStatus('Starting the next race with the same group.');
    return send({ type: 'room-next-round' });
  }, [bikeCount, currentRoom, send]);

  const respondToChallenge = useCallback((challengeId: string, accepted: boolean) => {
    setIncomingChallenges((current) => current.filter((item) => item.challenge.id !== challengeId));
    return send({ type: 'challenge-response', challengeId, accepted });
  }, [send]);

  const inviteUrl = useMemo(() => {
    if (!currentRoom || currentRoom.demo) {
      return '';
    }

    const url = new URL(trackLabPublicOrigin);
    url.searchParams.set('room', currentRoom.id);
    return url.toString();
  }, [currentRoom]);

  return {
    blockRoomMember,
    challengeRider,
    chooseRoomRoute,
    clientId,
    controlExploreSession,
    connection,
    createGroup,
    createMatch,
    createPrivateRoom,
    currentRoom,
    demoParticipantEligible,
    incomingChallenges,
    incomingMatchInvites,
    inviteUrl,
    inviteToGroup,
    joinClubEvent,
    joinRoom,
    latency,
    leaveRoom,
    matchmaking,
    onlineRiders,
    profile,
    profileReadOnly,
    quickMatch,
    cancelMatchmaking,
    startStudioMatch,
    setRoomReady,
    startRoomRace,
    beginRoomSetupSelection,
    updateRoomSetup,
    raceAgain,
    reportRoomMember,
    respondToChallenge,
    roomMessages,
    roomExit,
    roomExploreStates,
    roomRaceStates,
    rooms,
    sendRaceState,
    sendExploreState,
    sendRoomChat,
    sendVoiceSignal,
    setProfile,
    startTrackVote,
    startClubDemoRace,
    status,
    submitTrackVote,
    syncTrack,
    syncExploreRoute,
    resetRoomFlow,
    voiceSignals,
    respondToGroupInvite,
    respondToMatchInvite,
    social,
  };
}
