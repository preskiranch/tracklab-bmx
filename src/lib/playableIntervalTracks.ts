import { routeVariantsFromMapping } from './trackMapping';
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
  return tracks.filter(track => {
    const mapping = mappings[track.id];
    // Normalize the same saved boundary data used by the race engine. Legacy
    // route-only mappings can retain a whole-course placeholder in `zones`.
    return mapping?.routeStatus === 'user-mapped' && routeVariantsFromMapping(mapping)
      .some(route => hasPlayableIntervalZones({ ...route, routeStatus: mapping.routeStatus }));
  });
}
