import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDirectory = path.join(repoRoot, 'public', 'assets');
const colors = ['lime', 'red', 'blue', 'yellow'];
const sourceFrameCount = 9;
const stationaryFrameIndex = sourceFrameCount - 1;

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
}
