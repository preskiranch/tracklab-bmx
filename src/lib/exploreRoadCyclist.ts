import { riderLegKnee, type RiderRigPoint } from './riderRig';

const roadWheelCircumferenceMeters = 2.096;

export const exploreRoadCyclistGeometry = {
  crankCenter: { x: 82, y: 74 },
  crankRadius: 8,
  frontHip: { x: 72, y: 36 },
  rearHip: { x: 70, y: 37 },
  thighLength: 25,
  shinLength: 25,
} as const;

function normalizedPhase(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 1) + 1) % 1;
}

export function exploreRoadCyclistRotationDegrees(gradePercent: number) {
  const safeGrade = Number.isFinite(gradePercent)
    ? Math.max(-30, Math.min(30, gradePercent))
    : 0;
  return -(Math.atan(safeGrade / 100) * 180) / Math.PI;
}

export function exploreRoadCyclistPedalPositions(pedalPhase: number) {
  const angle = normalizedPhase(pedalPhase) * Math.PI * 2;
  const offsetX = Math.cos(angle) * exploreRoadCyclistGeometry.crankRadius;
  const offsetY = Math.sin(angle) * exploreRoadCyclistGeometry.crankRadius;
  return {
    front: {
      x: exploreRoadCyclistGeometry.crankCenter.x + offsetX,
      y: exploreRoadCyclistGeometry.crankCenter.y + offsetY,
    },
    rear: {
      x: exploreRoadCyclistGeometry.crankCenter.x - offsetX,
      y: exploreRoadCyclistGeometry.crankCenter.y - offsetY,
    },
  };
}

export function exploreRoadCyclistLegPoints(pedalPhase: number) {
  const pedals = exploreRoadCyclistPedalPositions(pedalPhase);
  const kneeFor = (hip: RiderRigPoint, pedal: RiderRigPoint) => riderLegKnee(
    hip,
    pedal,
    exploreRoadCyclistGeometry.thighLength,
    exploreRoadCyclistGeometry.shinLength,
  );
  return {
    front: {
      hip: exploreRoadCyclistGeometry.frontHip,
      knee: kneeFor(exploreRoadCyclistGeometry.frontHip, pedals.front),
      pedal: pedals.front,
    },
    rear: {
      hip: exploreRoadCyclistGeometry.rearHip,
      knee: kneeFor(exploreRoadCyclistGeometry.rearHip, pedals.rear),
      pedal: pedals.rear,
    },
  };
}

export function exploreRoadCyclistWheelRotationDegrees(distanceMeters: number) {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  return normalizedPhase(safeDistance / roadWheelCircumferenceMeters) * 360;
}
