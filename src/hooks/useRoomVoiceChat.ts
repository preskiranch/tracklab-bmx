import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MultiplayerRoom,
  MultiplayerVoiceSignal,
  MultiplayerVoiceSignalPayload,
} from '../types';

type UseRoomVoiceChatOptions = {
  currentRoom: MultiplayerRoom | null;
  currentUserId: string | null;
  voiceSignals: MultiplayerVoiceSignal[];
  sendVoiceSignal: (targetId: string | null, signal: MultiplayerVoiceSignalPayload) => boolean;
};

type RoomVoiceLifecycleRuntime = typeof import('../lib/roomVoiceLifecycle');
type RoomVoiceStreamManager = import('../lib/roomVoiceLifecycle').RoomVoiceStreamManager;
const roomVoiceStopped = new Error();

function supportsVoiceChat() {
  return typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof RTCPeerConnection !== 'undefined';
}

export function roomVoiceRacerIds(
  currentRoom: MultiplayerRoom | null,
  currentUserId: string | null,
) {
  return (currentRoom?.members ?? [])
    .filter((member) => member.roomRole === 'racer' && member.id !== currentUserId)
    .map((member) => member.id)
    .slice(0, 3);
}

export function claimRoomVoiceReady(
  readyPeers: Set<string>,
  currentUserId: string,
  remoteId: string,
) {
  if (readyPeers.has(remoteId)) return 0;
  readyPeers.add(remoteId);
  return currentUserId < remoteId ? 2 : 1;
}

export function useRoomVoiceChat({
  currentRoom,
  currentUserId,
  voiceSignals,
  sendVoiceSignal,
}: UseRoomVoiceChatOptions) {
  const [enabled, setEnabled] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState('Voice off.');
  const [remoteCount, setRemoteCount] = useState(0);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingPeersRef = useRef<Map<string, Promise<RTCPeerConnection>>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const readyPeersRef = useRef<Set<string>>(new Set());
  const offeredPeersRef = useRef<Set<string>>(new Set());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lifecycleGenerationRef = useRef(0);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const enabledRef = useRef(false);
  const lifecycleRuntimeRef = useRef<RoomVoiceLifecycleRuntime | null>(null);
  const lifecycleRuntimePromiseRef = useRef<Promise<RoomVoiceLifecycleRuntime> | null>(null);
  const streamManagerRef = useRef<RoomVoiceStreamManager | null>(null);

  const roomId = currentRoom?.id ?? null;

  const localRacer = Boolean(currentRoom?.members.some(
    (member) => member.id === currentUserId && member.roomRole === 'racer',
  ));
  const remoteMemberIds = useMemo(
    () => roomVoiceRacerIds(currentRoom, currentUserId),
    [currentRoom?.members, currentUserId],
  );

  const loadLifecycleRuntime = useCallback(() => {
    if (!lifecycleRuntimePromiseRef.current) {
      lifecycleRuntimePromiseRef.current = import('../lib/roomVoiceLifecycle').then((runtime) => {
        streamManagerRef.current = runtime.createRoomVoiceStreamManager(
          () => navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          }),
          roomVoiceStopped,
        );
        lifecycleRuntimeRef.current = runtime;
        return runtime;
      });
    }
    return lifecycleRuntimePromiseRef.current;
  }, []);

  const closePeer = useCallback((remoteId: string, expectedPeer?: RTCPeerConnection) => {
    const peer = peersRef.current.get(remoteId);
    if (expectedPeer && peer !== expectedPeer) {
      if (expectedPeer.connectionState !== 'closed') expectedPeer.close();
      return;
    }

    pendingPeersRef.current.delete(remoteId);
    if (peer) {
      peersRef.current.delete(remoteId);
      peer.close();
    }

    const audio = audioElementsRef.current.get(remoteId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(remoteId);
    }

    pendingCandidatesRef.current.delete(remoteId);
    readyPeersRef.current.delete(remoteId);
    offeredPeersRef.current.delete(remoteId);
    if (enabledRef.current) setRemoteCount(audioElementsRef.current.size);
  }, []);

  const stopResources = useCallback((updateState: boolean) => {
    lifecycleGenerationRef.current += 1;
    startPromiseRef.current = null;
    enabledRef.current = false;

    if (currentUserId && roomId) {
      sendVoiceSignal(null, { type: 'leave' });
    }

    pendingPeersRef.current.clear();
    const peers = [...peersRef.current.values()];
    peersRef.current.clear();
    peers.forEach((peer) => peer.close());
    audioElementsRef.current.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    audioElementsRef.current.clear();
    pendingCandidatesRef.current.clear();
    readyPeersRef.current.clear();
    offeredPeersRef.current.clear();
    // Keep signal ids for the room session. Signals received before or while
    // muted must not replay when the rider turns the microphone back on.
    if (streamManagerRef.current) {
      streamManagerRef.current.stop();
    } else {
      void lifecycleRuntimePromiseRef.current
        ?.then(() => streamManagerRef.current?.stop())
        .catch(() => undefined);
    }

    if (updateState) {
      setRemoteCount(0);
      setEnabled(false);
      setRequesting(false);
      setStatus('Voice off.');
    }
  }, [currentUserId, roomId, sendVoiceSignal]);

  const stop = useCallback(() => {
    stopResources(true);
  }, [stopResources]);

  const ensurePeer = useCallback((remoteId: string) => {
    const existing = peersRef.current.get(remoteId);
    if (existing) return Promise.resolve(existing);
    const pending = pendingPeersRef.current.get(remoteId);
    if (pending) return pending;
    const runtime = lifecycleRuntimeRef.current;
    if (!runtime) return Promise.reject(roomVoiceStopped);

    const generation = lifecycleGenerationRef.current;
    let activePeer: RTCPeerConnection | null = null;
    let operation: Promise<RTCPeerConnection>;
    const isCurrent = () => lifecycleGenerationRef.current === generation
      && enabledRef.current
      && (pendingPeersRef.current.get(remoteId) === operation
        || (activePeer != null && peersRef.current.get(remoteId) === activePeer));
    operation = runtime.ensureRoomVoicePeerSingleFlight(
      remoteId,
      peersRef.current,
      pendingPeersRef.current,
      async () => {
        const stream = await streamManagerRef.current!.acquire();
        if (!isCurrent()) throw roomVoiceStopped;
        const peer = runtime.createRoomVoicePeer({
          stream,
          isCurrent,
          onCandidate: (candidate) => {
            sendVoiceSignal(remoteId, { type: 'candidate', candidate });
          },
          onTrack: (remoteStream) => {
            let audio = audioElementsRef.current.get(remoteId);
            if (!audio) {
              audio = document.createElement('audio');
              audio.autoplay = true;
              audio.dataset.tracklabVoicePeer = remoteId;
              document.body.appendChild(audio);
              audioElementsRef.current.set(remoteId, audio);
            }
            audio.srcObject = remoteStream;
            void audio.play().catch(() => undefined);
            setRemoteCount(audioElementsRef.current.size);
          },
          onClosed: (closedPeer) => closePeer(remoteId, closedPeer),
        });
        activePeer = peer;
        if (!isCurrent()) {
          peer.close();
          throw roomVoiceStopped;
        }
        return peer;
      },
      { isCurrent, dispose: (peer) => peer.close(), cancelled: roomVoiceStopped },
    );
    return operation;
  }, [closePeer, sendVoiceSignal]);

  const createOffer = useCallback(async (remoteId: string) => {
    if (!currentUserId || !enabledRef.current || offeredPeersRef.current.has(remoteId)) return;

    const generation = lifecycleGenerationRef.current;
    offeredPeersRef.current.add(remoteId);
    try {
      const peer = await ensurePeer(remoteId);
      const assertCurrent = () => {
        if (lifecycleGenerationRef.current !== generation || !enabledRef.current) {
          throw roomVoiceStopped;
        }
      };
      assertCurrent();
      const description = await lifecycleRuntimeRef.current!.createRoomVoiceOffer(peer, assertCurrent);
      if (description) sendVoiceSignal(remoteId, { type: 'offer', description });
    } catch (error) {
      offeredPeersRef.current.delete(remoteId);
      throw error;
    }
  }, [currentUserId, ensurePeer, sendVoiceSignal]);

  const reportVoiceConnectionIssue = useCallback((remoteId: string, error: unknown) => {
    if (error === roomVoiceStopped || !enabledRef.current) return;
    setStatus(`Voice connection issue: ${error instanceof Error ? error.message : 'Connection failed.'}`);
    closePeer(remoteId);
  }, [closePeer]);

  const start = useCallback(() => {
    if (startPromiseRef.current) return startPromiseRef.current;
    if (enabledRef.current) return Promise.resolve();
    if (!currentRoom || !currentUserId) {
      setStatus('Join a room before turning on voice.');
      return Promise.resolve();
    }
    if (!localRacer) {
      setStatus('Voice chat is available to the four room racers.');
      return Promise.resolve();
    }
    if (!supportsVoiceChat()) {
      setStatus('Voice chat is not supported in this browser.');
      return Promise.resolve();
    }

    const generation = lifecycleGenerationRef.current;
    setRequesting(true);
    setStatus('Requesting microphone access.');

    let operation: Promise<void>;
    operation = loadLifecycleRuntime()
      .then(() => generation === lifecycleGenerationRef.current
        ? streamManagerRef.current!.acquire()
        : undefined)
      .then(() => {
        if (generation !== lifecycleGenerationRef.current) {
          throw roomVoiceStopped;
        }
        enabledRef.current = true;
        setEnabled(true);
        setStatus('Voice on.');
        sendVoiceSignal(null, { type: 'ready' });
      })
      .catch((error: unknown) => {
        if (generation !== lifecycleGenerationRef.current || error === roomVoiceStopped) return;
        enabledRef.current = false;
        setStatus(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone permission was not granted.'
          : 'Microphone access failed.');
        setEnabled(false);
      })
      .finally(() => {
        if (startPromiseRef.current === operation) startPromiseRef.current = null;
        if (generation === lifecycleGenerationRef.current) setRequesting(false);
      });
    startPromiseRef.current = operation;
    return operation;
  }, [currentRoom, currentUserId, loadLifecycleRuntime, localRacer, sendVoiceSignal]);

  useEffect(() => {
    processedSignalsRef.current.clear();
    readyPeersRef.current.clear();
  }, [roomId]);

  useEffect(() => {
    if (!enabled) voiceSignals.forEach((signal) => processedSignalsRef.current.add(signal.id));
  }, [enabled, voiceSignals]);

  useEffect(() => {
    if (!roomId && (enabled || requesting)) stop();
  }, [enabled, requesting, roomId, stop]);

  useEffect(() => {
    return () => stopResources(false);
  }, [stopResources]);

  useEffect(() => {
    if (!enabled) return;

    peersRef.current.forEach((_, remoteId) => {
      if (!remoteMemberIds.includes(remoteId)) closePeer(remoteId);
    });
    readyPeersRef.current.forEach((remoteId) => {
      if (!remoteMemberIds.includes(remoteId)) readyPeersRef.current.delete(remoteId);
    });
  }, [closePeer, enabled, remoteMemberIds]);

  useEffect(() => {
    if (!enabled || !currentUserId) return;

    voiceSignals.forEach((voiceSignal) => {
      if (
        processedSignalsRef.current.has(voiceSignal.id)
        || voiceSignal.fromId === currentUserId
        || (voiceSignal.targetId && voiceSignal.targetId !== currentUserId)
        || !remoteMemberIds.includes(voiceSignal.fromId)
      ) return;

      processedSignalsRef.current.add(voiceSignal.id);
      const remoteId = voiceSignal.fromId;
      const signal = voiceSignal.signal;

      if (signal.type === 'leave') {
        closePeer(remoteId);
        return;
      }
      if (signal.type === 'ready') {
        const readyAction = claimRoomVoiceReady(readyPeersRef.current, currentUserId, remoteId);
        if (!readyAction) return;
        sendVoiceSignal(remoteId, { type: 'ready' });
        if (readyAction === 2) {
          void createOffer(remoteId).catch((error) => reportVoiceConnectionIssue(remoteId, error));
        }
        return;
      }

      const generation = lifecycleGenerationRef.current;
      void (async () => {
        const peer = await ensurePeer(remoteId);
        const assertCurrent = () => {
          if (generation !== lifecycleGenerationRef.current || !enabledRef.current) {
            throw roomVoiceStopped;
          }
        };
        assertCurrent();
        await lifecycleRuntimeRef.current!.applyRoomVoiceSignal(
          peer,
          remoteId,
          signal,
          pendingCandidatesRef.current,
          assertCurrent,
          (description) => sendVoiceSignal(remoteId, { type: 'answer', description }),
        );
      })().catch((error: unknown) => reportVoiceConnectionIssue(remoteId, error));
    });
  }, [
    closePeer,
    createOffer,
    currentUserId,
    enabled,
    ensurePeer,
    remoteMemberIds,
    reportVoiceConnectionIssue,
    sendVoiceSignal,
    voiceSignals,
  ]);

  return {
    enabled,
    remoteCount,
    requesting,
    start,
    status,
    stop,
    supported: supportsVoiceChat() && localRacer,
  };
}
