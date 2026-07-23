import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const colors = ['blue', 'lime', 'red', 'yellow'];

describe('rider rig source assets', () => {
  it.each(colors)('keeps the complete %s rider silhouette inside its source frame', async (color) => {
    const image = PNG.sync.read(await readFile(
      path.resolve(process.cwd(), `public/assets/rider-${color}-rig-base.png`),
    ));
    let minimumX = image.width;
    let minimumY = image.height;
    let maximumX = -1;
    let maximumY = -1;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const alpha = image.data[((y * image.width) + x) * 4 + 3];
        if (alpha <= 8) {
          continue;
        }
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }

    expect(minimumX).toBeGreaterThanOrEqual(8);
    expect(minimumY).toBeGreaterThanOrEqual(8);
    expect(maximumX).toBeLessThanOrEqual(image.width - 9);
    expect(maximumY).toBeLessThanOrEqual(image.height - 9);
  });
});
