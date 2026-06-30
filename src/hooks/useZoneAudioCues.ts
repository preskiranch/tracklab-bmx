import { useEffect, useMemo, useRef } from 'react';
import { playZoneCue } from '../lib/audioCues';
import type { RaceState, RiderState, TrackZone } from '../types';

export function useZoneAudioCues(
  raceState: RaceState,
  riders: RiderState[],
  activeZones: TrackZone[],
) {
  const previousDistanceRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const zoneSignature = useMemo(
    () => activeZones.map((zone) => `${zone.id}:${zone.endMeter}:${zone.restAfterSeconds ?? 0}`).join('|'),
    [activeZones],
  );

  useEffect(() => {
    previousDistanceRef.current = 0;
    timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeoutsRef.current = [];

    return () => {
      timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current = [];
    };
  }, [raceState, zoneSignature]);

  useEffect(() => {
    if (raceState !== 'racing' || riders.length === 0 || activeZones.length === 0) {
      return;
    }

    const cueRider = riders.find((rider) => rider.playerId === 1) ?? riders[0];
    const previousDistance = previousDistanceRef.current;
    const currentDistance = cueRider.distance;

    if (currentDistance <= previousDistance) {
      previousDistanceRef.current = currentDistance;
      return;
    }

    activeZones.forEach((zone) => {
      const crossedZoneEnd = previousDistance < zone.endMeter && currentDistance >= zone.endMeter;
      if (!crossedZoneEnd) {
        return;
      }

      const restAfterSeconds = zone.restAfterSeconds ?? 0;
      playZoneCue('stop');

      if (restAfterSeconds > 0) {
        const timeoutId = window.setTimeout(() => playZoneCue('start'), restAfterSeconds * 1000);
        timeoutsRef.current.push(timeoutId);
      }
    });

    previousDistanceRef.current = currentDistance;
  }, [activeZones, raceState, riders]);
}
