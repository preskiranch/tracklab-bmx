import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MultiplayerRoom } from '../types';
import {
  loadZoomVideoSdk,
  type ZoomVideoClient,
  type ZoomVideoParticipant,
  type ZoomVideoSdk,
  type ZoomVideoStream,
  zoomVideoErrorMessage,
} from '../lib/zoomVideoSdk';

type ZoomVideoConfig = {
  available: boolean;
  maxParticipants: number;
  provider: 'zoom';
  recording: false;
  sdkVersion: string;
};

type ZoomVideoToken = ZoomVideoConfig & {
  expiresAt: number;
  sessionName: string;
  token: string;
  userName: string;
};

type UseZoomRoomVideoOptions = {
  currentRoom: MultiplayerRoom | null;
  currentUserId: string | null;
  enabled: boolean;
  riderName: string;
};

export type TrackLabVideoParticipant = {
  id: number;
  cameraOn: boolean;
  local: boolean;
  microphoneMuted: boolean;
  name: string;
};

export type ZoomRoomVideoController = {
  available: boolean;
  bindVideoTile: (userId: number, host: HTMLDivElement | null) => void;
  cameraOn: boolean;
  eligible: boolean;
  join: () => Promise<void>;
  joined: boolean;
  joining: boolean;
  leave: () => Promise<void>;
  maxParticipants: number;
  microphoneOn: boolean;
  participants: TrackLabVideoParticipant[];
  status: string;
  supported: boolean;
  toggleCamera: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
};

const defaultParticipantLimit = 4;
const receivedVideoQuality360p = 2;

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
    && typeof WebAssembly !== 'undefined';
}

export function useZoomRoomVideo({
  currentRoom,
  currentUserId,
  enabled,
  riderName,
}: UseZoomRoomVideoOptions): ZoomRoomVideoController {
  const [config, setConfig] = useState<ZoomVideoConfig | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [participants, setParticipants] = useState<TrackLabVideoParticipant[]>([]);
  const [status, setStatus] = useState('Join a multiplayer room to share a workout camera.');
  const sdkRef = useRef<ZoomVideoSdk | null>(null);
  const clientRef = useRef<ZoomVideoClient | null>(null);
  const streamRef = useRef<ZoomVideoStream | null>(null);
  const joinedRoomIdRef = useRef<string | null>(null);
  const localUserIdRef = useRef<number | null>(null);
  const audioConnectedRef = useRef(false);
  const cameraOnRef = useRef(false);
  const leavingRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const eventListenersRef = useRef<Array<[string, (payload: unknown) => void]>>([]);
  const tileContainersRef = useRef<Map<number, HTMLElement>>(new Map());
  const attachedUserIdsRef = useRef<Set<number>>(new Set());
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());

  const roomId = currentRoom?.id ?? null;
  const roomMember = useMemo(
    () => currentRoom?.members.find((member) => member.id === currentUserId) ?? null,
    [currentRoom, currentUserId],
  );
  const eligible = Boolean(enabled && roomId && roomMember?.roomRole === 'racer');
  const supported = browserSupportsWorkoutVideo();

  const removeAttachedVideo = useCallback(async (userId: number) => {
    if (!attachedUserIdsRef.current.has(userId)) {
      return;
    }

    attachedUserIdsRef.current.delete(userId);
    const stream = streamRef.current;
    if (!stream) {
      return;
    }

    try {
      const elements = await stream.detachVideo(userId);
      (Array.isArray(elements) ? elements : [elements]).forEach((element) => element?.remove());
    } catch {
      // The SDK may already have detached a stream after a peer disconnect.
    }
  }, []);

  const renderCurrentParticipants = useCallback(() => {
    renderChainRef.current = renderChainRef.current
      .then(async () => {
        const client = clientRef.current;
        const stream = streamRef.current;
        if (!client || !stream) {
          return;
        }

        const zoomParticipants = client.getAllUser().slice(0, defaultParticipantLimit);
        const localUserId = localUserIdRef.current;
        setParticipants(zoomParticipants.map((participant) => ({
          id: participant.userId,
          cameraOn: participant.bVideoOn,
          local: participant.userId === localUserId,
          microphoneMuted: participant.muted !== false,
          name: participant.displayName || 'TrackLab rider',
        })));

        const visibleIds = new Set(
          zoomParticipants
            .filter((participant) => participant.bVideoOn)
            .map((participant) => participant.userId),
        );
        await Promise.all(
          [...attachedUserIdsRef.current]
            .filter((userId) => !visibleIds.has(userId) || !tileContainersRef.current.has(userId))
            .map(removeAttachedVideo),
        );

        for (const participant of zoomParticipants) {
          const container = tileContainersRef.current.get(participant.userId);
          if (!participant.bVideoOn || !container || attachedUserIdsRef.current.has(participant.userId)) {
            continue;
          }

          try {
            const videoElement = await stream.attachVideo(participant.userId, receivedVideoQuality360p);
            if (videoElement instanceof HTMLElement) {
              videoElement.classList.add('zoom-video-player');
              container.replaceChildren(videoElement);
              attachedUserIdsRef.current.add(participant.userId);
            }
          } catch {
            // Keep the tile placeholder visible. A later SDK event will retry.
          }
        }
      })
      .catch(() => undefined);
  }, [removeAttachedVideo]);

  const unbindClientEvents = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      eventListenersRef.current.forEach(([event, listener]) => client.off(event, listener));
    }
    eventListenersRef.current = [];
  }, []);

  const bindClientEvents = useCallback((client: ZoomVideoClient) => {
    const refresh = () => {
      window.setTimeout(renderCurrentParticipants, 0);
    };
    const connectionChanged = (payload: unknown) => {
      const state = payload && typeof payload === 'object' && 'state' in payload
        ? String(payload.state).toLowerCase()
        : '';
      if (state.includes('fail')) {
        setStatus('Workout video lost its Zoom connection. The race is still running.');
      } else if (state.includes('reconnect')) {
        setStatus('Reconnecting workout video. The race is still running.');
      }
      refresh();
    };
    const mediaFailed = () => {
      setStatus('A camera or microphone needs attention. The race is unaffected.');
      refresh();
    };
    const listeners: Array<[string, (payload: unknown) => void]> = [
      ['user-added', refresh],
      ['user-updated', refresh],
      ['user-removed', refresh],
      ['peer-video-state-change', refresh],
      ['video-active-change', refresh],
      ['connection-change', connectionChanged],
      ['active-media-failed', mediaFailed],
    ];
    listeners.forEach(([event, listener]) => client.on(event, listener));
    eventListenersRef.current = listeners;
  }, [renderCurrentParticipants]);

  const leave = useCallback(async () => {
    joinAttemptRef.current += 1;
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;
    const client = clientRef.current;
    const stream = streamRef.current;
    const sdk = sdkRef.current;
    const wasCameraOn = cameraOnRef.current;
    joinedRoomIdRef.current = null;
    cameraOnRef.current = false;
    setJoined(false);
    setJoining(false);
    setCameraOn(false);
    setMicrophoneOn(false);
    setParticipants([]);

    try {
      if (stream && wasCameraOn) {
        await stream.stopVideo().catch(() => undefined);
      }
      if (stream && audioConnectedRef.current) {
        await stream.stopAudio().catch(() => undefined);
      }
      await Promise.all([...attachedUserIdsRef.current].map(removeAttachedVideo));
      unbindClientEvents();
      if (client) {
        await client.leave(false).catch(() => undefined);
      }
      if (sdk) {
        await sdk.destroyClient().catch(() => undefined);
      }
    } finally {
      clientRef.current = null;
      streamRef.current = null;
      sdkRef.current = null;
      localUserIdRef.current = null;
      audioConnectedRef.current = false;
      attachedUserIdsRef.current.clear();
      tileContainersRef.current.forEach((container) => container.replaceChildren());
      leavingRef.current = false;
      setStatus(roomId ? 'Workout camera off.' : 'Join a multiplayer room to share a workout camera.');
    }
  }, [removeAttachedVideo, roomId, unbindClientEvents]);

  const join = useCallback(async () => {
    if (joining || joined) {
      return;
    }
    if (!roomId || !eligible) {
      setStatus('Join a multiplayer room as a racer before sharing a camera.');
      return;
    }
    if (!supported) {
      setStatus('Workout video needs a current secure browser with camera support.');
      return;
    }

    setJoining(true);
    setStatus('Connecting private workout video…');
    const attemptId = joinAttemptRef.current + 1;
    joinAttemptRef.current = attemptId;
    const ensureJoinIsActive = () => {
      if (joinAttemptRef.current !== attemptId) {
        throw new Error('Workout video connection was cancelled.');
      }
    };
    try {
      const token = await videoApi<ZoomVideoToken>('/api/multiplayer/video/token', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      });
      ensureJoinIsActive();
      const sdk = await loadZoomVideoSdk();
      ensureJoinIsActive();
      const requirements = sdk.checkSystemRequirements();
      if (!requirements.video) {
        throw new Error('This browser cannot display Zoom workout video.');
      }

      const client = sdk.createClient();
      sdkRef.current = sdk;
      clientRef.current = client;
      await client.init('en-US', 'Global', {
        enforceMultipleVideos: true,
        isLogDetailed: false,
        leaveOnPageUnload: true,
        patchJsMedia: true,
        stayAwake: false,
      });
      ensureJoinIsActive();
      bindClientEvents(client);
      await client.join(token.sessionName, token.token, token.userName || riderName);
      ensureJoinIsActive();
      const stream = client.getMediaStream();
      streamRef.current = stream;
      localUserIdRef.current = client.getCurrentUserInfo().userId;
      joinedRoomIdRef.current = roomId;
      setJoined(true);
      await stream.startVideo({
        fps: 15,
        hd: false,
        originalRatio: true,
      });
      ensureJoinIsActive();
      cameraOnRef.current = true;
      setCameraOn(true);
      setMicrophoneOn(false);
      setStatus('Workout camera live. Microphone muted.');
      renderCurrentParticipants();
    } catch (error) {
      const message = zoomVideoErrorMessage(error, 'Workout video could not start.');
      await leave();
      setStatus(message);
    } finally {
      setJoining(false);
    }
  }, [
    bindClientEvents,
    eligible,
    joined,
    joining,
    leave,
    renderCurrentParticipants,
    riderName,
    roomId,
    supported,
  ]);

  const toggleCamera = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || !joined) {
      return;
    }

    try {
      if (cameraOnRef.current) {
        await stream.stopVideo();
        cameraOnRef.current = false;
        setCameraOn(false);
        if (localUserIdRef.current != null) {
          await removeAttachedVideo(localUserIdRef.current);
        }
        setStatus('Camera off. You can still see the room.');
      } else {
        await stream.startVideo({ fps: 15, hd: false, originalRatio: true });
        cameraOnRef.current = true;
        setCameraOn(true);
        setStatus(`Workout camera live. Microphone ${microphoneOn ? 'on' : 'muted'}.`);
      }
      renderCurrentParticipants();
    } catch (error) {
      setStatus(zoomVideoErrorMessage(error, 'The camera could not change state.'));
    }
  }, [joined, microphoneOn, removeAttachedVideo, renderCurrentParticipants]);

  const toggleMicrophone = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream || !joined) {
      return;
    }

    try {
      if (microphoneOn) {
        await stream.muteAudio();
        setMicrophoneOn(false);
        setStatus(`Workout camera ${cameraOn ? 'live' : 'off'}. Microphone muted.`);
      } else {
        if (!audioConnectedRef.current) {
          await stream.startAudio({
            mute: true,
            backgroundNoiseSuppression: true,
          });
          audioConnectedRef.current = true;
        }
        await stream.unmuteAudio();
        setMicrophoneOn(true);
        setStatus('Microphone on. Cadence and commentary remain local to each racer.');
      }
      renderCurrentParticipants();
    } catch (error) {
      setStatus(zoomVideoErrorMessage(error, 'The microphone could not change state.'));
    }
  }, [cameraOn, joined, microphoneOn, renderCurrentParticipants]);

  const bindVideoTile = useCallback((userId: number, host: HTMLDivElement | null) => {
    const priorContainer = tileContainersRef.current.get(userId);
    if (!host) {
      tileContainersRef.current.delete(userId);
      priorContainer?.remove();
      void removeAttachedVideo(userId);
      return;
    }

    const container = document.createElement('video-player-container');
    container.className = 'zoom-video-render-surface';
    host.replaceChildren(container);
    tileContainersRef.current.set(userId, container);
    if (priorContainer && priorContainer !== container) {
      priorContainer.remove();
      attachedUserIdsRef.current.delete(userId);
    }
    renderCurrentParticipants();
  }, [removeAttachedVideo, renderCurrentParticipants]);

  useEffect(() => {
    if (!enabled || !roomId) {
      setConfig(null);
      if (!joinedRoomIdRef.current) {
        setStatus('Join a multiplayer room to share a workout camera.');
      }
      return;
    }

    let cancelled = false;
    setStatus('Checking Zoom workout video…');
    void videoApi<ZoomVideoConfig>('/api/multiplayer/video/config')
      .then((nextConfig) => {
        if (cancelled) {
          return;
        }
        setConfig(nextConfig);
        setStatus(nextConfig.available
          ? 'Workout video ready. Camera and microphone stay off until you choose to join.'
          : 'Zoom workout video needs its server credentials.');
      })
      .catch((error) => {
        if (!cancelled) {
          setConfig(null);
          setStatus(zoomVideoErrorMessage(error, 'Workout video availability could not be checked.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, roomId]);

  useEffect(() => {
    if (
      joinedRoomIdRef.current
      && (!enabled || !eligible || joinedRoomIdRef.current !== roomId)
    ) {
      void leave();
    }
  }, [eligible, enabled, leave, roomId]);

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
    microphoneOn,
    participants,
    status,
    supported,
    toggleCamera,
    toggleMicrophone,
  };
}
