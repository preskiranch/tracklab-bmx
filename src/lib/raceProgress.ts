export function raceProgressPercent(distanceMeters: number, raceLengthMeters: number) {
  return Math.round(Math.max(0, Math.min(100, (distanceMeters / Math.max(1, raceLengthMeters)) * 100)));
}
