import type { TrackRecord, UserTrackMapping } from '../types';
import { playableIntervalTracks } from './playableIntervalTracks';

export const openingTrackStorageKey = 'tracklab-last-opening-track-v1';
export const automaticTrackHistoryKey = 'tracklabAutomaticTrack';

export function chooseOpeningTrack(tracks: TrackRecord[], mappings: Record<string, UserTrackMapping>, previousId: string | null, random = Math.random): TrackRecord | undefined {
  const playable = playableIntervalTracks(tracks, mappings);
  const alternatives = playable.filter(track => track.id !== previousId);
  const choices = alternatives.length ? alternatives : playable;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
