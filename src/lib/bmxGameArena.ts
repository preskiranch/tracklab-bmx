import type { TrackRecord } from '../types';

export const northBayGameArenaTrackId = 'north-bay-bmx-napa-valley';

export function supportsBmxGameArena(track: Pick<TrackRecord, 'id'>) {
  return track.id === northBayGameArenaTrackId;
}
