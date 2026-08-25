import { describe, expect, it, vi } from 'vitest';
import {
  applyRoomVoiceSignal,
  createRoomVoiceStreamManager,
  ensureRoomVoicePeerSingleFlight,
  MAX_PENDING_ROOM_VOICE_CANDIDATES,
  queuePendingRoomVoiceCandidate,
  RoomVoiceOperationCancelledError,
} from '../../src/lib/roomVoiceLifecycle';
import {
  claimRoomVoiceReady,
  roomVoiceRacerIds,
} from '../../src/hooks/useRoomVoiceChat';
import type { MultiplayerRoom, MultiplayerRider } from '../../src/types';

function member(id: string, roomRole: 'racer' | 'spectator'): MultiplayerRider {
  return {
    id,
    name: id,
    available: true,
    membershipTier: 'racer',
    bikeCount: 1,
    track: { id: 'explore', name: 'Explore', country: 'Global', state: 'Route' },
    roomId: 'ROOM-VOICE',
    roomRole,
    lastSeen: Date.now(),
  };
}

describe('room voice chat seats', () => {
  it('connects only the other three racer seats and excludes spectators', () => {
    const room = {
      id: 'ROOM-VOICE',
      hostId: 'host',
      private: true,
      track: { id: 'explore', name: 'Explore', country: 'Global', state: 'Route' },
      flow: {
        phase: 'lobby',
        raceToken: null,
        raceStartAt: null,
        deadlineAt: null,
        routeChoice: null,
        votes: [],
        voteCandidates: [],
      },
      createdAt: Date.now(),
      members: [
        member('host', 'racer'),
        member('racer-2', 'racer'),
        member('spectator', 'spectator'),
        member('racer-3', 'racer'),
        member('racer-4', 'racer'),
      ],
      memberCount: 5,
    } as MultiplayerRoom;

    expect(roomVoiceRacerIds(room, 'host')).toEqual(['racer-2', 'racer-3', 'racer-4']);
  });

  it('converges when the lexicographically smaller rider starts voice first', () => {
    const smallerReady = new Set<string>();
    const largerReady = new Set<string>();
    // The smaller rider's first ready was intentionally ignored while the
    // larger rider was muted. The larger rider's later ready restarts the
    // handshake, and its acknowledgement cannot start a ping-pong loop.
    const actions = [
      claimRoomVoiceReady(smallerReady, 'a-rider', 'z-rider'),
      claimRoomVoiceReady(largerReady, 'z-rider', 'a-rider'),
      claimRoomVoiceReady(smallerReady, 'a-rider', 'z-rider'),
    ];

    expect(actions).toEqual([2, 1, 0]);
    expect(actions.filter((action) => action === 2)).toHaveLength(1);
  });

  it('converges when the lexicographically larger rider starts voice first', () => {
    const smallerReady = new Set<string>();
    const largerReady = new Set<string>();
    const actions = [
      claimRoomVoiceReady(largerReady, 'z-rider', 'a-rider'),
      claimRoomVoiceReady(smallerReady, 'a-rider', 'z-rider'),
      claimRoomVoiceReady(largerReady, 'z-rider', 'a-rider'),
    ];

    expect(actions).toEqual([1, 2, 0]);
    expect(actions.filter((action) => action === 2)).toHaveLength(1);
  });

  it('creates one offer and no ready ping-pong when both riders start together', () => {
    const smallerReady = new Set<string>();
    const largerReady = new Set<string>();
    const actions = [
      claimRoomVoiceReady(largerReady, 'z-rider', 'a-rider'),
      claimRoomVoiceReady(smallerReady, 'a-rider', 'z-rider'),
      claimRoomVoiceReady(smallerReady, 'a-rider', 'z-rider'),
      claimRoomVoiceReady(largerReady, 'z-rider', 'a-rider'),
    ];

    expect(actions).toEqual([1, 2, 0, 0]);
    expect(actions.filter(Boolean)).toHaveLength(2);
    expect(actions.filter((action) => action === 2)).toHaveLength(1);
  });

  it('requests the microphone once for concurrent Start taps', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const requestStream = vi.fn(() => new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    }));
    const manager = createRoomVoiceStreamManager(requestStream);
    const first = manager.acquire();
    const second = manager.acquire();

    expect(first).toBe(second);
    await Promise.resolve();
    expect(requestStream).toHaveBeenCalledOnce();

    const stream = {
      getTracks: () => [],
    } as unknown as MediaStream;
    resolveStream!(stream);
    await expect(first).resolves.toBe(stream);
    await expect(second).resolves.toBe(stream);
    expect(manager.current()).toBe(stream);
    expect(manager.requesting()).toBe(false);
  });

  it('stops a microphone stream that resolves after Stop or End', async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const track = { stop: vi.fn() };
    const stream = {
      getTracks: () => [track],
    } as unknown as MediaStream;
    const manager = createRoomVoiceStreamManager(() => new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    }));
    const pending = manager.acquire();
    await Promise.resolve();

    manager.stop();
    expect(manager.requesting()).toBe(false);
    resolveStream!(stream);

    await expect(pending).rejects.toBeInstanceOf(RoomVoiceOperationCancelledError);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(manager.current()).toBeNull();
  });

  it('creates only one peer when batched offer and candidates arrive together', async () => {
    const peers = new Map<string, { id: string }>();
    const pendingPeers = new Map<string, Promise<{ id: string }>>();
    let resolvePeer: ((peer: { id: string }) => void) | undefined;
    const createPeer = vi.fn(() => new Promise<{ id: string }>((resolve) => {
      resolvePeer = resolve;
    }));

    const offerPeer = ensureRoomVoicePeerSingleFlight('friend-1', peers, pendingPeers, createPeer);
    const candidatePeer = ensureRoomVoicePeerSingleFlight('friend-1', peers, pendingPeers, createPeer);
    const secondCandidatePeer = ensureRoomVoicePeerSingleFlight('friend-1', peers, pendingPeers, createPeer);
    expect(offerPeer).toBe(candidatePeer);
    expect(candidatePeer).toBe(secondCandidatePeer);
    await Promise.resolve();
    expect(createPeer).toHaveBeenCalledOnce();

    const peer = { id: 'peer-1' };
    resolvePeer!(peer);
    await expect(Promise.all([offerPeer, candidatePeer, secondCandidatePeer])).resolves.toEqual([
      peer,
      peer,
      peer,
    ]);
    expect(peers.get('friend-1')).toBe(peer);
    expect(pendingPeers.size).toBe(0);
  });

  it('disposes a late peer after its room session is stopped', async () => {
    const peers = new Map<string, { close: () => void }>();
    const pendingPeers = new Map<string, Promise<{ close: () => void }>>();
    const close = vi.fn();
    let current = true;
    let resolvePeer: ((peer: { close: () => void }) => void) | undefined;
    const pending = ensureRoomVoicePeerSingleFlight(
      'friend-1',
      peers,
      pendingPeers,
      () => new Promise((resolve) => { resolvePeer = resolve; }),
      { isCurrent: () => current, dispose: (peer) => peer.close() },
    );
    await Promise.resolve();
    current = false;
    resolvePeer!({ close });

    await expect(pending).rejects.toBeInstanceOf(RoomVoiceOperationCancelledError);
    expect(close).toHaveBeenCalledOnce();
    expect(peers.size).toBe(0);
    expect(pendingPeers.size).toBe(0);
  });

  it('bounds pre-SDP ICE candidates and drains only the bounded queue', async () => {
    const pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
    const remoteId = 'friend-1';
    let largestQueue = 0;
    for (let index = 0; index < MAX_PENDING_ROOM_VOICE_CANDIDATES + 16; index += 1) {
      queuePendingRoomVoiceCandidate(pendingCandidates, remoteId, {
        candidate: `candidate:${index + 1} 1 udp 2122260223 192.0.2.${(index % 200) + 1} 5000 typ host`,
        sdpMid: '0',
        sdpMLineIndex: 0,
      });
      largestQueue = Math.max(largestQueue, pendingCandidates.get(remoteId)?.length ?? 0);
    }

    expect(largestQueue).toBe(MAX_PENDING_ROOM_VOICE_CANDIDATES);
    expect(pendingCandidates.get(remoteId)).toHaveLength(MAX_PENDING_ROOM_VOICE_CANDIDATES);
    expect(pendingCandidates.get(remoteId)?.at(-1)?.candidate).toContain(
      `candidate:${MAX_PENDING_ROOM_VOICE_CANDIDATES}`,
    );

    const peerState: {
      remoteDescription: RTCSessionDescriptionInit | null;
      localDescription: RTCSessionDescriptionInit | null;
    } = { remoteDescription: null, localDescription: null };
    const addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => undefined);
    const peer = {
      get remoteDescription() { return peerState.remoteDescription; },
      get localDescription() { return peerState.localDescription; },
      setRemoteDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
        peerState.remoteDescription = description;
      }),
      createAnswer: vi.fn(async () => ({ type: 'answer' as const, sdp: 'bounded-answer' })),
      setLocalDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
        peerState.localDescription = description;
      }),
      addIceCandidate,
    } as unknown as RTCPeerConnection;

    await applyRoomVoiceSignal(
      peer,
      remoteId,
      { type: 'offer', description: { type: 'offer', sdp: 'bounded-offer' } },
      pendingCandidates,
      () => undefined,
      () => undefined,
    );

    expect(pendingCandidates.has(remoteId)).toBe(false);
    expect(addIceCandidate).toHaveBeenCalledTimes(MAX_PENDING_ROOM_VOICE_CANDIDATES);
    expect(addIceCandidate.mock.calls.at(-1)?.[0].candidate).toContain(
      `candidate:${MAX_PENDING_ROOM_VOICE_CANDIDATES}`,
    );
  });

  it('remembers signals seen before and while muted so unmute cannot replay them', () => {
    const processed = new Set<string>();
    const beforeMute = [{ id: 'offer-old' }, { id: 'candidate-old' }];
    const whileMuted = [{ id: 'ready-muted' }, { id: 'candidate-muted' }];

    beforeMute.forEach((signal) => processed.add(signal.id));
    whileMuted.forEach((signal) => processed.add(signal.id));

    const retainedSignals = [...beforeMute, ...whileMuted];
    expect(retainedSignals.filter((signal) => !processed.has(signal.id))).toEqual([]);
    expect(processed).toEqual(new Set([
      'offer-old',
      'candidate-old',
      'ready-muted',
      'candidate-muted',
    ]));
  });
});
