import type { TrackRecord } from '../types';

export function supportsDragStripGameArena(track: TrackRecord) {
  const normalizedName = track.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return track.countryCode === 'CUSTOM' && normalizedName.includes('dragstrip');
}
