import { describe, expect, it } from 'vitest';
import { raceRiderOverlayMinimumHeight } from '../../src/components/RaceRiderOverlay';

describe('race rider responsive layout', () => {
  it('keeps the readable two-row panel in phone and iPad portrait', () => {
    expect(raceRiderOverlayMinimumHeight(390, 844)).toBe(340);
    expect(raceRiderOverlayMinimumHeight(820, 1180)).toBe(340);
  });

  it('uses the compact one-row panel on short phone landscape viewports', () => {
    expect(raceRiderOverlayMinimumHeight(844, 390)).toBe(190);
    expect(raceRiderOverlayMinimumHeight(667, 375)).toBe(190);
  });

  it('preserves the existing iPad and desktop landscape height', () => {
    expect(raceRiderOverlayMinimumHeight(1024, 768)).toBe(190);
    expect(raceRiderOverlayMinimumHeight(1366, 1024)).toBe(190);
  });
});
