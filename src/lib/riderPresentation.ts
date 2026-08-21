import type { PlayerId, PlayerSlot } from '../types';

const riderLaneSpacingMeters = 0.42;
const riderLaneMaxSpreadMeters = 1.26;
// Geographic lane offsets already separate the riders across the real track
// surface. Keep the extra screen-space offset neutral so zoom level cannot
// push the outer riders beyond the track edges.
const riderScreenLaneSpacingPixels = 0;
const riderAirMetersPerPixel = 0.025;
const riderMaximumAltitudeMeters = 0.85;

// The rider stays 58px tall, but turns can lean the square source art by up
// to 24 degrees. The transparent envelope also has to contain the downward
// shadow offset, not only the rotated artwork.
export const riderMarkerCanvasSize = 120;
export const riderMarkerDrawSize = 58;
export const riderMarkerDrawTop = -riderMarkerDrawSize / 2;
export const riderMarkerSafetyInsetPixels = (
  riderMarkerCanvasSize - riderMarkerDrawSize
) / 2;
export const riderMarkerShadowBlurPixels = 8;
export const riderMarkerMaximumShadowBlurPixels = 14;
export const riderMarkerShadowOffsetYPixels = 5;

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

export function riderScreenLaneOffsetsByPlayer(players: PlayerSlot[]) {
  const sortedPlayers = [...players].sort((left, right) => left.id - right.id);
  const offsets = new Map<PlayerId, number>();
  const spacing = sortedPlayers.length <= 1
    ? 0
    : riderScreenLaneSpacingPixels;
  const midpoint = (sortedPlayers.length - 1) / 2;

  sortedPlayers.forEach((player, index) => {
    offsets.set(player.id, (index - midpoint) * spacing);
  });

  return offsets;
}

export function riderScreenLaneTranslation(rotationDegrees: number, laneOffsetPixels: number) {
  const radians = normalizeHeading(rotationDegrees) * (Math.PI / 180);
  return {
    x: -Math.sin(radians) * laneOffsetPixels,
    y: Math.cos(radians) * laneOffsetPixels,
  };
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
