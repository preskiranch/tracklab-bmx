export type RiderRigPoint = {
  x: number;
  y: number;
};

export const riderRigGeometry = {
  crankCenter: { x: 0.43, y: 0.735 },
  crankRadius: 0.047,
  frontHip: { x: 0.4, y: 0.355 },
  rearHip: { x: 0.375, y: 0.365 },
  thighLength: 0.22,
  shinLength: 0.22,
} as const;

export function riderCrankPedalPositions(crankAngleRadians: number) {
  const angle = Number.isFinite(crankAngleRadians) ? crankAngleRadians : 0;
  const offsetX = Math.cos(angle) * riderRigGeometry.crankRadius;
  const offsetY = Math.sin(angle) * riderRigGeometry.crankRadius;

  return {
    front: {
      x: riderRigGeometry.crankCenter.x + offsetX,
      y: riderRigGeometry.crankCenter.y + offsetY,
    },
    rear: {
      x: riderRigGeometry.crankCenter.x - offsetX,
      y: riderRigGeometry.crankCenter.y - offsetY,
    },
  };
}

export function riderLegKnee(
  hip: RiderRigPoint,
  pedal: RiderRigPoint,
  thighLength = riderRigGeometry.thighLength,
  shinLength = riderRigGeometry.shinLength,
) {
  const dx = pedal.x - hip.x;
  const dy = pedal.y - hip.y;
  const rawDistance = Math.hypot(dx, dy);
  if (rawDistance < 0.0001) {
    return { x: hip.x + thighLength, y: hip.y };
  }

  const maxReach = Math.max(0.0001, thighLength + shinLength - 0.0001);
  const minReach = Math.abs(thighLength - shinLength) + 0.0001;
  const distance = Math.max(minReach, Math.min(maxReach, rawDistance));
  const unitX = dx / rawDistance;
  const unitY = dy / rawDistance;
  const along = (
    (thighLength * thighLength)
    - (shinLength * shinLength)
    + (distance * distance)
  ) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, (thighLength * thighLength) - (along * along)));
  const baseX = hip.x + unitX * along;
  const baseY = hip.y + unitY * along;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const candidateA = {
    x: baseX + perpendicularX * bend,
    y: baseY + perpendicularY * bend,
  };
  const candidateB = {
    x: baseX - perpendicularX * bend,
    y: baseY - perpendicularY * bend,
  };

  // In the unmirrored side view the bicycle faces right, so a BMX knee bends
  // toward positive X. The complete rig is mirrored later for left-facing travel.
  return candidateA.x >= candidateB.x ? candidateA : candidateB;
}
