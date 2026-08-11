import { describe, expect, it } from 'vitest';
import { supportsDragStripGameArena } from '../../src/lib/dragStripGameArena';
import type { TrackRecord } from '../../src/types';

const track = {
  id: 'custom-drag-strip',
  name: 'Drag Strip',
  country: 'Custom Routes',
  countryCode: 'CUSTOM',
  state: 'New Hampshire',
  region: 'New Hampshire',
  source: 'Custom',
  sourceUrl: 'local://custom-route',
  lengthMeters: 457.2,
  elevationMeters: 0,
  surface: 'Custom sprint route',
  outline: [],
  routeStatus: 'user-mapped',
  zones: [],
  leaderboards: { rpm: [], speed: [], watts: [] },
} satisfies TrackRecord;

describe('Drag Strip game arena availability', () => {
  it('is available only for a custom track named Drag Strip', () => {
    expect(supportsDragStripGameArena(track)).toBe(true);
    expect(supportsDragStripGameArena({ ...track, name: 'Dragstrip' })).toBe(true);
    expect(supportsDragStripGameArena({ ...track, name: 'La Salle University' })).toBe(false);
    expect(supportsDragStripGameArena({ ...track, countryCode: 'USA' })).toBe(false);
  });
});
