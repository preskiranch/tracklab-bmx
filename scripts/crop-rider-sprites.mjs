import { createReadStream, createWriteStream } from 'node:fs';
import { PNG } from 'pngjs';

const input = new URL('../public/assets/bmx-sprite-sheet-alpha.png', import.meta.url);
const crops = [
  { name: 'rider-lime.png', x: 42, y: 116, width: 316, height: 360 },
  { name: 'rider-red.png', x: 430, y: 118, width: 316, height: 360 },
  { name: 'rider-blue.png', x: 815, y: 118, width: 316, height: 360 },
  { name: 'rider-yellow.png', x: 1197, y: 118, width: 316, height: 360 },
];

createReadStream(input)
  .pipe(new PNG())
  .on('parsed', function handleParsed() {
    for (const crop of crops) {
      const output = new PNG({ width: crop.width, height: crop.height });

      PNG.bitblt(this, output, crop.x, crop.y, crop.width, crop.height, 0, 0);
      output.pack().pipe(createWriteStream(new URL(`../public/assets/${crop.name}`, import.meta.url)));
    }
  });
