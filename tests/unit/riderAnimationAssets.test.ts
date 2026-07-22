import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { riderAtlasFrameCount } from '../../src/lib/riderAnimation';

const colors = ['lime', 'red', 'blue', 'yellow'];

describe('animated rider assets', () => {
  it.each(colors)('ships a complete six-frame %s rider atlas', async (color) => {
    const file = new URL(`../../public/assets/rider-${color}-animated.png`, import.meta.url);
    const atlas = PNG.sync.read(await readFile(file));

    expect(atlas.width).toBe(atlas.height * riderAtlasFrameCount);

    const frameWidth = atlas.width / riderAtlasFrameCount;
    for (let frameIndex = 0; frameIndex < riderAtlasFrameCount; frameIndex += 1) {
      let visiblePixels = 0;
      for (let y = 0; y < atlas.height; y += 1) {
        for (let x = frameIndex * frameWidth; x < (frameIndex + 1) * frameWidth; x += 1) {
          if (atlas.data[((y * atlas.width + x) * 4) + 3] > 32) {
            visiblePixels += 1;
          }
        }
      }
      expect(visiblePixels).toBeGreaterThan(2_000);
    }
  });
});
