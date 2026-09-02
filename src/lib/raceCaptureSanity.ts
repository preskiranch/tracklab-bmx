import type { RaceCapture } from '../types';
import { recordedBikeMetricsAreAccepted } from './bikeSampleSanity';
import { canonicalPlayerAccent } from './playerPalette';

export function acceptedRaceCapture(value: unknown): RaceCapture | null {
  if (!value || typeof value !== 'object') return null;
  const capture = value as Partial<RaceCapture>;
  if (
    capture.version !== 1
    || !Array.isArray(capture.samples)
    || !Array.isArray(capture.summary)
    || !recordedBikeMetricsAreAccepted(capture)
  ) return null;

  return {
    ...(capture as RaceCapture),
    summary: capture.summary.map((entry) => ({
      ...entry,
      accent: canonicalPlayerAccent(entry.colorName, entry.accent),
    })),
  };
}
