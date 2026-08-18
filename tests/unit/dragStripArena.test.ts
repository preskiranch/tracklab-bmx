import { describe, expect, it } from 'vitest';
import { dragStripAdaptiveCameraWindow } from '../../src/components/DragStripGameArenaLayer';

describe('drag strip adaptive camera', () => {
  it('keeps its close camera while riders remain together', () => {
    const together = dragStripAdaptiveCameraWindow([40, 40.5, 41, 41.5]);
    const riderCenterScreenPosition = (40.75 - together.scrollPercent) / together.viewportPercent;

    expect(together.viewportPercent).toBeLessThan(6);
    expect(riderCenterScreenPosition).toBeCloseTo(0.35, 3);
  });

  it('zooms out enough to keep separated riders inside the safe viewing area', () => {
    const separated = dragStripAdaptiveCameraWindow([20, 40, 60, 80]);
    const firstRiderScreenPosition = (20 - separated.scrollPercent) / separated.viewportPercent;
    const lastRiderScreenPosition = (80 - separated.scrollPercent) / separated.viewportPercent;

    expect(separated.viewportPercent).toBeGreaterThan(80);
    expect(firstRiderScreenPosition).toBeCloseTo(0.16, 3);
    expect(lastRiderScreenPosition).toBeCloseTo(0.84, 3);
  });
});
