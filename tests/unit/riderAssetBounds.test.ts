import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { riderRigBaseAssetByColor } from '../../src/lib/riderAssets';
import {
  riderMarkerCanvasSize,
  riderMarkerDrawSize,
  riderMarkerMaximumShadowBlurPixels,
  riderMarkerSafetyInsetPixels,
  riderMarkerShadowOffsetYPixels,
} from '../../src/lib/riderPresentation';

const colors = ['blue', 'lime', 'red', 'yellow'] as const;

async function readRiderAsset(color: (typeof colors)[number]) {
  const assetUrl = riderRigBaseAssetByColor[color];
  return PNG.sync.read(await readFile(
    path.resolve(process.cwd(), `public${assetUrl}`),
  ));
}

describe('rider rig source assets', () => {
  it.each(colors)('keeps the complete %s rider silhouette inside its source frame', async (color) => {
    const image = await readRiderAsset(color);
    let minimumX = image.width;
    let minimumY = image.height;
    let maximumX = -1;
    let maximumY = -1;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const alpha = image.data[((y * image.width) + x) * 4 + 3];
        if (alpha <= 8) continue;
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

  it.each(colors)('keeps the complete %s rider inside the 3D marker envelope while leaning', async (color) => {
    const image = await readRiderAsset(color);
    const sourceToDrawScale = riderMarkerDrawSize / image.width;

    for (let leanDegrees = -24; leanDegrees <= 24; leanDegrees += 2) {
      const radians = leanDegrees * (Math.PI / 180);
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      let minimumX = riderMarkerCanvasSize;
      let minimumY = riderMarkerCanvasSize;
      let maximumX = 0;
      let maximumY = 0;

      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const alpha = image.data[((y * image.width) + x) * 4 + 3];
          if (alpha <= 8) continue;

          const localX = (x - image.width / 2) * sourceToDrawScale;
          const localY = (y - image.height) * sourceToDrawScale;
          const rotatedX = riderMarkerSafetyInsetPixels
            + (riderMarkerDrawSize / 2)
            + (localX * cosine)
            - (localY * sine);
          const rotatedY = riderMarkerSafetyInsetPixels
            + riderMarkerDrawSize
            + (localX * sine)
            + (localY * cosine);
          minimumX = Math.min(minimumX, rotatedX);
          minimumY = Math.min(minimumY, rotatedY);
          maximumX = Math.max(maximumX, rotatedX);
          maximumY = Math.max(maximumY, rotatedY);
        }
      }

      expect(minimumX - riderMarkerMaximumShadowBlurPixels).toBeGreaterThanOrEqual(0);
      expect(minimumY - riderMarkerMaximumShadowBlurPixels).toBeGreaterThanOrEqual(0);
      expect(maximumX + riderMarkerMaximumShadowBlurPixels).toBeLessThanOrEqual(riderMarkerCanvasSize);
      expect(
        maximumY
        + riderMarkerMaximumShadowBlurPixels
        + riderMarkerShadowOffsetYPixels,
      ).toBeLessThanOrEqual(riderMarkerCanvasSize);
    }
  });

  it('ships a complete transparent 20-inch BMX pull rider without a lime leg guide', async () => {
    const image = PNG.sync.read(await readFile(
      path.resolve(process.cwd(), 'public/assets/rider-lime-20-bmx.png'),
    ));
    let transparentPixels = 0;
    let lowerBodyLimePixels = 0;
    let minimumX = image.width;
    let minimumY = image.height;
    let maximumX = -1;
    let maximumY = -1;

    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = ((y * image.width) + x) * 4;
        const red = image.data[offset];
        const green = image.data[offset + 1];
        const blue = image.data[offset + 2];
        const alpha = image.data[offset + 3];
        if (alpha === 0) transparentPixels += 1;
        if (alpha > 8) {
          minimumX = Math.min(minimumX, x);
          minimumY = Math.min(minimumY, y);
          maximumX = Math.max(maximumX, x);
          maximumY = Math.max(maximumY, y);
        }
        if (
          y > image.height * 0.3
          && x < image.width * 0.61
          && green > red * 1.22
          && green > blue * 1.45
          && green - blue > 24
        ) {
          lowerBodyLimePixels += 1;
        }
      }
    }

    expect(image.width).toBe(581);
    expect(image.height).toBe(600);
    expect(transparentPixels).toBeGreaterThan(image.width * image.height * 0.6);
    expect(minimumX).toBeGreaterThanOrEqual(10);
    expect(minimumY).toBeGreaterThanOrEqual(10);
    expect(maximumX).toBeLessThanOrEqual(image.width - 11);
    expect(maximumY).toBeLessThanOrEqual(image.height - 11);
    expect(lowerBodyLimePixels).toBeLessThan(30);
  });
});
