import { describe, expect, it } from 'vitest';
import {
  applyStudioRiderAssignments,
  assignStudioRider,
  mergeStudioRiders,
  removeStudioRider,
  updateStudioRiderPhoto,
} from '../../src/lib/studioRiders';
import type { PlayerSlot, StudioRider } from '../../src/types';

function rider(overrides: Partial<StudioRider> = {}): StudioRider {
  return {
    id: 'rider-jordan',
    name: 'Jordan',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function player(id: 1 | 2, deviceId: number, name: string): PlayerSlot {
  return {
    id,
    name,
    colorName: id === 1 ? 'lime' : 'red',
    accent: id === 1 ? '#7ade36' : '#ff4d4f',
    deviceId,
  };
}

describe('studio rider roster', () => {
  it('keeps the newest cross-browser record and preserves deletion tombstones', () => {
    const original = rider();
    const renamed = rider({ name: 'Jordan H', updatedAt: 200 });
    const deleted = removeStudioRider(renamed, 300);

    expect(mergeStudioRiders([original], [renamed])).toEqual([renamed]);
    expect(mergeStudioRiders([renamed], [deleted])).toEqual([deleted]);
  });

  it('allows one student on only one connected bike at a time', () => {
    const firstAssignment = assignStudioRider({}, 58701, 'rider-jordan');
    const reassigned = assignStudioRider(firstAssignment, 43853, 'rider-jordan');

    expect(reassigned).toEqual({ 43853: 'rider-jordan' });
    expect(assignStudioRider(reassigned, 43853, null)).toEqual({});
  });

  it('attributes the race slot to the student without losing physical bike identity', () => {
    const players = [
      player(1, 58701, 'Gate Trainer'),
      player(2, 43853, 'Rhythm Trainer'),
    ];

    expect(applyStudioRiderAssignments(players, [rider()], { 58701: 'rider-jordan' })).toEqual([
      {
        ...players[0],
        name: 'Jordan',
        riderId: 'rider-jordan',
        bikeName: 'Gate Trainer',
      },
      players[1],
    ]);
  });

  it('saves a studio rider photo and carries it into the assigned race slot', () => {
    const photoUrl = 'data:image/jpeg;base64,QUJDRA==';
    const photographed = updateStudioRiderPhoto(rider(), photoUrl, 250);

    expect(photographed).toMatchObject({ photoUrl, updatedAt: 250 });
    expect(applyStudioRiderAssignments(
      [player(1, 58701, 'Gate Trainer')],
      [photographed],
      { 58701: 'rider-jordan' },
    )[0]).toMatchObject({
      name: 'Jordan',
      photoUrl,
      bikeName: 'Gate Trainer',
    });
    expect(updateStudioRiderPhoto(photographed, undefined, 300)).not.toHaveProperty('photoUrl');
  });
});
