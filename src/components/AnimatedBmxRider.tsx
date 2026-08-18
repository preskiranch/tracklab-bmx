import { useEffect, useRef } from 'react';
import {
  riderCrankPedalPositions,
  riderLegKnee,
  riderRigGeometry,
  type RiderRigPoint,
} from '../lib/riderRig';

type AnimatedBmxRiderProps = {
  active: boolean;
  cadenceRpm: number;
};

const logicalSize = 192;
const baseImageUrl = '/assets/rider-lime-rig-base.png';

function point(value: RiderRigPoint) {
  return { x: value.x * logicalSize, y: value.y * logicalSize };
}

function strokeSegment(
  context: CanvasRenderingContext2D,
  start: RiderRigPoint,
  end: RiderRigPoint,
  color: string,
  width: number,
) {
  const from = point(start);
  const to = point(end);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function eraseOriginalMovingParts(context: CanvasRenderingContext2D) {
  const legPaths = [
    [[0.36, 0.34], [0.33, 0.5], [0.39, 0.65], [0.48, 0.7]],
    [[0.4, 0.34], [0.45, 0.51], [0.44, 0.66], [0.53, 0.71]],
  ] as const;
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 22;
  for (const path of legPaths) {
    context.beginPath();
    context.moveTo(path[0][0] * logicalSize, path[0][1] * logicalSize);
    path.slice(1).forEach(([x, y]) => context.lineTo(x * logicalSize, y * logicalSize));
    context.stroke();
  }
  const crank = point(riderRigGeometry.crankCenter);
  context.beginPath();
  context.arc(crank.x, crank.y, 14, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawFrame(context: CanvasRenderingContext2D, accent: string) {
  const rearHub = { x: 0.22, y: 0.745 };
  const bottomBracket = riderRigGeometry.crankCenter;
  const seatJoint = { x: 0.365, y: 0.55 };
  const headTop = { x: 0.655, y: 0.485 };
  const headBottom = { x: 0.66, y: 0.555 };
  const segments = [
    [rearHub, seatJoint],
    [rearHub, bottomBracket],
    [seatJoint, bottomBracket],
    [seatJoint, headTop],
    [headBottom, bottomBracket],
    [headTop, headBottom],
  ] as const;

  context.lineCap = 'round';
  context.lineJoin = 'round';
  segments.forEach(([start, end]) => strokeSegment(context, start, end, '#07090b', 7));
  segments.forEach(([start, end]) => strokeSegment(context, start, end, '#343b40', 3));
  strokeSegment(context, seatJoint, headTop, accent, 1.2);
  strokeSegment(context, rearHub, bottomBracket, '#9ca3af', 1.4);
}

function drawCrankArm(context: CanvasRenderingContext2D, pedal: RiderRigPoint, color: string) {
  strokeSegment(context, riderRigGeometry.crankCenter, pedal, '#050607', 6);
  strokeSegment(context, riderRigGeometry.crankCenter, pedal, color, 2.5);
  const location = point(pedal);
  context.strokeStyle = '#08090b';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(location.x - 5, location.y);
  context.lineTo(location.x + 9, location.y);
  context.stroke();
}

function drawLeg(
  context: CanvasRenderingContext2D,
  hip: RiderRigPoint,
  pedal: RiderRigPoint,
  accent: string,
  rear: boolean,
) {
  const knee = riderLegKnee(hip, pedal);
  const localHip = point(hip);
  const localKnee = point(knee);
  const localPedal = point(pedal);
  context.save();
  context.globalAlpha = rear ? 0.76 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 14 : 15;
  context.beginPath();
  context.moveTo(localHip.x, localHip.y);
  context.lineTo(localKnee.x, localKnee.y);
  context.lineTo(localPedal.x, localPedal.y);
  context.stroke();
  context.strokeStyle = rear ? '#111417' : '#202427';
  context.lineWidth = rear ? 10 : 11;
  context.stroke();
  context.strokeStyle = accent;
  context.globalAlpha = rear ? 0.3 : 0.7;
  context.lineWidth = 1.8;
  context.stroke();
  context.restore();

  context.save();
  context.globalAlpha = rear ? 0.76 : 1;
  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 7 : 8;
  context.beginPath();
  context.moveTo(localPedal.x - 5, localPedal.y);
  context.lineTo(localPedal.x + 10, localPedal.y);
  context.stroke();
  context.restore();
}

function renderRider(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  crankAngle: number,
) {
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const nextSize = Math.round(logicalSize * pixelRatio);
  if (canvas.width !== nextSize || canvas.height !== nextSize) {
    canvas.width = nextSize;
    canvas.height = nextSize;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, logicalSize, logicalSize);
  context.drawImage(image, 0, 0, logicalSize, logicalSize);
  eraseOriginalMovingParts(context);
  drawFrame(context, '#78df3b');
  const pedals = riderCrankPedalPositions(crankAngle);
  drawCrankArm(context, pedals.rear, '#555c63');
  drawLeg(context, riderRigGeometry.rearHip, pedals.rear, '#78df3b', true);
  drawCrankArm(context, pedals.front, '#aeb5bd');
  drawLeg(context, riderRigGeometry.frontHip, pedals.front, '#78df3b', false);
  const crank = point(riderRigGeometry.crankCenter);
  context.fillStyle = '#d1d5db';
  context.strokeStyle = '#050607';
  context.lineWidth = 2.3;
  context.beginPath();
  context.arc(crank.x, crank.y, 3.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

export function AnimatedBmxRider({ active, cadenceRpm }: AnimatedBmxRiderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);
  const activeRef = useRef(active);
  const cadenceRef = useRef(cadenceRpm);

  useEffect(() => {
    activeRef.current = active;
    cadenceRef.current = Math.max(0, cadenceRpm);
    if (!active) phaseRef.current = 0;
  }, [active, cadenceRpm]);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let previousTime: number | null = null;
    const image = new Image();
    image.decoding = 'async';

    const render = (time: number) => {
      if (cancelled || !canvasRef.current) return;
      const isActive = activeRef.current;
      const currentCadence = cadenceRef.current;
      if (previousTime !== null && isActive && currentCadence > 0) {
        const elapsedSeconds = Math.min(0.1, Math.max(0, time - previousTime) / 1000);
        phaseRef.current = (phaseRef.current + elapsedSeconds * currentCadence / 60 * Math.PI * 2) % (Math.PI * 2);
      } else if (!isActive) {
        phaseRef.current = 0;
      }
      previousTime = time;
      renderRider(canvasRef.current, image, phaseRef.current);
      canvasRef.current.dataset.crankAngleDegrees = ((phaseRef.current * 180 / Math.PI) % 360).toFixed(1);
      frameId = requestAnimationFrame(render);
    };

    image.onload = () => {
      if (cancelled) return;
      frameId = requestAnimationFrame(render);
    };
    image.src = baseImageUrl;
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-crank-motion={active ? 'continuous-360' : 'level-stopped'}
      data-cadence-rpm={Math.max(0, cadenceRpm).toFixed(1)}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

export default AnimatedBmxRider;
