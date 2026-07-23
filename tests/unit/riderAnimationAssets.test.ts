import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { riderAtlasFrameCount } from '../../src/lib/riderAnimation';

const colors = ['lime', 'red', 'blue', 'yellow'];

describe('animated rider assets', () => {
  it.each(colors)('ships a complete full-cycle %s rider atlas', async (color) => {
    const file = new URL(`../../public/assets/rider-${color}-animated.png`, import.meta.url);
    const atlas = PNG.sync.read(await readFile(file));

    expect(atlas.width).toBe(atlas.height * riderAtlasFrameCount);

    const frameWidth = atlas.width / riderAtlasFrameCount;
    const frameCenters: number[] = [];
    const frameGroundLines: number[] = [];
    for (let frameIndex = 0; frameIndex < riderAtlasFrameCount; frameIndex += 1) {
      let visiblePixels = 0;
      let minX = frameWidth;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < atlas.height; y += 1) {
        for (let x = frameIndex * frameWidth; x < (frameIndex + 1) * frameWidth; x += 1) {
          if (atlas.data[((y * atlas.width + x) * 4) + 3] > 32) {
            visiblePixels += 1;
            const localX = x - (frameIndex * frameWidth);
            minX = Math.min(minX, localX);
            maxX = Math.max(maxX, localX);
            maxY = Math.max(maxY, y);
          }
        }
      }
      expect(visiblePixels).toBeGreaterThan(2_000);
      frameCenters.push((minX + maxX) / 2);
      frameGroundLines.push(maxY);
    }

    expect(Math.max(...frameCenters) - Math.min(...frameCenters)).toBeLessThanOrEqual(2);
    expect(Math.max(...frameGroundLines) - Math.min(...frameGroundLines)).toBeLessThanOrEqual(2);
  });
});
