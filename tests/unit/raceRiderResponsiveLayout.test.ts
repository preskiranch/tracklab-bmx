import { describe, expect, it } from 'vitest';
import {
  raceRiderOverlayMaximumHeight,
  raceRiderOverlayMinimumHeight,
  raceRiderOverlayPreferenceForViewport,
} from '../../src/components/RaceRiderOverlay';

describe('race rider responsive layout', () => {
  it('keeps the readable two-row panel in phone and iPad portrait', () => {
    expect(raceRiderOverlayMinimumHeight(390, 844)).toBe(340);
    expect(raceRiderOverlayMinimumHeight(820, 1180)).toBe(340);
  });

  it('uses the compact one-row panel on short phone landscape viewports', () => {
    expect(raceRiderOverlayMinimumHeight(844, 390)).toBe(132);
    expect(raceRiderOverlayMaximumHeight(844, 390)).toBe(133);
    expect(raceRiderOverlayMinimumHeight(852, 393)).toBe(132);
    expect(raceRiderOverlayMaximumHeight(852, 393)).toBe(134);
    expect(raceRiderOverlayMinimumHeight(667, 375)).toBe(132);
    expect(raceRiderOverlayMaximumHeight(667, 375)).toBe(132);
    expect(raceRiderOverlayMaximumHeight(932, 430)).toBe(146);
  });

  it('preserves the existing iPad and desktop landscape height', () => {
    expect(raceRiderOverlayMinimumHeight(1024, 768)).toBe(190);
    expect(raceRiderOverlayMinimumHeight(1366, 1024)).toBe(190);
    expect(raceRiderOverlayMinimumHeight(1280, 500)).toBe(190);
    expect(raceRiderOverlayMaximumHeight(1024, 768)).toBe(Number.POSITIVE_INFINITY);
    expect(raceRiderOverlayMaximumHeight(1280, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not save phone-only presentation dimensions over the shared layout', () => {
    const requested = { xPct: 0.04, yPct: 0.7, width: 940, height: 220, locked: false };
    const presented = { xPct: 0.01, yPct: 0.58, width: 784, height: 133, locked: true };

    expect(raceRiderOverlayPreferenceForViewport(requested, presented, 844, 390)).toEqual({
      ...requested,
      locked: true,
    });
    expect(raceRiderOverlayPreferenceForViewport(requested, presented, 1024, 768)).toEqual(presented);
  });
});
