import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , inputDirectory, outputDirectory] = process.argv;

if (!inputDirectory || !outputDirectory) {
  throw new Error('Usage: node scripts/build-rider-animation-atlases.mjs <input-directory> <output-directory>');
}

const colors = ['lime', 'red', 'blue', 'yellow'];
const columns = 3;
const rows = 3;
const frameCount = columns * rows;
const alphaThreshold = 128;
const framePadding = 18;
const cellLeftInset = 24;

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
function sourcePixelIsLabel(x, y) {
  return x < cellLeftInset && y < sourceFrameHeight * 0.18;
}

function visibleFrameBounds(png, frameIndex) {
  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const bounds = {
    minX: sourceFrameWidth,
    minY: sourceFrameHeight,
    maxX: -1,
    maxY: -1,
  };

  for (let y = 0; y < sourceFrameHeight; y += 1) {
    for (let x = 0; x < sourceFrameWidth; x += 1) {
      // The source generator can place a small label in the upper-left corner.
      // Mask that top strip only; a full-height x inset cuts through rear tires.
      if (sourcePixelIsLabel(x, y)) continue;
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

  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new Error(`No visible rider pixels were found in frame ${frameIndex}.`);
  }

  return {
    ...bounds,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
  };
}

const preparedSheets = sheets.map((sheet) => ({
  ...sheet,
  frameBounds: Array.from({ length: frameCount }, (_, frameIndex) => visibleFrameBounds(sheet.png, frameIndex)),
}));
const targetSubjectSize = Math.max(...preparedSheets.flatMap((sheet) => (
  sheet.frameBounds.flatMap((bounds) => [bounds.width, bounds.height])
)));
const frameSize = targetSubjectSize + (framePadding * 2);

await mkdir(outputDirectory, { recursive: true });

for (const { color, png, frameBounds } of preparedSheets) {
  const atlas = new PNG({ width: frameSize * frameCount, height: frameSize });

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const column = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    const bounds = frameBounds[frameIndex];
    const scale = Math.min(targetSubjectSize / bounds.width, targetSubjectSize / bounds.height);
    const destinationWidth = Math.max(1, Math.round(bounds.width * scale));
    const destinationHeight = Math.max(1, Math.round(bounds.height * scale));
    const destinationX = (frameIndex * frameSize) + Math.floor((frameSize - destinationWidth) / 2);
    const destinationY = frameSize - framePadding - destinationHeight;

    for (let y = 0; y < destinationHeight; y += 1) {
      const sourceY = Math.min(bounds.height - 1, Math.floor(y / scale));
      for (let x = 0; x < destinationWidth; x += 1) {
        const sourceX = Math.min(bounds.width - 1, Math.floor(x / scale));
        const sourceFrameX = bounds.minX + sourceX;
        const sourceFrameY = bounds.minY + sourceY;
        if (sourcePixelIsLabel(sourceFrameX, sourceFrameY)) continue;
        const sourceIndex = (
          ((row * sourceFrameHeight + sourceFrameY) * width)
          + (column * sourceFrameWidth + sourceFrameX)
        ) * 4;
        const destinationIndex = (((destinationY + y) * atlas.width) + destinationX + x) * 4;
        png.data.copy(atlas.data, destinationIndex, sourceIndex, sourceIndex + 4);
      }
    }
  }

  const outputFile = path.join(outputDirectory, `rider-${color}-animated.png`);
  await writeFile(outputFile, PNG.sync.write(atlas));
  console.log(`Wrote ${outputFile}`);
}

console.log(JSON.stringify({ targetSubjectSize, frameSize }));
