import type { MultiplayerVoiceSignalPayload } from '../types';

export class RoomVoiceOperationCancelledError extends Error {
  constructor() {
    super('The voice operation was stopped.');
    this.name = 'VoiceStop';
  }
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function createRoomVoiceStreamManager(
  requestStream: () => Promise<MediaStream>,
  cancelled: Error = new RoomVoiceOperationCancelledError(),
) {
  let generation = 0;
  let currentStream: MediaStream | null = null;
  let pendingStream: Promise<MediaStream> | null = null;

  return {
    acquire() {
      if (currentStream) return Promise.resolve(currentStream);
      if (pendingStream) return pendingStream;
      const requestGeneration = generation;
      let operation: Promise<MediaStream>;
      operation = Promise.resolve()
        .then(requestStream)
        .then((stream) => {
          if (requestGeneration !== generation) {
            stopMediaStream(stream);
            throw cancelled;
          }
          currentStream = stream;
          return stream;
        })
        .finally(() => {
          if (pendingStream === operation) pendingStream = null;
        });
      pendingStream = operation;
      return operation;
    },
    current: () => currentStream,
    requesting: () => pendingStream != null,
    stop() {
      generation += 1;
      pendingStream = null;
      const stream = currentStream;
      currentStream = null;
      stopMediaStream(stream);
    },
  };
}

export type RoomVoiceStreamManager = ReturnType<typeof createRoomVoiceStreamManager>;

type PeerSingleFlightOptions<T> = {
  isCurrent?: () => boolean;
  dispose?: (peer: T) => void;
  cancelled?: Error;
};

export function ensureRoomVoicePeerSingleFlight<T>(
  remoteId: string,
  peers: Map<string, T>,
  pendingPeers: Map<string, Promise<T>>,
  createPeer: () => T | Promise<T>,
  options: PeerSingleFlightOptions<T> = {},
) {
  const existing = peers.get(remoteId);
  if (existing) return Promise.resolve(existing);
  const pending = pendingPeers.get(remoteId);
  if (pending) return pending;

  let operation: Promise<T>;
  operation = Promise.resolve()
    .then(createPeer)
    .then((created) => {
      if (options.isCurrent && !options.isCurrent()) {
        options.dispose?.(created);
        throw options.cancelled ?? new RoomVoiceOperationCancelledError();
      }
      const raced = peers.get(remoteId);
      if (raced) {
        if (raced !== created) options.dispose?.(created);
        return raced;
      }
      peers.set(remoteId, created);
      return created;
    })
    .finally(() => {
      if (pendingPeers.get(remoteId) === operation) pendingPeers.delete(remoteId);
    });
  pendingPeers.set(remoteId, operation);
  return operation;
}

type CreateRoomVoicePeerOptions = {
  stream: MediaStream;
  isCurrent: () => boolean;
  onCandidate: (candidate: RTCIceCandidateInit) => void;
  onTrack: (stream: MediaStream) => void;
  onClosed: (peer: RTCPeerConnection) => void;
};

export function createRoomVoicePeer({
  stream,
  isCurrent,
  onCandidate,
  onTrack,
  onClosed,
}: CreateRoomVoicePeerOptions) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
  peer.addEventListener('icecandidate', (event) => {
    if (event.candidate && isCurrent()) onCandidate(event.candidate.toJSON());
  });
  peer.addEventListener('track', (event) => {
    if (isCurrent() && event.streams[0]) onTrack(event.streams[0]);
  });
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed') onClosed(peer);
  });
  return peer;
}

export async function createRoomVoiceOffer(
  peer: RTCPeerConnection,
  assertCurrent: () => void,
) {
  const offer = await peer.createOffer();
  assertCurrent();
  await peer.setLocalDescription(offer);
  assertCurrent();
  return peer.localDescription
    ? { type: peer.localDescription.type, sdp: peer.localDescription.sdp }
    : null;
}

type RoomVoiceNegotiationSignal = Exclude<
  MultiplayerVoiceSignalPayload,
  { type: 'ready' } | { type: 'leave' }
>;

export const MAX_PENDING_ROOM_VOICE_CANDIDATES = 64;

export function queuePendingRoomVoiceCandidate(
  pendingCandidates: Map<string, RTCIceCandidateInit[]>,
  remoteId: string,
  candidate: RTCIceCandidateInit,
) {
  const pending = pendingCandidates.get(remoteId) ?? [];
  if (pending.length >= MAX_PENDING_ROOM_VOICE_CANDIDATES) return false;
  pendingCandidates.set(remoteId, [...pending, candidate]);
  return true;
}

export async function applyRoomVoiceSignal(
  peer: RTCPeerConnection,
  remoteId: string,
  signal: RoomVoiceNegotiationSignal,
  pendingCandidates: Map<string, RTCIceCandidateInit[]>,
  assertCurrent: () => void,
  sendAnswer: (description: RTCSessionDescriptionInit) => void,
) {
  if (signal.type === 'offer') {
    await peer.setRemoteDescription(signal.description);
    assertCurrent();
    const answer = await peer.createAnswer();
    assertCurrent();
    await peer.setLocalDescription(answer);
    assertCurrent();
    if (peer.localDescription) {
      sendAnswer({ type: peer.localDescription.type, sdp: peer.localDescription.sdp });
    }
  } else if (signal.type === 'answer') {
    await peer.setRemoteDescription(signal.description);
    assertCurrent();
  } else if (!peer.remoteDescription) {
    queuePendingRoomVoiceCandidate(pendingCandidates, remoteId, signal.candidate);
    return;
  } else {
    await peer.addIceCandidate(signal.candidate);
    assertCurrent();
    return;
  }

  const pending = pendingCandidates.get(remoteId) ?? [];
  pendingCandidates.delete(remoteId);
  await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate)));
  assertCurrent();
}
