import type { TrackRecord, UserTrackMapping } from '../types';

/** A saved route alone is not an interval course: it needs usable pedal zones. */
export function hasPlayableIntervalZones(route: Pick<TrackRecord, 'routeStatus' | 'centerline' | 'zones'> | undefined): boolean {
  return route?.routeStatus === 'user-mapped'
    && (route.centerline?.length ?? 0) >= 2
    && Boolean(route.zones?.some(zone => zone.type === 'pedal'
      && Number.isFinite(zone.startMeter) && Number.isFinite(zone.endMeter)
      && zone.startMeter >= 0 && zone.endMeter > zone.startMeter));
}

export function playableIntervalTracks(tracks: TrackRecord[], mappings: Record<string, UserTrackMapping>) {
  return tracks.filter(track => hasPlayableIntervalZones(mappings[track.id]));
}
