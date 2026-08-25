import { describe, expect, it } from 'vitest';
import { roomVoiceRacerIds } from '../../src/hooks/useRoomVoiceChat';
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
});
