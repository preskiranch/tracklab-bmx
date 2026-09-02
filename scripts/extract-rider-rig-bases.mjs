import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDirectory = path.join(repoRoot, 'public', 'assets');
const colors = ['lime', 'red', 'blue', 'yellow'];
const sourceFrameCount = 9;
// Frame zero is the complete stopped pose. The former final-frame extraction
// inherited a flat crop through the rear tire from the generated atlas.
const stationaryFrameIndex = 0;

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function evergreenFilteredCopy(source) {
  const output = PNG.sync.read(PNG.sync.write(source));
  const saturation = 1.35;
  const brightness = 0.64;
  const contrast = 1.08;
  for (let offset = 0; offset < output.data.length; offset += 4) {
    if (output.data[offset + 3] === 0) continue;
    const red = output.data[offset];
    const green = output.data[offset + 1];
    const blue = output.data[offset + 2];
    const saturatedRed = ((0.213 + (0.787 * saturation)) * red)
      + ((0.715 - (0.715 * saturation)) * green)
      + ((0.072 - (0.072 * saturation)) * blue);
    const saturatedGreen = ((0.213 - (0.213 * saturation)) * red)
      + ((0.715 + (0.285 * saturation)) * green)
      + ((0.072 - (0.072 * saturation)) * blue);
    const saturatedBlue = ((0.213 - (0.213 * saturation)) * red)
      + ((0.715 - (0.715 * saturation)) * green)
      + ((0.072 + (0.928 * saturation)) * blue);
    output.data[offset] = clampChannel((((saturatedRed * brightness) - 128) * contrast) + 128);
    output.data[offset + 1] = clampChannel((((saturatedGreen * brightness) - 128) * contrast) + 128);
    output.data[offset + 2] = clampChannel((((saturatedBlue * brightness) - 128) * contrast) + 128);
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
