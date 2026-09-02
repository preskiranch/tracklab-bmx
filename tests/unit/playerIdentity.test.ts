import { describe, expect, it } from 'vitest';
import { defaultPlayerSlots } from '../../src/data';
import { EVERGREEN_RIDER_ACCENT, canonicalPlayerAccent } from '../../src/lib/playerPalette';
import {
  compactRiderName,
  ghostRiderMarkerLabel,
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
    expect(defaultPlayerSlots[0].accent).toBe(EVERGREEN_RIDER_ACCENT);
    expect(canonicalPlayerAccent('lime', '#7ade36')).toBe(EVERGREEN_RIDER_ACCENT);
    expect(defaultPlayerSlots[0].accent).not.toBe(defaultPlayerSlots[3].accent);
    expect(playerVisualForSlot(2).colorName).toBe('blue');
  });

  it('adds the rider name to the map label without allowing oversized labels', () => {
    expect(localRiderMarkerLabel({ id: 1, name: 'Hadley' })).toBe('P1 Hadley');
    expect(localRiderMarkerLabel({ id: 2, name: 'Wattbike Trainer' })).toBe('P2 Wattbike Tr…');
    expect(compactRiderName('   ')).toBe('');
  });

  it('adds the selected ghost name to its on-track marker', () => {
    expect(ghostRiderMarkerLabel('Demo Rider 4', 1)).toBe('G1 Demo Rider 4');
    expect(ghostRiderMarkerLabel('Long Distance Training Partner', 2)).toBe('G2 Long Distan…');
    expect(ghostRiderMarkerLabel('   ', 3)).toBe('G3');
  });
});
