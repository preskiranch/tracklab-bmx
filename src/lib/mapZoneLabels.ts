import type { TrackPoint } from '../types';
import { pointAtRouteMeter } from './trackMapping';

export const pedalZoneLabelSizePixels = 30;
export const pedalZoneLabelAnchor = {
  x: pedalZoneLabelSizePixels / 2,
  y: 40,
} as const;

export function pedalZoneLabelPosition(
  route: TrackPoint[],
  startMeter: number,
  endMeter: number,
) {
  if (route.length < 2 || endMeter <= startMeter) {
    return null;
  }

  return pointAtRouteMeter(route, startMeter + ((endMeter - startMeter) / 2));
}
