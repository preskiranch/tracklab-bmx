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

function supportsVoiceChat() {
  return typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof RTCPeerConnection !== 'undefined';
}

export function useRoomVoiceChat({
  currentRoom,
  currentUserId,
  voiceSignals,
  sendVoiceSignal,
}: UseRoomVoiceChatOptions) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Voice off.');
  const [remoteCount, setRemoteCount] = useState(0);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const offeredPeersRef = useRef<Set<string>>(new Set());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const roomId = currentRoom?.id ?? null;
  const remoteMemberIds = useMemo(
    () => (currentRoom?.members ?? [])
      .map((member) => member.id)
      .filter((memberId) => memberId !== currentUserId),
    [currentRoom?.members, currentUserId],
  );

  const closePeer = useCallback((remoteId: string) => {
    const peer = peersRef.current.get(remoteId);
    if (peer) {
      peer.close();
      peersRef.current.delete(remoteId);
    }

    const audio = audioElementsRef.current.get(remoteId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(remoteId);
    }

    pendingCandidatesRef.current.delete(remoteId);
    offeredPeersRef.current.delete(remoteId);
    setRemoteCount(audioElementsRef.current.size);
  }, []);

  const stop = useCallback(() => {
    if (currentUserId && roomId) {
      sendVoiceSignal(null, { type: 'leave' });
    }

    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    audioElementsRef.current.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    audioElementsRef.current.clear();
    pendingCandidatesRef.current.clear();
    offeredPeersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setRemoteCount(0);
    setEnabled(false);
    setStatus('Voice off.');
  }, [currentUserId, roomId, sendVoiceSignal]);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const ensurePeer = useCallback(async (remoteId: string) => {
    const existing = peersRef.current.get(remoteId);
    if (existing) {
      return existing;
    }

    const stream = await ensureLocalStream();
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peersRef.current.set(remoteId, peer);

    stream.getAudioTracks().forEach((track) => {
      peer.addTrack(track, stream);
    });

    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        sendVoiceSignal(remoteId, {
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    });

    peer.addEventListener('track', (event) => {
      let audio = audioElementsRef.current.get(remoteId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.dataset.tracklabVoicePeer = remoteId;
        document.body.appendChild(audio);
        audioElementsRef.current.set(remoteId, audio);
      }

      audio.srcObject = event.streams[0];
      void audio.play().catch(() => undefined);
      setRemoteCount(audioElementsRef.current.size);
    });

    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
        closePeer(remoteId);
      }
    });

    return peer;
  }, [closePeer, ensureLocalStream, sendVoiceSignal]);

  const createOffer = useCallback(async (remoteId: string) => {
    if (!currentUserId || !enabled || offeredPeersRef.current.has(remoteId)) {
      return;
    }

    offeredPeersRef.current.add(remoteId);
    const peer = await ensurePeer(remoteId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (peer.localDescription) {
      sendVoiceSignal(remoteId, {
        type: 'offer',
        description: {
          type: peer.localDescription.type,
          sdp: peer.localDescription.sdp,
        },
      });
    }
  }, [currentUserId, enabled, ensurePeer, sendVoiceSignal]);

  const start = useCallback(async () => {
    if (!currentRoom || !currentUserId) {
      setStatus('Join a room before turning on voice.');
      return;
    }

    if (!supportsVoiceChat()) {
      setStatus('Voice chat is not supported in this browser.');
      return;
    }

    try {
      setStatus('Requesting microphone access.');
      await ensureLocalStream();
      setEnabled(true);
      setStatus('Voice on.');
      sendVoiceSignal(null, { type: 'ready' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Microphone access failed.');
      setEnabled(false);
    }
  }, [currentRoom, currentUserId, ensureLocalStream, sendVoiceSignal]);

  useEffect(() => {
    if (!roomId && enabled) {
      stop();
    }
  }, [enabled, roomId, stop]);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!enabled || !currentUserId) {
      return;
    }

    remoteMemberIds.forEach((remoteId) => {
      if (currentUserId < remoteId) {
        void createOffer(remoteId);
      }
    });

    peersRef.current.forEach((_, remoteId) => {
      if (!remoteMemberIds.includes(remoteId)) {
        closePeer(remoteId);
      }
    });
  }, [closePeer, createOffer, currentUserId, enabled, remoteMemberIds]);

  useEffect(() => {
    if (!enabled || !currentUserId) {
      return;
    }

    voiceSignals.forEach((voiceSignal) => {
      if (
        processedSignalsRef.current.has(voiceSignal.id)
        || voiceSignal.fromId === currentUserId
        || (voiceSignal.targetId && voiceSignal.targetId !== currentUserId)
      ) {
        return;
      }

      processedSignalsRef.current.add(voiceSignal.id);

      const remoteId = voiceSignal.fromId;
      const signal = voiceSignal.signal;

      if (signal.type === 'leave') {
        closePeer(remoteId);
        return;
      }

      if (signal.type === 'ready') {
        if (currentUserId < remoteId) {
          void createOffer(remoteId);
        }
        return;
      }

      void (async () => {
        const peer = await ensurePeer(remoteId);

        if (signal.type === 'offer') {
          await peer.setRemoteDescription(signal.description);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          if (peer.localDescription) {
            sendVoiceSignal(remoteId, {
              type: 'answer',
              description: {
                type: peer.localDescription.type,
                sdp: peer.localDescription.sdp,
              },
            });
          }

          const pending = pendingCandidatesRef.current.get(remoteId) ?? [];
          pendingCandidatesRef.current.delete(remoteId);
          await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate)));
          return;
        }

        if (signal.type === 'answer') {
          await peer.setRemoteDescription(signal.description);
          const pending = pendingCandidatesRef.current.get(remoteId) ?? [];
          pendingCandidatesRef.current.delete(remoteId);
          await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate)));
          return;
        }

        if (signal.type === 'candidate') {
          if (!peer.remoteDescription) {
            pendingCandidatesRef.current.set(remoteId, [
              ...(pendingCandidatesRef.current.get(remoteId) ?? []),
              signal.candidate,
            ]);
            return;
          }

          await peer.addIceCandidate(signal.candidate);
        }
      })().catch((error: Error) => {
        setStatus(`Voice connection issue: ${error.message}`);
        closePeer(remoteId);
      });
    });
  }, [closePeer, createOffer, currentUserId, enabled, ensurePeer, sendVoiceSignal, voiceSignals]);

  return {
    enabled,
    remoteCount,
    start,
    status,
    stop,
    supported: supportsVoiceChat(),
  };
}
