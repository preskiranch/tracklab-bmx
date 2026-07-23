import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

const colors = ['lime', 'red', 'blue', 'yellow'];

describe('rider rig base assets', () => {
  it.each(colors)('ships a square stationary %s rider base', async (color) => {
    const file = new URL(`../../public/assets/rider-${color}-rig-base.png`, import.meta.url);
    const image = PNG.sync.read(await readFile(file));
    let visiblePixels = 0;
    for (let offset = 3; offset < image.data.length; offset += 4) {
      if (image.data[offset] > 32) {
        visiblePixels += 1;
      }
    }

    expect(image.width).toBe(image.height);
    expect(image.width).toBe(192);
    expect(visiblePixels).toBeGreaterThan(2_000);
  });
});
