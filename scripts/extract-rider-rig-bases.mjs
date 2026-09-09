import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDirectory = path.join(repoRoot, 'public', 'assets');
const colors = ['lime', 'red', 'blue', 'yellow'];
const sourceFrameCount = 9;
// Frame one is the complete pose: frame zero clips the front tire and
// frame two clips the rear tire. Animation is rendered by the runtime leg rig.
const stationaryFrameIndex = 1;

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function evergreenFilteredCopy(source) {
  const output = PNG.sync.read(PNG.sync.write(source));
  // Recolor only the lime material to the card's Evergreen hue. Preserve
  // highlights, shading, the black frame and the original alpha silhouette.
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const [r, g, b, a] = output.data.subarray(offset, offset + 4);
    if (!a || g <= b * 1.3 || r <= b * 1.15 || g < r * 0.85) continue;
    const shade = Math.max(r, g, b) / 255;
    output.data[offset] = clampChannel(23 * shade);
    output.data[offset + 1] = clampChannel(143 * shade);
    output.data[offset + 2] = clampChannel(77 * shade);
  }
  return output;
}

for (const color of colors) {
  const sourcePath = path.join(assetDirectory, `rider-${color}-animated.png`);
  const source = PNG.sync.read(await readFile(sourcePath));
  const frameSize = source.height;
  if (source.width !== frameSize * sourceFrameCount) {
    throw new Error(`${sourcePath} is not a ${sourceFrameCount}-frame rider atlas`);
  }

  const output = new PNG({ width: frameSize, height: frameSize });
  PNG.bitblt(
    source,
    output,
    stationaryFrameIndex * frameSize,
    0,
    frameSize,
    frameSize,
    0,
    0,
  );
  await writeFile(
    path.join(assetDirectory, `rider-${color}-rig-base.png`),
    PNG.sync.write(output),
  );
  if (color === 'lime') {
    await writeFile(
      path.join(assetDirectory, 'rider-evergreen-rig-base.png'),
      PNG.sync.write(evergreenFilteredCopy(output)),
    );
  }
}
