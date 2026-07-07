import { useEffect, useMemo, useRef } from 'react';
import { playZoneCue } from '../lib/audioCues';
import { zoneMatchesBranchSelections } from '../lib/trackMapping';
import type { RaceState, RiderState, TrackZone } from '../types';

export function useZoneAudioCues(
  raceState: RaceState,
  riders: RiderState[],
  activeZones: TrackZone[],
) {
  const previousDistanceRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const pedalZones = useMemo(
    () => activeZones.filter((zone) => zone.type === 'pedal'),
    [activeZones],
  );
  const zoneSignature = useMemo(
    () => pedalZones.map((zone) => `${zone.id}:${zone.endMeter}:${zone.restAfterSeconds ?? 0}`).join('|'),
    [pedalZones],
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
    if (raceState !== 'racing' || riders.length === 0 || pedalZones.length === 0) {
      return;
    }

    const cueRider = riders.find((rider) => rider.playerId === 1) ?? riders[0];
    const previousDistance = previousDistanceRef.current;
    const currentDistance = cueRider.distance;

    if (currentDistance <= previousDistance) {
      previousDistanceRef.current = currentDistance;
      return;
    }

    const riderPedalZones = pedalZones.filter((zone) => (
      zoneMatchesBranchSelections(zone, cueRider.actualBranches, cueRider.selectedBranch)
    ));

    riderPedalZones.forEach((zone) => {
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
  }, [pedalZones, raceState, riders]);
}
