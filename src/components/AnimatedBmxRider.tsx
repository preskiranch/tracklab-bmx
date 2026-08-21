import { useEffect, useRef } from 'react';

type AnimatedBmxRiderProps = {
  active: boolean;
  cadenceRpm: number;
};

type Point = { x: number; y: number };

const sourceWidth = 291;
const sourceHeight = 300;
const safetyPadding = 6;
const canvasWidth = sourceWidth + safetyPadding * 2;
const canvasHeight = sourceHeight + safetyPadding * 2;
const riderImageUrl = '/assets/rider-lime-20-bmx.png';

const bike = {
  rearHub: { x: 50, y: 252 },
  crank: { x: 124, y: 253 },
  seatJoint: { x: 112, y: 198 },
  headTop: { x: 216, y: 173 },
  headBottom: { x: 225, y: 203 },
} as const;

const rider = {
  rearHip: { x: 108, y: 114 },
  frontHip: { x: 123, y: 117 },
  thighLength: 80,
  shinLength: 82,
  crankRadius: 13,
} as const;

function canvasPoint(point: Point) {
  return { x: safetyPadding + point.x, y: safetyPadding + point.y };
}

function pedalPositions(crankAngle: number) {
  const offsetX = Math.cos(crankAngle) * rider.crankRadius;
  const offsetY = Math.sin(crankAngle) * rider.crankRadius;
  return {
    front: { x: bike.crank.x + offsetX, y: bike.crank.y + offsetY },
    rear: { x: bike.crank.x - offsetX, y: bike.crank.y - offsetY },
  };
}

function legKnee(hip: Point, pedal: Point) {
  const dx = pedal.x - hip.x;
  const dy = pedal.y - hip.y;
  const rawDistance = Math.max(0.001, Math.hypot(dx, dy));
  const distance = Math.min(rider.thighLength + rider.shinLength - 0.001, rawDistance);
  const unitX = dx / rawDistance;
  const unitY = dy / rawDistance;
  const along = (
    rider.thighLength ** 2
    - rider.shinLength ** 2
    + distance ** 2
  ) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, rider.thighLength ** 2 - along ** 2));
  const baseX = hip.x + unitX * along;
  const baseY = hip.y + unitY * along;
  const candidateA = { x: baseX - unitY * bend, y: baseY + unitX * bend };
  const candidateB = { x: baseX + unitY * bend, y: baseY - unitX * bend };

  // The side-view bicycle faces right, so both knees bend toward its front.
  return candidateA.x >= candidateB.x ? candidateA : candidateB;
}

function eraseStaticLegs(context: CanvasRenderingContext2D) {
  const erasePath = (points: Point[], width: number) => {
    context.beginPath();
    const start = canvasPoint(points[0]);
    context.moveTo(start.x, start.y);
    points.slice(1).forEach((point) => {
      const next = canvasPoint(point);
      context.lineTo(next.x, next.y);
    });
    context.lineWidth = width;
    context.stroke();
  };

  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  erasePath([
    { x: 102, y: 116 }, { x: 125, y: 157 },
    { x: 118, y: 205 }, { x: 143, y: 231 },
  ], 35);
  erasePath([
    { x: 122, y: 117 }, { x: 157, y: 154 },
    { x: 136, y: 207 }, { x: 161, y: 226 },
  ], 36);
  erasePath([{ x: 110, y: 216 }, { x: 151, y: 231 }], 22);
  erasePath([{ x: 137, y: 224 }, { x: 180, y: 226 }], 22);
  context.restore();
}

function strokeSegment(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  width: number,
) {
  const localStart = canvasPoint(start);
  const localEnd = canvasPoint(end);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(localStart.x, localStart.y);
  context.lineTo(localEnd.x, localEnd.y);
  context.stroke();
}

function drawReconstructedFrame(context: CanvasRenderingContext2D) {
  const frameSegments = [
    [bike.rearHub, bike.seatJoint],
    [bike.rearHub, bike.crank],
    [bike.seatJoint, bike.crank],
    [bike.seatJoint, bike.headTop],
    [bike.crank, bike.headBottom],
    [bike.headTop, bike.headBottom],
  ] as const;

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  frameSegments.forEach(([start, end]) => strokeSegment(context, start, end, '#050607', 6.4));
  frameSegments.forEach(([start, end]) => strokeSegment(context, start, end, '#282c2e', 2.1));
  strokeSegment(context, bike.rearHub, bike.crank, '#90979a', 1.2);
  strokeSegment(
    context,
    { x: bike.rearHub.x, y: bike.rearHub.y + 4 },
    { x: bike.crank.x, y: bike.crank.y + 4 },
    '#555b5e',
    1.2,
  );
  context.restore();
}

function drawLeg(
  context: CanvasRenderingContext2D,
  hip: Point,
  pedal: Point,
  rear: boolean,
) {
  const knee = legKnee(hip, pedal);
  const localHip = canvasPoint(hip);
  const localKnee = canvasPoint(knee);
  const localPedal = canvasPoint(pedal);

  context.save();
  context.globalAlpha = rear ? 0.83 : 1;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  // Taper the pants at the knee and ankle instead of drawing one uniform
  // tube. This keeps the silhouette natural through every crank angle.
  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 27 : 29;
  context.beginPath();
  context.moveTo(localHip.x, localHip.y);
  context.lineTo(localKnee.x, localKnee.y);
  context.stroke();
  context.strokeStyle = rear ? '#111315' : '#171a1c';
  context.lineWidth = rear ? 21 : 22.5;
  context.stroke();

  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 21 : 23;
  context.beginPath();
  context.moveTo(localKnee.x, localKnee.y);
  context.lineTo(localPedal.x, localPedal.y);
  context.stroke();
  context.strokeStyle = rear ? '#131618' : '#1b1e20';
  context.lineWidth = rear ? 15 : 16.5;
  context.stroke();

  context.fillStyle = rear ? '#121416' : '#191c1e';
  context.beginPath();
  context.arc(localKnee.x, localKnee.y, rear ? 10.5 : 11.5, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = rear ? 'rgba(102,108,112,.2)' : 'rgba(116,122,126,.3)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(localHip.x + 2, localHip.y);
  context.lineTo(localKnee.x + 2, localKnee.y);
  context.lineTo(localPedal.x + 1, localPedal.y);
  context.stroke();

  context.strokeStyle = '#050607';
  context.lineWidth = rear ? 11 : 12;
  context.beginPath();
  context.moveTo(localPedal.x - 8, localPedal.y - 1);
  context.lineTo(localPedal.x + 16, localPedal.y - 1);
  context.stroke();
  context.strokeStyle = rear ? '#272b2e' : '#3c4246';
  context.lineWidth = 3;
  context.stroke();
  context.restore();
}

function drawCrankArm(context: CanvasRenderingContext2D, pedal: Point, rear: boolean) {
  context.save();
  context.lineCap = 'round';
  strokeSegment(context, bike.crank, pedal, '#050607', rear ? 5 : 5.6);
  strokeSegment(context, bike.crank, pedal, rear ? '#5c6266' : '#aeb4b7', 1.8);
  context.restore();
}

function drawArticulatedRig(context: CanvasRenderingContext2D, crankAngle: number) {
  const pedals = pedalPositions(crankAngle);
  drawCrankArm(context, pedals.rear, true);
  drawLeg(context, rider.rearHip, pedals.rear, true);
  drawReconstructedFrame(context);
  drawCrankArm(context, pedals.front, false);
  drawLeg(context, rider.frontHip, pedals.front, false);

  const crank = canvasPoint(bike.crank);
  context.fillStyle = '#d8dcde';
  context.strokeStyle = '#050607';
  context.lineWidth = 2.4;
  context.beginPath();
  context.arc(crank.x, crank.y, 4.4, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function renderRider(canvas: HTMLCanvasElement, image: HTMLImageElement, crankAngle: number) {
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const nextWidth = Math.round(canvasWidth * pixelRatio);
  const nextHeight = Math.round(canvasHeight * pixelRatio);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, safetyPadding, safetyPadding, sourceWidth, sourceHeight);
  eraseStaticLegs(context);
  drawArticulatedRig(context, crankAngle);
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
    const riderImage = new Image();
    riderImage.decoding = 'async';

    const render = (time: number) => {
      if (cancelled || !canvasRef.current) return;
      const isActive = activeRef.current;
      const currentCadence = cadenceRef.current;
      if (previousTime !== null && isActive && currentCadence > 0) {
        const elapsedSeconds = Math.min(0.1, Math.max(0, time - previousTime) / 1000);
        phaseRef.current = (
          phaseRef.current + elapsedSeconds * currentCadence / 60 * Math.PI * 2
        ) % (Math.PI * 2);
      } else if (!isActive) {
        phaseRef.current = 0;
      }
      previousTime = time;

      if (riderImage.complete && riderImage.naturalWidth > 0) {
        renderRider(canvasRef.current, riderImage, phaseRef.current);
      }
      canvasRef.current.dataset.crankAngleDegrees = (
        (phaseRef.current * 180 / Math.PI) % 360
      ).toFixed(1);
      canvasRef.current.dataset.pedalPhase = (
        phaseRef.current / (Math.PI * 2)
      ).toFixed(4);
      frameId = requestAnimationFrame(render);
    };

    riderImage.src = riderImageUrl;
    // Keep the cadence clock independent of image delivery. On a cold or slow
    // asset load the pull must still begin moving immediately; drawing starts
    // on the first frame after the rider image becomes available.
    frameId = requestAnimationFrame(render);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-animation-sync="wattbike-cadence-1-to-1"
      data-bike-standard="20-inch-bmx-race"
      data-render-model="single-stable-articulated-rig"
      data-crank-motion={active ? 'continuous-360' : 'level-stopped'}
      data-cadence-rpm={Math.max(0, cadenceRpm).toFixed(1)}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

export default AnimatedBmxRider;
