import type {
  RacePresentationViewport,
  RaceRiderOverlayLayout,
} from '../types';

const minimumViewportDimension = 240;
const maximumViewportDimension = 10_000;
const minimumSatelliteZoom = 0;
const maximumSatelliteZoom = 30;

/** Stable authored frame for cameras saved before reference viewports existed. */
export const legacyRacePresentationViewport: RacePresentationViewport = Object.freeze({
  width: 1366,
  height: 1024,
});

function roundedViewportDimension(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Accepts a CSS-pixel viewport suitable for durable race-presentation data.
 * Physical pixels and devicePixelRatio are deliberately excluded: two screens
 * with the same CSS aspect should present the same authored composition.
 */
export function normalizeRacePresentationViewport(
  value: unknown,
): RacePresentationViewport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.width !== 'number'
    || !Number.isFinite(candidate.width)
    || candidate.width < minimumViewportDimension
    || candidate.width > maximumViewportDimension
    || typeof candidate.height !== 'number'
    || !Number.isFinite(candidate.height)
    || candidate.height < minimumViewportDimension
    || candidate.height > maximumViewportDimension
  ) return null;

  return {
    width: roundedViewportDimension(candidate.width),
    height: roundedViewportDimension(candidate.height),
  };
}

export type RacePresentationFrame = Readonly<{
  referenceViewport: RacePresentationViewport;
  targetViewport: RacePresentationViewport;
  /** Uniform CSS scale that contains the complete authored viewport. */
  uniformScale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}>;

/** Maps an authored viewport into a target viewport with contain semantics. */
export function racePresentationFrame(
  referenceValue: unknown,
  targetValue: unknown,
): RacePresentationFrame | null {
  const referenceViewport = normalizeRacePresentationViewport(referenceValue);
  const targetViewport = normalizeRacePresentationViewport(targetValue);
  if (!referenceViewport || !targetViewport) return null;

  const uniformScale = Math.min(
    targetViewport.width / referenceViewport.width,
    targetViewport.height / referenceViewport.height,
  );
  const width = referenceViewport.width * uniformScale;
  const height = referenceViewport.height * uniformScale;
  return {
    referenceViewport,
    targetViewport,
    uniformScale,
    offsetX: (targetViewport.width - width) / 2,
    offsetY: (targetViewport.height - height) / 2,
    width,
    height,
  };
}

/**
 * Google Maps zoom is logarithmic in CSS pixels per geographic unit. This
 * delta preserves the authored satellite composition across viewport sizes.
 */
export function satelliteZoomDeltaForRacePresentation(
  referenceViewport: unknown,
  targetViewport: unknown,
) {
  const frame = racePresentationFrame(referenceViewport, targetViewport);
  return frame ? Math.log2(frame.uniformScale) : 0;
}

/** Satellite-only helper; do not use this CSS-resolution scale for 3D range. */
export function satelliteZoomForRacePresentation(
  zoom: number,
  referenceViewport: unknown,
  targetViewport: unknown,
) {
  if (!Number.isFinite(zoom)) return zoom;
  return Math.max(
    minimumSatelliteZoom,
    Math.min(
      maximumSatelliteZoom,
      zoom + satelliteZoomDeltaForRacePresentation(referenceViewport, targetViewport),
    ),
  );
}

/**
 * Aspect-only containment for a perspective 3D camera. Absolute CSS size is
 * intentionally irrelevant: same range plus same aspect keeps composition.
 * A narrower target backs the camera out enough to retain horizontal content.
 */
export function threeDimensionalRangeScaleForAspect(
  referenceValue: unknown,
  targetValue: unknown,
) {
  const referenceViewport = normalizeRacePresentationViewport(referenceValue);
  const targetViewport = normalizeRacePresentationViewport(targetValue);
  if (!referenceViewport || !targetViewport) return 1;
  const referenceAspect = referenceViewport.width / referenceViewport.height;
  const targetAspect = targetViewport.width / targetViewport.height;
  return Math.max(1, referenceAspect / targetAspect);
}

export function threeDimensionalRangeForAspect(
  range: number,
  referenceViewport: unknown,
  targetViewport: unknown,
) {
  if (!Number.isFinite(range) || range <= 0) return range;
  return range * threeDimensionalRangeScaleForAspect(referenceViewport, targetViewport);
}

export type RacePresentationOverlayRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  uniformScale: number;
}>;

/**
 * Converts a saved rider panel to a target CSS viewport without changing its
 * relationship to the contained camera frame.
 */
export function raceRiderOverlayRectForPresentation(
  layout: Pick<RaceRiderOverlayLayout, 'xPct' | 'yPct' | 'width' | 'height' | 'referenceViewport'>,
  targetViewport: unknown,
  fallbackReferenceViewport?: unknown,
): RacePresentationOverlayRect | null {
  const frame = racePresentationFrame(
    layout.referenceViewport ?? fallbackReferenceViewport,
    targetViewport,
  );
  if (!frame) return null;

  return {
    left: frame.offsetX + (layout.xPct * frame.width),
    top: frame.offsetY + (layout.yPct * frame.height),
    width: layout.width * frame.uniformScale,
    height: layout.height * frame.uniformScale,
    uniformScale: frame.uniformScale,
  };
}
