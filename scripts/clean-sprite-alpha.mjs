import { createReadStream, createWriteStream } from 'node:fs';
import { PNG } from 'pngjs';

const input = new URL('../public/assets/bmx-sprite-sheet.png', import.meta.url);
const output = new URL('../public/assets/bmx-sprite-sheet-alpha.png', import.meta.url);

createReadStream(input)
  .pipe(new PNG())
  .on('parsed', function handleParsed() {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = (this.width * y + x) << 2;
        const red = this.data[idx];
        const green = this.data[idx + 1];
        const blue = this.data[idx + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const saturation = max - min;

        if (min > 232 && saturation < 12) {
          this.data[idx + 3] = 0;
        } else if (min > 215 && saturation < 8) {
          this.data[idx + 3] = Math.min(this.data[idx + 3], 55);
        }
      }
    }

    this.pack().pipe(createWriteStream(output));
  });
