import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , inputDirectory, outputDirectory] = process.argv;

if (!inputDirectory || !outputDirectory) {
  throw new Error('Usage: node scripts/build-rider-animation-atlases.mjs <input-directory> <output-directory>');
}

const colors = ['lime', 'red', 'blue', 'yellow'];
const columns = 2;
const rows = 3;
const frameCount = columns * rows;
const alphaThreshold = 128;
const framePadding = 18;

const sheets = await Promise.all(colors.map(async (color) => {
  const file = path.join(inputDirectory, `${color}-alpha.png`);
  return {
    color,
    png: PNG.sync.read(await readFile(file)),
  };
}));

const { width, height } = sheets[0].png;
if (width % columns !== 0 || height % rows !== 0) {
  throw new Error(`Rider sheets must use an exact ${columns}x${rows} grid.`);
}

for (const sheet of sheets) {
  if (sheet.png.width !== width || sheet.png.height !== height) {
    throw new Error('All rider sheets must have identical dimensions.');
  }
}

const sourceFrameWidth = width / columns;
const sourceFrameHeight = height / rows;
const bounds = {
  minX: sourceFrameWidth,
  minY: sourceFrameHeight,
  maxX: -1,
  maxY: -1,
};

for (const { png } of sheets) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    for (let y = 0; y < sourceFrameHeight; y += 1) {
      for (let x = 0; x < sourceFrameWidth; x += 1) {
        const sourceIndex = (((row * sourceFrameHeight + y) * width) + (column * sourceFrameWidth + x)) * 4;
        if (png.data[sourceIndex + 3] < alphaThreshold) {
          continue;
        }

        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
  }
}

if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
  throw new Error('No visible rider pixels were found in the source sheets.');
}

const contentWidth = bounds.maxX - bounds.minX + 1;
const contentHeight = bounds.maxY - bounds.minY + 1;
const frameSize = Math.max(contentWidth, contentHeight) + (framePadding * 2);
const destinationX = Math.floor((frameSize - contentWidth) / 2);
const destinationY = Math.floor((frameSize - contentHeight) / 2);

await mkdir(outputDirectory, { recursive: true });

for (const { color, png } of sheets) {
  const atlas = new PNG({ width: frameSize * frameCount, height: frameSize });

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    PNG.bitblt(
      png,
      atlas,
      (column * sourceFrameWidth) + bounds.minX,
      (row * sourceFrameHeight) + bounds.minY,
      contentWidth,
      contentHeight,
      (frameIndex * frameSize) + destinationX,
      destinationY,
    );
  }

  const outputFile = path.join(outputDirectory, `rider-${color}-animated.png`);
  await writeFile(outputFile, PNG.sync.write(atlas));
  console.log(`Wrote ${outputFile}`);
}

console.log(JSON.stringify({ bounds, contentWidth, contentHeight, frameSize }));
