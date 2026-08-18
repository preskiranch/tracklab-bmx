import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const sourcePath = 'public/assets/get-pulled/tracklab-bmx-pull-sled-v1.png';
const outputPath = 'public/assets/get-pulled/tracklab-bmx-pull-sled-clean-v2.png';
const crop = { x: 1040, y: 430, width: 734, height: 390 };

const source = PNG.sync.read(await readFile(sourcePath));
const output = new PNG({ width: crop.width, height: crop.height });

for (let outputY = 0; outputY < crop.height; outputY += 1) {
  for (let outputX = 0; outputX < crop.width; outputX += 1) {
    const sourceX = crop.x + outputX;
    const sourceY = crop.y + outputY;
    const sourceOffset = (sourceY * source.width + sourceX) * 4;
    const outputOffset = (outputY * crop.width + outputX) * 4;

    output.data[outputOffset] = source.data[sourceOffset];
    output.data[outputOffset + 1] = source.data[sourceOffset + 1];
    output.data[outputOffset + 2] = source.data[sourceOffset + 2];
    output.data[outputOffset + 3] = source.data[sourceOffset + 3];

    // The source composition includes the chain leading to its original rider.
    // The live scene draws its own seat-post tow connection, so remove the
    // orphaned chain while retaining the sled body that begins below it.
    const orphanedTowChain = (
      (sourceX < 1190 && sourceY < 650)
      || (outputX < 158 && outputY < 245)
    );
    if (orphanedTowChain) {
      output.data[outputOffset + 3] = 0;
    }
  }
}

await writeFile(outputPath, PNG.sync.write(output));
console.log(`Built ${outputPath}`);
