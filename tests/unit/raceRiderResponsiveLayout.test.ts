import { describe, expect, it } from 'vitest';
import {
  raceRiderOverlayMaximumHeight,
  raceRiderOverlayMinimumHeight,
  raceRiderOverlayPreferenceForViewport,
} from '../../src/components/RaceRiderOverlay';

describe('race rider responsive layout', () => {
  it('keeps a readable two-row panel without taking over phone and iPad portrait', () => {
    expect(raceRiderOverlayMinimumHeight(390, 844)).toBe(248);
    expect(raceRiderOverlayMaximumHeight(390, 844)).toBe(270);
    expect(raceRiderOverlayMinimumHeight(820, 1180)).toBe(300);
    expect(raceRiderOverlayMinimumHeight(390, 844) / 844).toBeLessThan(0.3);
    expect(raceRiderOverlayMinimumHeight(820, 1180) / 1180).toBeLessThan(0.26);
  });

  it('uses the compact one-row panel on short phone landscape viewports', () => {
    expect(raceRiderOverlayMinimumHeight(844, 390)).toBe(114);
    expect(raceRiderOverlayMaximumHeight(844, 390)).toBe(117);
    expect(raceRiderOverlayMinimumHeight(852, 393)).toBe(114);
    expect(raceRiderOverlayMaximumHeight(852, 393)).toBe(118);
    expect(raceRiderOverlayMinimumHeight(667, 375)).toBe(114);
    expect(raceRiderOverlayMaximumHeight(667, 375)).toBe(114);
    expect(raceRiderOverlayMaximumHeight(932, 430)).toBe(128);
    expect(raceRiderOverlayMinimumHeight(844, 390) / 390).toBeLessThan(0.3);
  });

  it('keeps enough iPad and desktop landscape height for photos, metrics, and heart rate', () => {
    expect(raceRiderOverlayMinimumHeight(1024, 768)).toBe(220);
    expect(raceRiderOverlayMinimumHeight(1366, 1024)).toBe(220);
    expect(raceRiderOverlayMinimumHeight(1280, 500)).toBe(220);
    expect(raceRiderOverlayMaximumHeight(1024, 768)).toBe(Number.POSITIVE_INFINITY);
    expect(raceRiderOverlayMaximumHeight(1280, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it('replays the iPad Pro panel at the studio tablet presentation scale', () => {
    expect(raceRiderOverlayMinimumHeight(1024, 768, 1024 / 1366)).toBe(165);
    expect(raceRiderOverlayMinimumHeight(1024, 768, 1024 / 1366, 190 * (1024 / 1366)))
      .toBeCloseTo(190 * (1024 / 1366), 6);
    expect(raceRiderOverlayMinimumHeight(1366, 1024, 1)).toBe(220);
  });

  it('reserves readable card height when a saved owner panel reaches a phone', () => {
    expect(raceRiderOverlayMinimumHeight(390, 844, 0.5, 63)).toBe(248);
    expect(raceRiderOverlayMinimumHeight(844, 390, 0.5, 84)).toBe(114);
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
