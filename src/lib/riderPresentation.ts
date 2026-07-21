import type { PlayerId, PlayerSlot } from '../types';

const riderLaneSpacingMeters = 0.42;
const riderLaneMaxSpreadMeters = 1.26;
const riderAirMetersPerPixel = 0.025;
const riderMaximumAltitudeMeters = 0.85;

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function riderLaneOffsetsByPlayer(players: PlayerSlot[]) {
  const sortedPlayers = [...players].sort((left, right) => left.id - right.id);
  const offsets = new Map<PlayerId, number>();
  const spacing = sortedPlayers.length <= 1
    ? 0
    : Math.min(riderLaneSpacingMeters, riderLaneMaxSpreadMeters / (sortedPlayers.length - 1));
  const midpoint = (sortedPlayers.length - 1) / 2;

  sortedPlayers.forEach((player, index) => {
    offsets.set(player.id, (index - midpoint) * spacing);
  });

  return offsets;
}

export function uprightRiderOrientation(rotationDegrees: number) {
  const normalized = normalizeHeading(rotationDegrees);
  const signedRotation = normalized > 180 ? normalized - 360 : normalized;
  const mirrored = Math.abs(signedRotation) > 90;
  const facingLean = mirrored
    ? signedRotation - Math.sign(signedRotation || 1) * 180
    : signedRotation;

  return {
    leanDegrees: Math.max(-24, Math.min(24, facingLean)),
    mirrored,
  };
}

export function riderAirPixelsToMeters(airPixels: number) {
  return Math.max(0, Math.min(riderMaximumAltitudeMeters, airPixels * riderAirMetersPerPixel));
}
