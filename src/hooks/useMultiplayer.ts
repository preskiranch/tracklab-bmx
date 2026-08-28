import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExploreRoute,
  MultiplayerChallenge,
  MultiplayerExploreState,
  MultiplayerLatencySnapshot,
  MultiplayerMatchInvite,
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
import type { ClubTabletSessionCredential } from '../lib/clubTabletStorage';
import {
  clubTabletWattbikeCapacityGrant,
  normalizeWattbikeCapacityMessage,
  wattbikeCapacityClientGrantTtlMs,
  type WattbikeCapacityState,
} from '../lib/wattbikeCapacity';
import { authenticatedWebSocketUrl, requestWebSocketTicket } from '../lib/webSocketTicket';
import { trackLabPublicOrigin } from '../lib/serviceOrigins';

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

type UseMultiplayerOptions = {
  enabled: boolean;
  /** Keeps only the authenticated capacity transport online outside multiplayer. */
  capacityChannelEnabled?: boolean;
  track: TrackRecord;
  bikeCount: number;
  wattbikeConnectionCount?: number;
  identityOverride?: MultiplayerIdentityOverride | null;
  clubTabletSession?: ClubTabletSessionCredential | null;
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

export const profileStorageKey = 'tracklab-bmx-multiplayer-profile-v1';
const profileCookieName = 'tracklab_profile_key';
const profileQueryParamNames = ['profileKey', 'profile'];

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
  const identityScopeRef = useRef('');
  const identityOverrideActiveRef = useRef(Boolean(identityOverride));
  const latestClubTabletSessionRef = useRef(clubTabletSession);
  const latestProfileRef = useRef<MultiplayerProfile | null>(null);
  const latestWattbikeConnectionCountRef = useRef(wattbikeConnectionCount);
  const latestTrackRef = useRef<MultiplayerTrackSummary | null>(null);
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
    pendingPingRef.current.clear();
  }, []);

  const currentTrack = useMemo(() => trackSummary(track), [track.country, track.id, track.name, track.state]);

  // Session renewal replaces the credential object every few seconds without
  // changing its identity token. Keep the live value available to transport
  // callbacks without reconnecting (and momentarily dropping the BLE grant).
  identityOverrideActiveRef.current = Boolean(identityOverride);
  latestClubTabletSessionRef.current = clubTabletSession;

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
        pendingInviteRoomRef.current = new URLSearchParams(window.location.search).get('room');
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
    if (!transportEnabled) {
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
      if (tabletSession) {
        try {
          const authorization = await import('../lib/clubTablet').then(
            ({ requestClubTabletMultiplayerTicket }) => requestClubTabletMultiplayerTicket(tabletSession),
          );
          if (cancelled) return;
          ticket = authorization?.ticket ?? '';
          if (!ticket) throw new Error('Club Tablet multiplayer authorization is unavailable.');
        } catch (error) {
          if (cancelled || (error as Error).name === 'AbortError') return;
          setConnection('error');
          setStatus('Club Tablet athlete authorization expired. Return to Club Tablet and choose the athlete again.');
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
          const pendingRoom = pendingInviteRoomRef.current;
          if (pendingRoom) {
            pendingInviteRoomRef.current = null;
            socket.send(JSON.stringify({ type: 'join-room', roomId: pendingRoom }));
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
          setCurrentRoom(message.room ?? null);
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
          setRoomRaceStates(Array.isArray(message.raceStates) ? message.raceStates : []);
          setRoomExploreStates(Array.isArray(message.exploreStates) ? message.exploreStates : []);
          if (message.room?.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('room', message.room.id);
            window.history.replaceState(null, '', url);
          }
        }

        if (message.type === 'room-left') {
          if (!enabled) return;
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
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.replaceState(null, '', url);
        }

        if (message.type === 'room-chat') {
          if (!enabled) return;
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
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
          const nextState = {
            ...(message.state as MultiplayerRaceState),
            receivedAt: Date.now(),
          };
          setRoomRaceStates((current) => [
            ...current.filter((state) => state.clientId !== nextState.clientId),
            nextState,
          ].slice(-32));
        }

        if (message.type === 'explore-sync' && message.state) {
          if (!enabled) return;
          const nextState = message.state as MultiplayerExploreState;
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
        setConnection('closed');
        setStatus('Multiplayer disconnected. Reconnecting...');
        socketRef.current = null;
        clearWattbikeCapacityGrant();
        setCurrentRoom(null);
        setIncomingMatchInvites([]);
        setRoomExploreStates([]);
        setLatency(initialLatency);
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

  const createPrivateRoom = useCallback(() => {
    setStatus('Opening private room.');
    return send({
      type: 'create-room',
      private: true,
      racerSeatCount: Math.max(1, bikeCount),
      track: currentTrack,
    });
  }, [bikeCount, currentTrack, send]);

  const createPublicRoom = useCallback(() => {
    setStatus('Opening public lobby.');
    return send({
      type: 'create-room',
      private: false,
      racerSeatCount: Math.max(1, bikeCount),
      track: currentTrack,
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
    setStatus(`Joining ${roomId}.`);
    return send({ type: 'join-room', roomId });
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

  const syncTrack = useCallback((nextTrack: TrackRecord) => {
    if (!currentRoom) {
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
  const sendVoiceSignal = useCallback((targetId: string | null, signal: MultiplayerVoiceSignalPayload) => {
    if (!currentRoomId) {
      return false;
    }
    return send({ type: 'voice-signal', targetId, signal });
  }, [currentRoomId, send]);

  const sendRaceState = useCallback((state: Omit<MultiplayerRaceState, 'clientId' | 'riderName' | 'roomId' | 'at'>) => {
    if (!currentRoom) {
      return false;
    }

    return send({
      type: 'race-sync',
      state: {
        ...state,
        roomId: currentRoom.id,
      },
    });
  }, [currentRoom, send]);

  const syncExploreRoute = useCallback((route: ExploreRoute) => {
    if (!currentRoom) {
      return false;
    }
    return send({ type: 'room-explore-route', route });
  }, [currentRoom, send]);

  const controlExploreSession = useCallback((action: 'start' | 'pause' | 'resume' | 'reset') => {
    if (!currentRoom) {
      return false;
    }
    return send({ type: 'room-explore-action', action });
  }, [currentRoom, send]);

  const sendExploreState = useCallback((state: Omit<MultiplayerExploreState, 'clientId' | 'roomId' | 'at'>) => {
    if (!currentRoom) {
      return false;
    }
    return send({
      type: 'explore-sync',
      state: {
        ...state,
        roomId: currentRoom.id,
      },
    });
  }, [currentRoom, send]);

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

  const quickMatch = useCallback(() => {
    setStatus('Looking for an available rider.');
    return send({ type: 'quick-match', track: currentTrack });
  }, [currentTrack, send]);

  const respondToChallenge = useCallback((challengeId: string, accepted: boolean) => {
    setIncomingChallenges((current) => current.filter((item) => item.challenge.id !== challengeId));
    return send({ type: 'challenge-response', challengeId, accepted });
  }, [send]);

  const inviteUrl = useMemo(() => {
    if (!currentRoom) {
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
    createPublicRoom,
    currentRoom,
    incomingChallenges,
    incomingMatchInvites,
    inviteUrl,
    inviteToGroup,
    joinClubEvent,
    joinRoom,
    latency,
    leaveRoom,
    onlineRiders,
    profile,
    profileReadOnly,
    quickMatch,
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
