import { useEffect, useRef } from 'react';

type AnimatedBmxRiderProps = {
  active: boolean;
  cadenceRpm: number;
};

const sourceFrameSize = 192;
const sourceFrameCount = 9;
const safetyPadding = 10;
const canvasSize = sourceFrameSize + safetyPadding * 2;
const spriteSheetUrl = '/assets/rider-lime-animated.png';

type CanvasPoint = {
  x: number;
  y: number;
};

const wheelGeometry = {
  rear: { x: 0.22, y: 0.745, radius: 0.17 },
  front: { x: 0.795, y: 0.745, radius: 0.17 },
} as const;

function paddedPoint(point: CanvasPoint) {
  return {
    x: safetyPadding + point.x * sourceFrameSize,
    y: safetyPadding + point.y * sourceFrameSize,
  };
}

function drawCompleteWheel(
  context: CanvasRenderingContext2D,
  wheel: CanvasPoint & { radius: number },
) {
  const center = paddedPoint(wheel);
  const radius = wheel.radius * sourceFrameSize;

  context.save();
  context.strokeStyle = '#090b0d';
  context.lineWidth = 8;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = '#5d6367';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(center.x, center.y, radius - 4.5, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = 'rgba(151,159,164,.72)';
  context.lineWidth = 0.7;
  for (let spokeIndex = 0; spokeIndex < 12; spokeIndex += 1) {
    const angle = (spokeIndex / 12) * Math.PI * 2;
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(
      center.x + Math.cos(angle) * (radius - 7),
      center.y + Math.sin(angle) * (radius - 7),
    );
    context.stroke();
  }

  context.fillStyle = '#111416';
  context.beginPath();
  context.arc(center.x, center.y, 3.2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function renderRider(
  canvas: HTMLCanvasElement,
  spriteSheet: HTMLImageElement,
  crankAngle: number,
) {
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const nextSize = Math.round(canvasSize * pixelRatio);
  if (canvas.width !== nextSize || canvas.height !== nextSize) {
    canvas.width = nextSize;
    canvas.height = nextSize;
  }

  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, canvasSize, canvasSize);

  drawCompleteWheel(context, wheelGeometry.rear);
  drawCompleteWheel(context, wheelGeometry.front);

  const normalizedAngle = ((crankAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const frameIndex = Math.floor(normalizedAngle / (Math.PI * 2) * sourceFrameCount) % sourceFrameCount;
  context.drawImage(
    spriteSheet,
    frameIndex * sourceFrameSize,
    0,
    sourceFrameSize,
    sourceFrameSize,
    safetyPadding,
    safetyPadding,
    sourceFrameSize,
    sourceFrameSize,
  );

  return frameIndex;
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
    const spriteSheet = new Image();
    spriteSheet.decoding = 'async';

    const render = (time: number) => {
      if (cancelled || !canvasRef.current) return;
      const isActive = activeRef.current;
      const currentCadence = cadenceRef.current;
      if (previousTime !== null && isActive && currentCadence > 0) {
        const elapsedSeconds = Math.max(0, time - previousTime) / 1000;
        phaseRef.current = (
          phaseRef.current
          + elapsedSeconds * currentCadence / 60 * Math.PI * 2
        ) % (Math.PI * 2);
      } else if (!isActive) {
        phaseRef.current = 0;
      }
      previousTime = time;

      const frameIndex = renderRider(canvasRef.current, spriteSheet, phaseRef.current);
      canvasRef.current.dataset.crankAngleDegrees = (
        (phaseRef.current * 180 / Math.PI) % 360
      ).toFixed(1);
      canvasRef.current.dataset.pedalFrame = String(frameIndex);
      frameId = requestAnimationFrame(render);
    };

    spriteSheet.onload = () => {
      if (cancelled) return;
      frameId = requestAnimationFrame(render);
    };
    spriteSheet.src = spriteSheetUrl;
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
      data-crank-motion={active ? 'continuous-360' : 'level-stopped'}
      data-cadence-rpm={Math.max(0, cadenceRpm).toFixed(1)}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

export default AnimatedBmxRider;
