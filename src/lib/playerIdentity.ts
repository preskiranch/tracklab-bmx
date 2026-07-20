import { defaultPlayerSlots } from '../data';
import type { PlayerId, PlayerSlot } from '../types';

const markerNameMaxLength = 12;

export function playerVisualForSlot(playerId: PlayerId) {
  return defaultPlayerSlots.find((slot) => slot.id === playerId) ?? defaultPlayerSlots[0];
}

export function compactRiderName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return '';
  }

  if (normalized.length <= markerNameMaxLength) {
    return normalized;
  }

  return `${normalized.slice(0, markerNameMaxLength - 1).trimEnd()}…`;
}

export function localRiderMarkerLabel(player: Pick<PlayerSlot, 'id' | 'name'>) {
  const name = compactRiderName(player.name);
  return name ? `P${player.id} ${name}` : `P${player.id}`;
}

export function ghostRiderMarkerLabel(name: string, ghostNumber: number) {
  const compactName = compactRiderName(name);
  return compactName ? `G${ghostNumber} ${compactName}` : `G${ghostNumber}`;
}
