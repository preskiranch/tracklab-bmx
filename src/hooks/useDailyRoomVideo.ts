import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DailyCall,
  DailyParticipant,
} from '@daily-co/daily-js';
import type { MultiplayerRoom } from '../types';

type DailyVideoConfig = {
  audio: false;
  available: boolean;
  chat: false;
  maxParticipants: number;
  privateRoomsOnly: true;
  provider: 'daily';
  recording: false;
  screenSharing: false;
  sdkVersion: string;
  under13Allowed: false;
};

type DailyVideoAccess = DailyVideoConfig & {
  expiresAt: number;
  roomUrl: string;
  token: string;
  userName: string;
};

type UseDailyRoomVideoOptions = {
  currentRoom: MultiplayerRoom | null;
  currentUserId: string | null;
  enabled: boolean;
  raceFinished: boolean;
  riderName: string;
};

export type TrackLabVideoParticipant = {
  id: string;
  cameraOn: boolean;
  local: boolean;
  name: string;
};

export type DailyRoomVideoController = {
  available: boolean;
  bindVideoTile: (participantId: string, host: HTMLDivElement | null) => void;
  cameraOn: boolean;
  eligible: boolean;
  join: () => Promise<void>;
  joined: boolean;
  joining: boolean;
  leave: () => Promise<void>;
  maxParticipants: number;
  participants: TrackLabVideoParticipant[];
  status: string;
  supported: boolean;
  toggleCamera: () => Promise<void>;
};

const defaultParticipantLimit = 4;
const postRaceVideoSeconds = 15;

async function videoApi<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Workout video returned ${response.status}.`);
  }
  return payload;
}

function browserSupportsWorkoutVideo() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof window.RTCPeerConnection !== 'undefined';
}

function dailyVideoErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('notallowed')) {
    return 'Camera permission was not granted. Allow the camera in browser settings and try again.';
  }
  if (normalized.includes('notfound') || normalized.includes('requested device')) {
    return 'No camera was found on this device.';
  }
  if (normalized.includes('meeting-full')) {
    return 'This private camera room already has four racers.';
  }
  if (normalized.includes('cancelled')) {
    return 'Workout camera connection cancelled.';
  }
  return message || fallback;
}

function uniqueParticipants(call: DailyCall) {
  const bySessionId = new Map<string, DailyParticipant>();
  Object.values(call.participants()).forEach((participant) => {
    if (participant?.session_id) {
      bySessionId.set(participant.session_id, participant);
    }
  });
  return [...bySessionId.values()].slice(0, defaultParticipantLimit);
}

export function useDailyRoomVideo({
  currentRoom,
  currentUserId,
  enabled,
  raceFinished,
  riderName,
}: UseDailyRoomVideoOptions): DailyRoomVideoController {
  const [config, setConfig] = useState<DailyVideoConfig | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [participants, setParticipants] = useState<TrackLabVideoParticipant[]>([]);
  const [status, setStatus] = useState('Join a private multiplayer room to share a workout camera.');
  const callRef = useRef<DailyCall | null>(null);
  const joinedRoomIdRef = useRef<string | null>(null);
  const cameraOnRef = useRef(false);
  const leavingRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const tileHostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const unbindEventsRef = useRef<(() => void) | null>(null);

  const roomId = currentRoom?.id ?? null;
  const roomMember = useMemo(
    () => currentRoom?.members.find((member) => member.id === currentUserId) ?? null,
    [currentRoom, currentUserId],
  );
  const privateRoom = currentRoom?.private === true;
  const eligible = Boolean(
    enabled
    && roomId
    && privateRoom
    && roomMember?.roomRole === 'racer'
    && !raceFinished,
  );
  const supported = browserSupportsWorkoutVideo();

  const removeVideoElement = useCallback((participantId: string) => {
    const video = videoElementsRef.current.get(participantId);
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      videoElementsRef.current.delete(participantId);
    }
  }, []);

  const renderCurrentParticipants = useCallback(() => {
    const call = callRef.current;
    if (!call) {
      return;
    }

    const dailyParticipants = uniqueParticipants(call);
    const visibleIds = new Set(dailyParticipants.map((participant) => participant.session_id));
    setParticipants(dailyParticipants.map((participant) => ({
      id: participant.session_id,
      cameraOn: Boolean(participant.video || participant.tracks.video.persistentTrack),
      local: participant.local,
      name: participant.user_name || 'TrackLab rider',
    })));

    [...videoElementsRef.current.keys()]
      .filter((participantId) => !visibleIds.has(participantId))
      .forEach(removeVideoElement);

    dailyParticipants.forEach((participant) => {
      const participantId = participant.session_id;
      const host = tileHostsRef.current.get(participantId);
      const track = participant.tracks.video.persistentTrack;
      if (!host || !track || track.readyState === 'ended') {
        removeVideoElement(participantId);
        return;
      }

      let video = videoElementsRef.current.get(participantId);
      if (!video) {
        video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.className = 'daily-video-player';
        host.replaceChildren(video);
        videoElementsRef.current.set(participantId, video);
      }

      const currentTrack = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (currentTrack?.id !== track.id) {
        video.srcObject = new MediaStream([track]);
      }
      void video.play().catch(() => undefined);
    });
  }, [removeVideoElement]);

  const unbindCallEvents = useCallback(() => {
    unbindEventsRef.current?.();
    unbindEventsRef.current = null;
  }, []);

  const bindCallEvents = useCallback((call: DailyCall) => {
    const refresh = () => window.setTimeout(renderCurrentParticipants, 0);
    const connectionError = () => {
      setStatus('Workout video lost its connection. The race is still running.');
      refresh();
    };
    const cameraError = () => {
      setStatus('A workout camera needs attention. The race is unaffected.');
      refresh();
    };
    call.on('participant-joined', refresh);
    call.on('participant-updated', refresh);
    call.on('participant-left', refresh);
    call.on('track-started', refresh);
    call.on('track-stopped', refresh);
    call.on('error', connectionError);
    call.on('nonfatal-error', cameraError);
    unbindEventsRef.current = () => {
      call.off('participant-joined', refresh);
      call.off('participant-updated', refresh);
      call.off('participant-left', refresh);
      call.off('track-started', refresh);
      call.off('track-stopped', refresh);
      call.off('error', connectionError);
      call.off('nonfatal-error', cameraError);
    };
  }, [renderCurrentParticipants]);

  const leave = useCallback(async () => {
    joinAttemptRef.current += 1;
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;
    const call = callRef.current;
    joinedRoomIdRef.current = null;
    cameraOnRef.current = false;
    setJoined(false);
    setJoining(false);
    setCameraOn(false);
    setParticipants([]);

    try {
      unbindCallEvents();
      if (call && !call.isDestroyed()) {
        call.setLocalAudio(false, { forceDiscardTrack: true });
        call.setLocalVideo(false);
        await call.leave().catch(() => undefined);
        await call.destroy().catch(() => undefined);
      }
    } finally {
      callRef.current = null;
      [...videoElementsRef.current.keys()].forEach(removeVideoElement);
      tileHostsRef.current.forEach((host) => host.replaceChildren());
      leavingRef.current = false;
      setStatus(roomId
        ? 'Workout camera off.'
        : 'Join a private multiplayer room to share a workout camera.');
    }
  }, [removeVideoElement, roomId, unbindCallEvents]);

  const join = useCallback(async () => {
    if (joining || joined) {
      return;
    }
    if (!privateRoom) {
      setStatus('Workout cameras are available only in private invited rooms.');
      return;
    }
    if (!roomId || !eligible) {
      setStatus('Join the private room as a racer before sharing a camera.');
      return;
    }
    if (!supported) {
      setStatus('Workout video needs a current secure browser with camera support.');
      return;
    }

    setJoining(true);
    setStatus('Connecting private camera-only video…');
    const attemptId = joinAttemptRef.current + 1;
    joinAttemptRef.current = attemptId;
    const ensureJoinIsActive = () => {
      if (joinAttemptRef.current !== attemptId) {
        throw new Error('Workout video connection was cancelled.');
      }
    };

    try {
      const access = await videoApi<DailyVideoAccess>('/api/multiplayer/video/token', {
        method: 'POST',
        body: JSON.stringify({ roomId, safetyConfirmed: true }),
      });
      ensureJoinIsActive();
      const { default: Daily } = await import('@daily-co/daily-js');
      ensureJoinIsActive();
      if (!Daily.supportedBrowser().supported) {
        throw new Error('This browser cannot display Daily workout video.');
      }

      const call = Daily.createCallObject({
        allowMultipleCallInstances: false,
        audioSource: false,
        startAudioOff: true,
        startVideoOff: true,
        subscribeToTracksAutomatically: true,
        videoSource: true,
        aboutClient: {
          app: 'tracklab-bmx',
          feature: 'private-workout-camera',
        },
        dailyConfig: {
          alwaysIncludeMicInPermissionPrompt: false,
          alwaysIncludeCamInPermissionPrompt: true,
          enableIndependentDevicePermissionPrompts: true,
        },
      });
      callRef.current = call;
      bindCallEvents(call);
      await call.join({
        audioSource: false,
        startAudioOff: true,
        startVideoOff: true,
        token: access.token,
        url: access.roomUrl,
        userName: access.userName || riderName,
        videoSource: true,
      });
      ensureJoinIsActive();
      call.setLocalAudio(false, { forceDiscardTrack: true });
      call.setLocalVideo(true);
      joinedRoomIdRef.current = roomId;
      cameraOnRef.current = true;
      setJoined(true);
      setCameraOn(true);
      setStatus('Workout camera live. Audio, recording, chat and screen sharing are disabled.');
      renderCurrentParticipants();
    } catch (error) {
      const message = dailyVideoErrorMessage(error, 'Workout video could not start.');
      await leave();
      setStatus(message);
    } finally {
      setJoining(false);
    }
  }, [
    bindCallEvents,
    eligible,
    joined,
    joining,
    leave,
    privateRoom,
    renderCurrentParticipants,
    riderName,
    roomId,
    supported,
  ]);

  const toggleCamera = useCallback(async () => {
    const call = callRef.current;
    if (!call || !joined || call.isDestroyed()) {
      return;
    }

    try {
      const nextCameraOn = !cameraOnRef.current;
      call.setLocalAudio(false, { forceDiscardTrack: true });
      call.setLocalVideo(nextCameraOn);
      cameraOnRef.current = nextCameraOn;
      setCameraOn(nextCameraOn);
      setStatus(nextCameraOn
        ? 'Workout camera live. Audio and recording remain disabled.'
        : 'Camera off. You can still see the private room.');
      window.setTimeout(renderCurrentParticipants, 0);
    } catch (error) {
      setStatus(dailyVideoErrorMessage(error, 'The camera could not change state.'));
    }
  }, [joined, renderCurrentParticipants]);

  const bindVideoTile = useCallback((participantId: string, host: HTMLDivElement | null) => {
    if (!host) {
      tileHostsRef.current.delete(participantId);
      removeVideoElement(participantId);
      return;
    }

    tileHostsRef.current.set(participantId, host);
    renderCurrentParticipants();
  }, [removeVideoElement, renderCurrentParticipants]);

  useEffect(() => {
    if (!enabled || !roomId) {
      setConfig(null);
      if (!joinedRoomIdRef.current) {
        setStatus('Join a private multiplayer room to share a workout camera.');
      }
      return;
    }

    let cancelled = false;
    if (!privateRoom) {
      setConfig(null);
      setStatus('Workout cameras are available only in private invited rooms.');
      return;
    }

    setStatus('Checking private Daily workout video…');
    void videoApi<DailyVideoConfig>('/api/multiplayer/video/config')
      .then((nextConfig) => {
        if (cancelled) {
          return;
        }
        setConfig(nextConfig);
        setStatus(nextConfig.available
          ? 'Camera-only video ready. Nothing is shared until you confirm the safety rules.'
          : 'Daily workout video needs its server credential.');
      })
      .catch((error) => {
        if (!cancelled) {
          setConfig(null);
          setStatus(dailyVideoErrorMessage(error, 'Workout video availability could not be checked.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, privateRoom, roomId]);

  useEffect(() => {
    if (
      joinedRoomIdRef.current
      && (!enabled || !privateRoom || joinedRoomIdRef.current !== roomId)
    ) {
      void leave();
    }
  }, [enabled, leave, privateRoom, roomId]);

  useEffect(() => {
    if (!joined || !raceFinished) {
      return;
    }
    setStatus(`Race complete. Private workout video closes in ${postRaceVideoSeconds} seconds.`);
    const timer = window.setTimeout(() => {
      void leave();
    }, postRaceVideoSeconds * 1_000);
    return () => window.clearTimeout(timer);
  }, [joined, leave, raceFinished]);

  useEffect(() => () => {
    void leave();
  }, [leave]);

  return {
    available: Boolean(config?.available),
    bindVideoTile,
    cameraOn,
    eligible,
    join,
    joined,
    joining,
    leave,
    maxParticipants: config?.maxParticipants ?? defaultParticipantLimit,
    participants,
    status,
    supported,
    toggleCamera,
  };
}
