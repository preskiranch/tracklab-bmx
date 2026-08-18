import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const [inputPath, outputPath, requestedHeight = '400'] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/extract-generated-rider-alpha.mjs INPUT OUTPUT [HEIGHT]');
}

const input = PNG.sync.read(await readFile(inputPath));
const extractedAlpha = new Uint8Array(input.width * input.height);
let minX = input.width;
let minY = input.height;
let maxX = 0;
let maxY = 0;

for (let y = 0; y < input.height; y += 1) {
  for (let x = 0; x < input.width; x += 1) {
    const pixelOffset = (y * input.width + x) * 4;
    const red = input.data[pixelOffset];
    const green = input.data[pixelOffset + 1];
    const blue = input.data[pixelOffset + 2];
    const darkest = Math.min(red, green, blue);
    const lightest = Math.max(red, green, blue);
    const spread = lightest - darkest;
    let alpha = 255;

    // Image generation returned a baked 18px gray checkerboard. Its squares
    // are neutral and very bright, unlike the black/lime rider and bicycle.
    if (darkest >= 235 && spread <= 16) {
      alpha = 0;
    } else if (darkest >= 218 && spread <= 13) {
      alpha = Math.round(255 * (235 - darkest) / 17);
    }
    extractedAlpha[y * input.width + x] = Math.max(0, Math.min(255, alpha));
    if (alpha > 24) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

const padding = 22;
minX = Math.max(0, minX - padding);
minY = Math.max(0, minY - padding);
maxX = Math.min(input.width - 1, maxX + padding);
maxY = Math.min(input.height - 1, maxY + padding);
const cropWidth = maxX - minX + 1;
const cropHeight = maxY - minY + 1;
const outputHeight = Math.max(64, Number.parseInt(requestedHeight, 10));
const outputWidth = Math.round(outputHeight * cropWidth / cropHeight);
const output = new PNG({ width: outputWidth, height: outputHeight });

function extractedPixel(x, y) {
  const clampedX = Math.max(minX, Math.min(maxX, x));
  const clampedY = Math.max(minY, Math.min(maxY, y));
  const sourcePixel = clampedY * input.width + clampedX;
  const sourceOffset = sourcePixel * 4;
  const alpha = extractedAlpha[sourcePixel] / 255;
  const checkerLevel = (
    (Math.floor(clampedX / 18) + Math.floor(clampedY / 18)) % 2 === 0
      ? 254
      : 243
  );
  const cleanChannel = (channel) => {
    if (alpha <= 0.02 || alpha >= 0.98) return channel;
    return Math.max(0, Math.min(255, (channel - (1 - alpha) * checkerLevel) / alpha));
  };
  return {
    alpha,
    red: cleanChannel(input.data[sourceOffset]),
    green: cleanChannel(input.data[sourceOffset + 1]),
    blue: cleanChannel(input.data[sourceOffset + 2]),
  };
}

for (let outputY = 0; outputY < outputHeight; outputY += 1) {
  const sourceY = minY + (outputY + 0.5) * cropHeight / outputHeight - 0.5;
  const y0 = Math.floor(sourceY);
  const yBlend = sourceY - y0;
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const sourceX = minX + (outputX + 0.5) * cropWidth / outputWidth - 0.5;
    const x0 = Math.floor(sourceX);
    const xBlend = sourceX - x0;
    const samples = [
      [extractedPixel(x0, y0), (1 - xBlend) * (1 - yBlend)],
      [extractedPixel(x0 + 1, y0), xBlend * (1 - yBlend)],
      [extractedPixel(x0, y0 + 1), (1 - xBlend) * yBlend],
      [extractedPixel(x0 + 1, y0 + 1), xBlend * yBlend],
    ];
    let alpha = 0;
    let premultipliedRed = 0;
    let premultipliedGreen = 0;
    let premultipliedBlue = 0;
    for (const [sample, weight] of samples) {
      const weightedAlpha = sample.alpha * weight;
      alpha += weightedAlpha;
      premultipliedRed += sample.red * weightedAlpha;
      premultipliedGreen += sample.green * weightedAlpha;
      premultipliedBlue += sample.blue * weightedAlpha;
    }
    const outputOffset = (outputY * outputWidth + outputX) * 4;
    output.data[outputOffset] = alpha > 0 ? Math.round(premultipliedRed / alpha) : 0;
    output.data[outputOffset + 1] = alpha > 0 ? Math.round(premultipliedGreen / alpha) : 0;
    output.data[outputOffset + 2] = alpha > 0 ? Math.round(premultipliedBlue / alpha) : 0;
    output.data[outputOffset + 3] = Math.round(alpha * 255);
  }
}

// Keep the lower riding kit neutral black. The source render included a lime
// shin accent that reads like an animation guide once the legs are articulated.
for (let y = Math.floor(output.height * 0.3); y < output.height; y += 1) {
  for (let x = 0; x < Math.floor(output.width * 0.61); x += 1) {
    const offset = (y * output.width + x) * 4;
    const red = output.data[offset];
    const green = output.data[offset + 1];
    const blue = output.data[offset + 2];
    if (green > red * 1.22 && green > blue * 1.45 && green - blue > 24) {
      const neutral = Math.max(10, Math.min(66, Math.round((red + green + blue) / 7)));
      output.data[offset] = neutral;
      output.data[offset + 1] = neutral + 2;
      output.data[offset + 2] = neutral + 3;
    }
  }
}

await writeFile(outputPath, PNG.sync.write(output));
console.log(`Extracted ${outputWidth}x${outputHeight} transparent rider to ${outputPath}`);
