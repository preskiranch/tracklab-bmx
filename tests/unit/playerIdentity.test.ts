import { describe, expect, it } from 'vitest';
import { defaultPlayerSlots } from '../../src/data';
import {
  compactRiderName,
  localRiderMarkerLabel,
  playerVisualForSlot,
} from '../../src/lib/playerIdentity';

describe('player identity', () => {
  it('assigns a distinct visual identity to every race slot', () => {
    expect(defaultPlayerSlots.map((player) => player.colorName)).toEqual([
      'lime',
      'blue',
      'red',
      'yellow',
    ]);
    expect(new Set(defaultPlayerSlots.map((player) => player.accent)).size).toBe(4);
    expect(playerVisualForSlot(2).colorName).toBe('blue');
  });

  it('adds the rider name to the map label without allowing oversized labels', () => {
    expect(localRiderMarkerLabel({ id: 1, name: 'Hadley' })).toBe('P1 Hadley');
    expect(localRiderMarkerLabel({ id: 2, name: 'Wattbike Trainer' })).toBe('P2 Wattbike Tr…');
    expect(compactRiderName('   ')).toBe('');
  });
});
