import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MultiplayerChallenge,
  MultiplayerRaceState,
  MultiplayerRider,
  MultiplayerRoom,
  MultiplayerRoomMessage,
  MultiplayerTrackSummary,
  MultiplayerTrackVoteCandidate,
  MultiplayerVoiceSignal,
  MultiplayerVoiceSignalPayload,
  SplitBranchChoice,
  TrackRecord,
} from '../types';

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

type MultiplayerProfile = {
  guestKey: string;
  name: string;
  email: string;
  available: boolean;
  membershipTier: 'visitor' | 'spectator' | 'racer';
};

type UseMultiplayerOptions = {
  enabled: boolean;
  track: TrackRecord;
  bikeCount: number;
};

type IncomingChallenge = {
  challenge: MultiplayerChallenge;
  from: MultiplayerRider;
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
  window.localStorage.setItem(profileStorageKey, JSON.stringify(profile));
}

function multiplayerUrl() {
  const configured = import.meta.env.VITE_TRACKLAB_MULTIPLAYER_URL?.trim();
  if (configured) {
    return configured;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/multiplayer`;
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

export function useMultiplayer({ enabled, track, bikeCount }: UseMultiplayerOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingInviteRoomRef = useRef<string | null>(null);
  const latestProfileRef = useRef<MultiplayerProfile | null>(null);
  const latestBikeCountRef = useRef(bikeCount);
  const latestTrackRef = useRef<MultiplayerTrackSummary | null>(null);
  const [profile, setProfileState] = useState<MultiplayerProfile>(readProfile);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [clientId, setClientId] = useState<string | null>(null);
  const [onlineRiders, setOnlineRiders] = useState<MultiplayerRider[]>([]);
  const [rooms, setRooms] = useState<MultiplayerRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<MultiplayerRoom | null>(null);
  const [roomMessages, setRoomMessages] = useState<MultiplayerRoomMessage[]>([]);
  const [roomRaceStates, setRoomRaceStates] = useState<MultiplayerRaceState[]>([]);
  const [voiceSignals, setVoiceSignals] = useState<MultiplayerVoiceSignal[]>([]);
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingChallenge[]>([]);
  const [status, setStatus] = useState('Multiplayer offline.');

  const currentTrack = useMemo(() => trackSummary(track), [track.country, track.id, track.name, track.state]);

  useEffect(() => {
    latestProfileRef.current = profile;
    latestBikeCountRef.current = bikeCount;
    latestTrackRef.current = currentTrack;
  }, [bikeCount, currentTrack, profile]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const sendPresence = useCallback((nextProfile = profile) => {
    return send({
      type: 'presence',
      guestKey: nextProfile.guestKey,
      name: nextProfile.name,
      email: nextProfile.email,
      available: nextProfile.available,
      membershipTier: nextProfile.membershipTier,
      bikeCount,
      track: currentTrack,
    });
  }, [bikeCount, currentTrack, profile, send]);

  const setProfile = useCallback((patch: Partial<Pick<MultiplayerProfile, 'guestKey' | 'name' | 'email' | 'available' | 'membershipTier'>>) => {
    setProfileState((current) => {
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
  }, [sendPresence]);

  useEffect(() => {
    writeProfile(profile);
    writeProfileCookie(profile.guestKey);
    updateManifestProfile(profile.guestKey);
  }, [profile]);

  useEffect(() => {
    pendingInviteRoomRef.current = new URLSearchParams(window.location.search).get('room');
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnection('idle');
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      setConnection('connecting');
      setStatus('Connecting to TrackLab multiplayer.');
      const socket = new WebSocket(multiplayerUrl());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        const latestProfile = latestProfileRef.current ?? profile;
        setConnection('open');
        setStatus('Multiplayer online.');
        socket.send(JSON.stringify({
          type: 'hello',
          guestKey: latestProfile.guestKey,
          name: latestProfile.name,
          email: latestProfile.email,
          available: latestProfile.available,
          membershipTier: latestProfile.membershipTier,
          bikeCount: latestBikeCountRef.current,
          track: latestTrackRef.current ?? currentTrack,
        }));
      });

      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data as string);

        if (message.type === 'connected') {
          setClientId(message.clientId ?? null);
        }

        if (message.type === 'welcome') {
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
          setOnlineRiders(Array.isArray(message.riders) ? message.riders : []);
          setRooms(Array.isArray(message.rooms) ? message.rooms : []);
        }

        if (message.type === 'room-state') {
          setCurrentRoom(message.room ?? null);
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
          setRoomRaceStates(Array.isArray(message.raceStates) ? message.raceStates : []);
          if (message.room?.id) {
            const url = new URL(window.location.href);
            url.searchParams.set('room', message.room.id);
            window.history.replaceState(null, '', url);
          }
        }

        if (message.type === 'room-left') {
          setCurrentRoom(null);
          setRoomMessages([]);
          setRoomRaceStates([]);
          setVoiceSignals([]);
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.replaceState(null, '', url);
        }

        if (message.type === 'room-chat') {
          setRoomMessages(formatRoomMessages(Array.isArray(message.messages) ? message.messages : []));
        }

        if (message.type === 'race-sync' && message.state) {
          const nextState = message.state as MultiplayerRaceState;
          setRoomRaceStates((current) => [
            ...current.filter((state) => state.clientId !== nextState.clientId),
            nextState,
          ].slice(-32));
        }

        if (message.type === 'voice-signal' && message.signal) {
          setVoiceSignals((current) => [
            ...current,
            message.signal as MultiplayerVoiceSignal,
          ].slice(-80));
        }

        if (message.type === 'room-error' || message.type === 'challenge-status' || message.type === 'error') {
          setStatus(message.message ?? 'Multiplayer status updated.');
        }

        if (message.type === 'challenge-incoming') {
          setIncomingChallenges((current) => [
            ...current.filter((item) => item.challenge.id !== message.challenge?.id),
            { challenge: message.challenge, from: message.from },
          ].slice(-4));
          setStatus(`${message.from?.name ?? 'A rider'} sent a challenge.`);
        }
      });

      socket.addEventListener('close', () => {
        setConnection('closed');
        setStatus('Multiplayer disconnected. Reconnecting...');
        socketRef.current = null;
        setCurrentRoom(null);
        if (!cancelled) {
          reconnectTimerRef.current = window.setTimeout(connect, 1400);
        }
      });

      socket.addEventListener('error', () => {
        setConnection('error');
        setStatus('Could not reach TrackLab multiplayer.');
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (enabled && connection === 'open') {
      void sendPresence();
    }
  }, [connection, enabled, sendPresence]);

  const createPrivateRoom = useCallback(() => {
    setStatus('Opening private room.');
    return send({ type: 'create-room', private: true, track: currentTrack });
  }, [currentTrack, send]);

  const createPublicRoom = useCallback(() => {
    setStatus('Opening public lobby.');
    return send({ type: 'create-room', private: false, track: currentTrack });
  }, [currentTrack, send]);

  const joinRoom = useCallback((roomId: string) => {
    setStatus(`Joining ${roomId}.`);
    return send({ type: 'join-room', roomId });
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

  const sendVoiceSignal = useCallback((targetId: string | null, signal: MultiplayerVoiceSignalPayload) => {
    return send({ type: 'voice-signal', targetId, signal });
  }, [send]);

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

  const challengeRider = useCallback((targetId: string) => {
    setStatus('Sending challenge.');
    return send({ type: 'challenge', targetId, track: currentTrack });
  }, [currentTrack, send]);

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

    const url = new URL(window.location.href);
    url.searchParams.set('room', currentRoom.id);
    return url.toString();
  }, [currentRoom]);

  return {
    challengeRider,
    chooseRoomRoute,
    clientId,
    connection,
    createPrivateRoom,
    createPublicRoom,
    currentRoom,
    incomingChallenges,
    inviteUrl,
    joinRoom,
    leaveRoom,
    onlineRiders,
    profile,
    quickMatch,
    respondToChallenge,
    roomMessages,
    roomRaceStates,
    rooms,
    sendRaceState,
    sendRoomChat,
    sendVoiceSignal,
    setProfile,
    startTrackVote,
    status,
    submitTrackVote,
    syncTrack,
    resetRoomFlow,
    voiceSignals,
  };
}
