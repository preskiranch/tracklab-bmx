import type { RaceState } from '../types';

export type RacePositionContender = {
  distanceMeters: number;
  finishedAt: number | null;
};

export const racePositionSeparationMeters = 0.05;
const distanceComparisonToleranceMeters = 0.000001;

export function racePositionsAreEstablished(
  raceState: RaceState,
  contenders: RacePositionContender[],
) {
  if (contenders.length === 0 || raceState === 'ready') {
    return false;
  }

  if (raceState === 'finished') {
    return true;
  }

  if (contenders.some((contender) => contender.finishedAt != null)) {
    return true;
  }

  const distances = contenders.map((contender) => Math.max(0, contender.distanceMeters));
  if (distances.length === 1) {
    return distances[0] >= racePositionSeparationMeters - distanceComparisonToleranceMeters;
  }

  return Math.max(...distances) - Math.min(...distances)
    >= racePositionSeparationMeters - distanceComparisonToleranceMeters;
}
